import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { select } from './sql.mjs';
import { auditEvidence, decodeAttachment, evidenceReason, permitted, readOrder } from './attachments.mjs';
import { localFiles } from './file-storage.mjs';

/*
 * Firma de quien recibe el servicio (docs/FLUJO-TECNICO.md · Firma de quien recibe).
 * Es un adjunto privado de la orden en la categoría «Firma»: PNG, nombre «Firma de <nombre>.png»,
 * fecha y hora en created_at y quien la capturó en uploaded_by. Vale la más reciente; las anteriores
 * quedan guardadas y en la bitácora de la orden.
 */
/** @param {number} status @param {string} message */
const fail = (status,message) => Object.assign(new Error(message),{status,expose:true});
export const SIGNATURE_MAX_BYTES = 64 * 1024;
export const SIGNATURES_PER_ORDER = 5;
const prefix = 'Firma de ', suffix = '.png';
const actions = { open:'Firma registrada', closed:'Firma posterior al cierre' };

/** Nombre de quien firma: 2 a 120 caracteres, en una línea. @param {unknown} value */
export function signerName(value) {
  const name = typeof value === 'string' ? value.replace(/\s+/g,' ').trim() : '';
  if (name.length < 2 || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw fail(400,'Escribe el nombre de quien recibe el servicio (2 a 120 caracteres).');
  return name;
}
/** @param {string} signer */
export const signatureFileName = signer => `${prefix}${signer}${suffix}`;
/** @param {string} name */
export const signerOf = name => name.startsWith(prefix) && name.endsWith(suffix) ? name.slice(prefix.length,-suffix.length) : name;

/** PNG pequeño con medidas razonables: la firma se dibuja en un recuadro y se recorta antes de enviarla. @param {import('./http-contracts.js').SignatureBody} body @param {string} signer */
export async function decodeSignature(body,signer) {
  if (typeof body.base64 !== 'string' || body.base64.length > Math.ceil(SIGNATURE_MAX_BYTES / 3) * 4) throw fail(400,'La firma supera el tamaño permitido. Bórrala y vuelve a firmar.');
  const file = decodeAttachment({ category:'Firma', name:signatureFileName(signer), base64:body.base64, requestId:body.requestId });
  // El redondeo de base64 puede admitir hasta dos bytes de más: el límite real es el del PNG.
  if (file.bytes.length > SIGNATURE_MAX_BYTES) throw fail(400,'La firma supera el tamaño permitido. Bórrala y vuelve a firmar.');
  const width = file.bytes.length >= 24 && file.bytes.subarray(12,16).toString() === 'IHDR' ? file.bytes.readUInt32BE(16) : 0, height = width ? file.bytes.readUInt32BE(20) : 0;
  if (width < 20 || height < 10 || width > 1600 || height > 800) throw fail(400,'La imagen de la firma no es válida. Bórrala y vuelve a firmar.');
  // Leer las medidas no basta: validar todos los píxeles antes de almacenar el original y su hash.
  try { await sharp(file.bytes,{ limitInputPixels:1600 * 800, failOn:'warning' }).raw().toBuffer(); }
  catch { throw fail(400,'La imagen de la firma no es válida. Bórrala y vuelve a firmar.'); }
  return file;
}

/** @param {{id:string,name:string,created_at:number|string,captured_by?:string|null}} row @param {import('../src/domain/model.js').Actor} actor */
function present(row,actor) {
  // Quién la capturó es dato interno: el cliente ve quién firmó y cuándo.
  return { id:row.id, signer:signerOf(row.name), signedAt:Number(row.created_at), ...(actor.rol === 'Cliente' ? {} : { capturedBy:row.captured_by || 'Usuario del portal' }) };
}

/** @param {import('express').Express} app @param {{pool:import('mysql2/promise').Pool,files?:import('./file-storage.mjs').FileStore}} options */
export function registerSignatureRoutes(app,{pool,files:storage=localFiles}) {
  /** @param {import('./contracts.js').SqlConnection} conn @param {string} orderId */
  const latest = async (conn,orderId) => {
    /** @type {{id:string,name:string,created_at:number,captured_by:string|null}[]} */
    const rows = await select(conn,"SELECT a.id,a.name,a.created_at,u.name AS captured_by FROM em_attachments a LEFT JOIN em_users u ON u.id=a.uploaded_by WHERE a.order_id=? AND a.category='Firma' ORDER BY a.created_at DESC,a.id DESC LIMIT 1",[orderId]);
    return rows[0];
  };
  // Lectura: quien puede ver la orden (técnico asignado, administración, coordinación o el cliente si está compartida).
  app.get('/api/orders/:id/signature',/** @param {import('./http-contracts.js').PortalRequest} req @param {import('./http-contracts.js').PortalResponse<import('./http-contracts.js').SignatureReply>} res */ async (req,res) => {
    const order = permitted(await readOrder(pool,req.params.id),req.actor);
    const row = await latest(pool,order.id);
    res.json({ signature:row ? present(row,req.actor) : null });
  });
  // Escritura: mismas reglas que las evidencias. Orden abierta: técnico asignado o administración;
  // orden completada: solo administración o coordinación, con motivo en la bitácora.
  app.post('/api/orders/:id/signature',/** @param {import('./http-contracts.js').PortalRequest<import('./http-contracts.js').SignatureBody>} req @param {import('./http-contracts.js').PortalResponse<import('./http-contracts.js').SignatureReply>} res */ async (req,res) => {
    if (!['Administrador','Coordinador','Técnico'].includes(req.actor.rol)) throw fail(403,'La firma la registra administración o el técnico asignado.');
    const body = req.body ?? {};
    const initialOrder = permitted(await readOrder(pool,req.params.id),req.actor,true);
    evidenceReason(initialOrder,body.reason);
    const signer = signerName(body.signer), file = await decodeSignature(body,signer);
    /** @type {import('./contracts.js').AttachmentMetadata[]} */
    const prior = await select(pool,'SELECT id,order_id,category,sha256 FROM em_attachments WHERE request_id=?',[file.requestId]);
    if (prior.length && (prior[0].order_id !== initialOrder.id || prior[0].sha256 !== file.sha256 || prior[0].category !== 'Firma')) throw fail(409,'El identificador del envío ya pertenece a otro archivo.');
    const stored = prior.length ? undefined : await storage.prepare(file.bytes,file.mime);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction(); await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE');
      const order = permitted(await readOrder(conn,req.params.id),req.actor,true);
      /** @type {import('./contracts.js').AttachmentMetadata[]} */
      const existing = await select(conn,'SELECT id,order_id,category,sha256 FROM em_attachments WHERE request_id=?',[file.requestId]);
      if (existing.length) {
        // Reintento del mismo envío: devuelve la firma ya guardada, sin duplicarla.
        if (existing[0].order_id !== order.id || existing[0].sha256 !== file.sha256 || existing[0].category !== 'Firma') throw fail(409,'El identificador del envío ya pertenece a otro archivo.');
        await conn.commit(); const row = await latest(pool,order.id); return res.json({ signature:row ? present(row,req.actor) : null });
      }
      /** @type {{n:number}[]} */
      const count = await select(conn,"SELECT COUNT(*) AS n FROM em_attachments WHERE order_id=? AND category='Firma'",[order.id]);
      if (Number(count[0].n) >= SIGNATURES_PER_ORDER) throw fail(400,`La orden admite hasta ${SIGNATURES_PER_ORDER} firmas. Pide a coordinación que revise la orden.`);
      const id = randomUUID(), created = Date.now(), prepared = stored ?? await storage.prepare(file.bytes,file.mime);
      await conn.execute('INSERT INTO em_attachments (id,order_id,request_id,category,name,mime,size,sha256,uploaded_by,created_at,content,storage_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[id,order.id,file.requestId,'Firma',file.name,file.mime,file.bytes.length,file.sha256,req.actor.id,created,prepared.content,prepared.storage_key]);
      await auditEvidence(conn,req.actor,order,id,file.name,body.reason,actions);
      await conn.commit();
      res.status(201).json({ signature:present({ id, name:file.name, created_at:created, captured_by:req.actor.nombre },req.actor) });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });
}
