import express from 'express';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { equipmentImageFields, isEquipmentImageReference, validEquipmentImage } from './generated/domain.mjs';
import { imageReference } from './equipment-images.mjs';

export const mediaColumns = 'equipment_id,field,hash,mime,size,sha256,uploaded_by,created_at';
const fail = (status, message) => Object.assign(new Error(message), { status, expose: true });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);
export const mediaMetadata = row => ({ equipment_id: row.equipment_id, field: row.field, hash: row.hash, mime: row.mime, size: Number(row.size), sha256: row.sha256, uploaded_by: row.uploaded_by, created_at: Number(row.created_at) });
export const mediaDataUrl = row => `data:${row.mime};base64,${row.content.toString('base64')}`;

export async function prepareMedia(bytes, mime, { legacy = false } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 2624970 || !['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw fail(400, 'La imagen no tiene un formato o tamaño permitido.');
  const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
  if (!validEquipmentImage(dataUrl)) throw fail(400, 'El contenido no corresponde a una imagen válida.');
  let thumbnail = null;
  try {
    const input = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await input.metadata();
    if (metadata.format !== mime.slice(6) || (metadata.pages || 1) > 1) throw new Error('Unsupported image');
    thumbnail = await input.rotate().resize(480, 360, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
  } catch {
    // Older versions accepted signatures only. Preserve those originals byte for byte;
    // a missing thumbnail must never delete historical evidence.
    if (!legacy) throw fail(400, 'No se pudo decodificar la imagen. Usa una foto PNG, JPG o WebP estática de hasta 40 megapíxeles.');
  }
  return { hash: imageReference(dataUrl).slice(6), mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), content: bytes, thumbnail };
}
export async function legacyMedia(value) {
  if (typeof value !== 'string' || !value.startsWith('data:') || !validEquipmentImage(value)) throw fail(400, 'La fotografía original no es válida.');
  const [, mime, base64] = value.match(/^data:(image\/(?:png|jpeg|webp));base64,(.*)$/);
  return prepareMedia(Buffer.from(base64, 'base64'), mime, { legacy: true });
}
export function verifyStoredMedia(row) {
  if (!row || !Buffer.isBuffer(row.content) || row.content.length !== Number(row.size) || createHash('sha256').update(row.content).digest('hex') !== row.sha256 || imageReference(mediaDataUrl(row)).slice(6) !== row.hash) throw fail(409, 'La integridad de una fotografía no coincide. No se modificaron sus datos.');
}
export async function storeMedia(conn, value) {
  const [old] = await conn.execute(`SELECT ${mediaColumns},content FROM em_media WHERE equipment_id=? AND field=? AND hash=?`, [value.equipment_id, value.field, value.hash]);
  if (old.length) {
    verifyStoredMedia(old[0]);
    if (old[0].sha256 !== value.sha256 || old[0].mime !== value.mime || !old[0].content.equals(value.content)) throw fail(409, 'Existe otra fotografía con esa identidad.');
    return false;
  }
  await conn.execute('INSERT INTO em_media (equipment_id,field,hash,mime,size,sha256,uploaded_by,created_at,content,thumbnail) VALUES (?,?,?,?,?,?,?,?,?,?)', [value.equipment_id, value.field, value.hash, value.mime, value.size, value.sha256, value.uploaded_by, value.created_at, value.content, value.thumbnail]);
  // Verify bytes before replacing any original embedded value.
  const [saved] = await conn.execute(`SELECT ${mediaColumns},content FROM em_media WHERE equipment_id=? AND field=? AND hash=?`, [value.equipment_id, value.field, value.hash]);
  verifyStoredMedia(saved[0]);
  return true;
}
export async function persistEquipmentMedia(conn, next, previous, { actor, uploads = {}, targetId, restore = false } = {}) {
  const old = new Map(previous.entities.Equipo.map(row => [row.id, row]));
  for (const row of next.entities.Equipo) for (const field of equipmentImageFields) {
    let value = row[field]; const original = old.get(row.id)?.[field];
    if (!value) continue;
    if (value === original && isEquipmentImageReference(value) && !restore) continue;
    if (typeof value === 'string' && value.startsWith('data:')) {
      const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,(.*)$/);
      const file = restore || value === original ? await legacyMedia(value) : await prepareMedia(Buffer.from(match?.[2] || '', 'base64'), match?.[1]);
      await storeMedia(conn, { ...file, equipment_id: row.id, field, uploaded_by: actor?.id || row.creado_por, created_at: Date.now() });
      row[field] = `media:${file.hash}`; continue;
    }
    // A compact reference to an old inline file is valid only for this equipment/field.
    if (typeof original === 'string' && original.startsWith('data:') && imageReference(original) === value) {
      const file = await legacyMedia(original);
      await storeMedia(conn, { ...file, equipment_id: row.id, field, uploaded_by: old.get(row.id).creado_por, created_at: Date.parse(old.get(row.id).fecha_creacion) });
      continue;
    }
    if (!isEquipmentImageReference(value)) throw fail(400, 'La referencia de fotografía no es válida.');
    if (row.id === targetId && uuid(uploads[field])) {
      const [pending] = await conn.execute('SELECT * FROM em_media_uploads WHERE id=? AND uploaded_by=? AND field=? AND expires_at>? FOR UPDATE', [uploads[field], actor.id, field, Date.now()]);
      const upload = pending[0];
      if (!upload || value !== `media:${upload.hash}` || (upload.equipment_id && upload.equipment_id !== row.id)) throw fail(400, 'La carga de fotografía no pertenece a este equipo o ha vencido. Vuelve a seleccionar la foto.');
      await storeMedia(conn, { ...upload, equipment_id: row.id });
      await conn.execute('UPDATE em_media_uploads SET equipment_id=? WHERE id=?', [row.id, upload.id]);
      continue;
    }
    if (restore || value === original) {
      const [files] = await conn.execute(`SELECT hash FROM em_media WHERE equipment_id=? AND field=? AND hash=?`, [row.id, field, value.slice(6)]);
      if (files.length) continue;
      throw fail(409, 'Falta una fotografía del respaldo. Recupera primero los archivos y luego sus registros.');
    }
    throw fail(400, 'No se puede adjuntar una fotografía por su referencia. Carga el archivo desde este formulario.');
  }
}
export async function hydrateEquipment(conn, records, { maxBytes = 24 * 1024 * 1024 } = {}) {
  const result = structuredClone(records);
  let bytes = 0;
  for (const row of result) for (const field of equipmentImageFields) {
    if (typeof row[field] === 'string' && row[field].startsWith('data:')) {
      bytes += Buffer.byteLength(row[field]);
      if (bytes > maxBytes) throw fail(413, 'Las fotografías superan el respaldo Excel. Descarga el respaldo completo por archivos desde Datos y respaldos.');
    }
    if (!isEquipmentImageReference(row[field])) continue;
    const [metadata] = await conn.execute('SELECT size FROM em_media WHERE equipment_id=? AND field=? AND hash=?', [row.id, field, row[field].slice(6)]);
    if (!metadata.length) throw fail(409, 'No se puede exportar: falta una fotografía. Revisa el respaldo completo.');
    bytes += Math.ceil(Number(metadata[0].size) / 3) * 4 + 40;
    if (bytes > maxBytes) throw fail(413, 'Las fotografías superan el respaldo Excel. Descarga el respaldo completo por archivos desde Datos y respaldos.');
    const [files] = await conn.execute(`SELECT ${mediaColumns},content FROM em_media WHERE equipment_id=? AND field=? AND hash=?`, [row.id, field, row[field].slice(6)]);
    if (!files.length) throw fail(409, 'No se puede exportar: falta una fotografía. Revisa el respaldo completo.');
    verifyStoredMedia(files[0]); row[field] = mediaDataUrl(files[0]);
  }
  return result;
}
export async function migrateLegacyMedia(pool, { batchSize = 5, afterBatch } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) throw new RangeError('Invalid media migration batch size');
  let cursor = '', migrated = 0, images = 0;
  for (;;) {
    const [ids] = await pool.execute("SELECT id FROM em_records WHERE entity='Equipo' AND id>? ORDER BY id LIMIT ?", [cursor, batchSize]);
    if (!ids.length) break;
    for (const { id } of ids) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction(); await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE');
        const [rows] = await conn.execute("SELECT payload FROM em_records WHERE entity='Equipo' AND id=?", [id]);
        if (rows.length) {
          const row = JSON.parse(rows[0].payload); const fields = equipmentImageFields.filter(field => typeof row[field] === 'string' && row[field].startsWith('data:'));
          if (fields.length) {
            // Recovery copy remains untouched; migration is atomic per equipment and repeatable.
            await conn.execute('INSERT IGNORE INTO em_media_migration (equipment_id,payload,created_at) VALUES (?,?,?)', [id, rows[0].payload, Date.now()]);
            for (const field of fields) {
              const file = await legacyMedia(row[field]);
              await storeMedia(conn, { ...file, equipment_id: id, field, uploaded_by: row.creado_por, created_at: Date.parse(row.fecha_creacion) });
              row[field] = `media:${file.hash}`;
            }
            await conn.execute("UPDATE em_records SET payload=? WHERE entity='Equipo' AND id=?", [JSON.stringify(row), id]);
            await conn.query('UPDATE em_meta SET revision=revision+1 WHERE id=1'); migrated++; images += fields.length;
          }
        }
        await conn.commit();
      } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
      cursor = id;
    }
    if (afterBatch) await afterBatch({ migrated, images });
  }
  await pool.query('UPDATE em_meta SET schema_version=GREATEST(schema_version,3) WHERE id=1');
  return { migrated, images };
}
export async function cleanupMediaUploads(pool, now = Date.now()) {
  // These are temporary upload receipts. Bound originals live independently in em_media.
  let removed = 0;
  for (let pass = 0; pass < 20; pass++) {
    const [result] = await pool.execute('DELETE FROM em_media_uploads WHERE expires_at<=? LIMIT 500', [now]);
    removed += result.affectedRows; if (result.affectedRows < 500) break;
  }
  return removed;
}
export function registerMediaUploadRoutes(app, { pool }) {
  const admin = (req, _res, next) => req.actor.rol === 'Administrador' ? next() : next(fail(403, 'Solo administración puede cargar fotografías de equipos.'));
  app.post('/api/equipment-media/upload', admin, express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: 2624970 }), async (req, res) => {
    const id = req.get('x-upload-id'), field = req.get('x-equipment-field');
    if (!uuid(id) || !equipmentImageFields.includes(field)) throw fail(400, 'La identidad o el campo de la carga no es válido.');
    const file = await prepareMedia(req.body, req.get('content-type'));
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Serialize per uploader without locking all operational records while decoding.
      await conn.execute('SELECT id FROM em_users WHERE id=? FOR UPDATE', [req.actor.id]);
      const [old] = await conn.execute('SELECT * FROM em_media_uploads WHERE id=?', [id]);
      if (old.length) {
        const row = old[0];
        if (row.uploaded_by !== req.actor.id || row.field !== field || row.hash !== file.hash || Number(row.expires_at) <= Date.now()) throw fail(409, 'El identificador de envío ya fue utilizado o venció.');
      } else {
        const [count] = await conn.execute('SELECT COUNT(*) AS n FROM em_media_uploads WHERE uploaded_by=? AND expires_at>? AND equipment_id IS NULL', [req.actor.id, Date.now()]);
        if (Number(count[0].n) >= 60) throw fail(429, 'Hay demasiadas fotografías pendientes de guardar. Guarda los equipos antes de continuar.');
        await conn.execute('INSERT INTO em_media_uploads (id,field,hash,mime,size,sha256,uploaded_by,created_at,expires_at,content,thumbnail) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, field, file.hash, file.mime, file.size, file.sha256, req.actor.id, Date.now(), Date.now() + 86400000, file.content, file.thumbnail]);
      }
      await conn.commit(); res.status(old.length ? 200 : 201).json({ uploadId: id, reference: `media:${file.hash}` });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });
  app.post('/api/admin/media/restore', admin, express.json({ limit: '4mb' }), async (req, res) => {
    const m = req.body?.file?.metadata, base64 = req.body?.file?.base64;
    if (!m || !identifier(m.equipment_id) || !equipmentImageFields.includes(m.field) || !identifier(m.uploaded_by) || !Number.isSafeInteger(m.created_at) || m.created_at <= 0 || m.created_at > Date.now() + 300000 || typeof base64 !== 'string') throw fail(400, 'Metadatos de fotografía inválidos.');
    const file = await legacyMedia(`data:${m.mime};base64,${base64}`);
    if (m.hash !== file.hash || m.sha256 !== file.sha256 || m.size !== file.size) throw fail(400, 'La fotografía no coincide con la integridad del respaldo.');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction(); await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE');
      const [existing] = await conn.execute(`SELECT ${mediaColumns} FROM em_media WHERE equipment_id=? AND field=? AND hash=?`, [m.equipment_id, m.field, m.hash]);
      if (existing.length && JSON.stringify(mediaMetadata(existing[0])) !== JSON.stringify(mediaMetadata(m))) throw fail(409, 'La fotografía existente tiene otra autoría o fecha. No se sobrescribió.');
      const inserted = await storeMedia(conn, { ...file, ...mediaMetadata(m) });
      if (inserted) await conn.execute('INSERT INTO em_security_events (id,actor_id,target_id,action,created_at) VALUES (?,?,?,?,?)', [randomUUID(), req.actor.id, m.equipment_id, 'media.restored', Date.now()]);
      await conn.commit(); res.status(inserted ? 201 : 200).json({ restored: true, duplicate: !inserted });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });
}
