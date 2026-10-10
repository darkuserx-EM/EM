import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { decodeAttachment } from './attachments.mjs';
import { logFailure } from './diagnostics.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status, expose: true });
const fields = 'id,order_id,request_id,category,name,mime,size,sha256,uploaded_by,created_at';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);
const metadataOf = row => ({ id: row.id, order_id: row.order_id, request_id: row.request_id, category: row.category, name: row.name, mime: row.mime, size: Number(row.size), sha256: row.sha256, uploaded_by: row.uploaded_by, created_at: Number(row.created_at) });
function validateRestoreFile(input) {
  if (!input || typeof input !== 'object' || !input.metadata || typeof input.metadata !== 'object') throw fail(400, 'El respaldo no contiene un archivo válido.');
  const m = input.metadata;
  if (!uuid(m.id) || !uuid(m.request_id) || !identifier(m.order_id) || !identifier(m.uploaded_by)) throw fail(400, 'La identidad o autoría del archivo no es válida.');
  if (!Number.isSafeInteger(m.created_at) || m.created_at <= 0 || m.created_at > Date.now() + 5 * 60000) throw fail(400, 'La fecha original del archivo no es válida.');
  if (!Number.isSafeInteger(m.size) || !/^[a-f0-9]{64}$/.test(m.sha256 || '')) throw fail(400, 'La integridad del archivo no es válida.');
  const decoded = decodeAttachment({ requestId: m.request_id, category: m.category, name: m.name, base64: input.base64 });
  if (decoded.name !== m.name || decoded.mime !== m.mime || decoded.bytes.length !== m.size || decoded.sha256 !== m.sha256) throw fail(400, 'El contenido no coincide con el nombre, formato, tamaño o huella del respaldo.');
  return { metadata: metadataOf(m), ...decoded };
}
async function writeLine(res, value) {
  if (res.destroyed) throw Object.assign(new Error('Download closed'), { code: 'DOWNLOAD_CLOSED' });
  const line = `${JSON.stringify(value)}\n`;
  if (!res.write(line)) await new Promise((resolve, reject) => {
    const clean = () => { res.off('drain', drained); res.off('close', closed); res.off('error', failed); };
    const drained = () => { clean(); resolve(); };
    const closed = () => { clean(); reject(Object.assign(new Error('Download closed'), { code: 'DOWNLOAD_CLOSED' })); };
    const failed = error => { clean(); reject(error); };
    res.once('drain', drained); res.once('close', closed); res.once('error', failed);
    if (res.destroyed) closed();
  });
  return line;
}
export function registerAttachmentBackupRoutes(app, { pool, logger = console.error }) {
  const admin = (req, _res, next) => req.actor.rol === 'Administrador' ? next() : next(fail(403, 'Solo administración puede respaldar o recuperar archivos.'));
  app.get('/api/admin/attachments-backup', admin, async (_req, res) => {
    const conn = await pool.getConnection();
    try {
      // Repeatable-read captures one consistent set without locking uploads or retaining all BLOBs.
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conn.beginTransaction();
      const [totals] = await conn.query('SELECT COUNT(*) AS n FROM em_attachments');
      const total = Number(totals[0].n); const exportedAt = new Date().toISOString();
      res.type('application/x-ndjson').set('Content-Disposition', `attachment; filename="portal-em-adjuntos-${exportedAt.slice(0, 10)}.jsonl"`);
      await writeLine(res, { type: 'portal-em.attachments', version: 1, exportedAt, count: total });
      let cursor = ''; let count = 0; const checksum = createHash('sha256');
      while (!res.destroyed) {
        const [rows] = await conn.execute(`SELECT ${fields},content FROM em_attachments WHERE id>? ORDER BY id LIMIT 1`, [cursor]);
        if (!rows.length) break;
        const row = rows[0]; const metadata = metadataOf(row);
        const file = { metadata, base64: row.content.toString('base64') };
        validateRestoreFile(file);
        checksum.update(await writeLine(res, { type: 'attachment', file }), 'utf8');
        cursor = row.id; count++;
      }
      if (count !== total || res.destroyed) throw Object.assign(new Error('Incomplete download'), { code: 'DOWNLOAD_INCOMPLETE' });
      await conn.commit();
      await writeLine(res, { type: 'complete', count, sha256: checksum.digest('hex') });
      res.end();
    } catch (error) {
      await conn.rollback();
      if (res.headersSent) {
        if (!['DOWNLOAD_CLOSED', 'DOWNLOAD_INCOMPLETE'].includes(error.code)) logFailure(error, { event: 'attachments.backup', status: 500 }, logger);
        res.destroy();
      } else throw error;
    } finally { conn.release(); }
  });
  app.post('/api/admin/attachments/restore', admin, express.json({ limit: '6mb' }), async (req, res) => {
    const restored = validateRestoreFile(req.body?.file); const m = restored.metadata;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Same lock order as a record restore/upload: the linked order cannot vanish between check and insert.
      await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE');
      const [orders] = await conn.execute("SELECT id FROM em_records WHERE entity='OrdenServicio' AND id=?", [m.order_id]);
      if (!orders.length) throw fail(409, 'La orden original no existe. Restaura primero el respaldo de registros del portal.');
      const [existing] = await conn.execute(`SELECT ${fields},content FROM em_attachments WHERE id=? OR request_id=? FOR UPDATE`, [m.id, m.request_id]);
      if (existing.length) {
        if (existing.length !== 1 || JSON.stringify(metadataOf(existing[0])) !== JSON.stringify(m) || !existing[0].content.equals(restored.bytes)) throw fail(409, 'Ya existe un archivo distinto con esa identidad. No se ha reemplazado ningún contenido.');
        await conn.commit(); return res.json({ restored: true, duplicate: true, id: m.id });
      }
      await conn.execute('INSERT INTO em_attachments (id,order_id,request_id,category,name,mime,size,sha256,uploaded_by,created_at,content) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [m.id, m.order_id, m.request_id, m.category, m.name, m.mime, m.size, m.sha256, m.uploaded_by, m.created_at, restored.bytes]);
      await conn.execute('INSERT INTO em_security_events (id,actor_id,target_id,action,created_at) VALUES (?,?,?,?,?)', [randomUUID(), req.actor.id, m.id, 'attachment.restored', Date.now()]);
      await conn.commit(); res.status(201).json({ restored: true, duplicate: false, id: m.id });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });
}
