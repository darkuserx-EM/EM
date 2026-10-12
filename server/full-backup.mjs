import {attachmentBatches} from './attachment-batches.mjs';
import { todayGT } from './generated/domain.mjs';
import { createHash } from 'node:crypto';
import { equipmentImageFields, isEquipmentImageReference } from './generated/domain.mjs';
import { presentEquipment } from './equipment-images.mjs';
import { legacyMedia, mediaColumns, mediaMetadata, verifyStoredMedia } from './media.mjs';
import { writeLine, validateRestoreFile } from './attachment-backup.mjs';
import { logFailure } from './diagnostics.mjs';

const key = (id, field, hash) => JSON.stringify([id, field, hash]);
export async function* fullBackupEntries(conn) {
  const [meta] = await conn.query('SELECT revision FROM em_meta WHERE id=1');
  yield { type: 'portal-em.full', version: 1, schemaVersion: 1, revision: Number(meta[0].revision), exportedAt: new Date().toISOString() };
  let entity = '', id = ''; const needed = new Set();
  for (;;) {
    const [rows] = await conn.execute('SELECT entity,id,payload FROM em_records WHERE entity>? OR (entity=? AND id>?) ORDER BY entity,id LIMIT 1', [entity, entity, id]);
    if (!rows.length) break;
    const row = rows[0]; let record = JSON.parse(row.payload);
    if (row.entity === 'Equipo') {
      record = presentEquipment(record);
      for (const field of equipmentImageFields) if (isEquipmentImageReference(record[field])) needed.add(key(record.id, field, record[field].slice(6)));
    }
    yield { type: 'record', entity: row.entity, record };
    entity = row.entity; id = row.id;
  }
  // Same archive format as legacy backups; audit rows now have their own table.
  let auditId='';
  for(;;) {
    const [rows]=await conn.execute('SELECT id,payload FROM em_audit_log WHERE id>? ORDER BY id LIMIT 200',[auditId]);
    if(!rows.length)break;
    for(const row of rows)yield {type:'record',entity:'Bitacora',record:JSON.parse(row.payload)};
    auditId=rows.at(-1).id;
  }
  // Include retired files as well. Only the currently bound hash is accessible in the portal.
  let equipment = '', field = '', hash = ''; const included = new Set();
  for (;;) {
    const [files] = await conn.execute(`SELECT ${mediaColumns},content FROM em_media WHERE equipment_id>? OR (equipment_id=? AND field>?) OR (equipment_id=? AND field=? AND hash>?) ORDER BY equipment_id,field,hash LIMIT 1`, [equipment, equipment, field, equipment, field, hash]);
    if (!files.length) break;
    const file = files[0]; verifyStoredMedia(file);
    const identity = key(file.equipment_id, file.field, file.hash); included.add(identity); needed.delete(identity);
    yield { type: 'media', file: { metadata: mediaMetadata(file), base64: file.content.toString('base64') } };
    equipment = file.equipment_id; field = file.field; hash = file.hash;
  }
  id = '';
  for (;;) {
    const [rows] = await conn.execute("SELECT id,payload FROM em_records WHERE entity='Equipo' AND id>? ORDER BY id LIMIT 1", [id]);
    if (!rows.length) break;
    const record = JSON.parse(rows[0].payload);
    for (const field of equipmentImageFields) if (typeof record[field] === 'string' && record[field].startsWith('data:')) {
      const file = await legacyMedia(record[field]); const identity = key(record.id, field, file.hash);
      if (!included.has(identity)) yield { type: 'media', file: { metadata: mediaMetadata({ ...file, equipment_id: record.id, field, uploaded_by: record.creado_por, created_at: Date.parse(record.fecha_creacion) }), base64: file.content.toString('base64') } };
      needed.delete(identity);
    }
    id = record.id;
  }
  if (needed.size) throw Object.assign(new Error('Missing referenced equipment media'), { code: 'BACKUP_MEDIA_MISSING' });
  for await(const rows of attachmentBatches(conn)) for(const row of rows) {
    const { content, ...metadata } = row; metadata.size = Number(metadata.size); metadata.created_at = Number(metadata.created_at);
    const file = { metadata, base64: content.toString('base64') }; validateRestoreFile(file);
    yield { type: 'attachment', file };
  }
}
export function registerFullBackupRoutes(app, { pool, logger = console.error }) {
  app.get('/api/admin/full-backup', async (req, res) => {
    if (req.actor.rol !== 'Administrador') throw Object.assign(new Error('Solo administración puede descargar el respaldo completo.'), { status: 403, expose: true });
    const conn = await pool.getConnection();
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); await conn.beginTransaction();
      res.type('application/x-ndjson').set('Content-Disposition', `attachment; filename="Portal-EM-Completo-${todayGT()}.jsonl"`);
      const checksum = createHash('sha256'); const counts = { record: 0, media: 0, attachment: 0 };
      for await (const entry of fullBackupEntries(conn)) {
        checksum.update(await writeLine(res, entry));
        if (entry.type in counts) counts[entry.type]++;
      }
      await conn.commit();
      await writeLine(res, { type: 'complete', counts, sha256: checksum.digest('hex') }); res.end();
    } catch (error) {
      await conn.rollback();
      if (!res.headersSent) throw error;
      if (error.code !== 'DOWNLOAD_CLOSED') logFailure(error, { event: 'full.backup', status: 500 }, logger);
      res.destroy();
    } finally { conn.release(); }
  });
}
