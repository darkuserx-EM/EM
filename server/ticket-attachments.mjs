import express from 'express';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { select } from './sql.mjs';
import { decodeAttachment } from './attachments.mjs';
import { authorizeTicketEvidence } from './ticket-evidence-access.mjs';

/** @param {number} status @param {string} message */
const fail = (status,message) => Object.assign(new Error(message),{status,expose:true});
const fields = 'id,order_id,ticket_id,category,name,mime,size,sha256,uploaded_by,created_at';

/** @param {import('express').Express} app @param {{pool:import('mysql2/promise').Pool}} options */
export function registerTicketAttachmentRoutes(app,{pool}) {
  app.get('/api/ticket-attachments',async (req,res) => {
    const ticket = await authorizeTicketEvidence(pool,req.actor,req.query.ticketId,req.query.orderId);
    const files = await select(pool,`SELECT ${fields} FROM em_attachments WHERE ticket_id=? ORDER BY created_at,id`,[ticket.id]);
    res.json({files});
  });
  app.post('/api/ticket-attachments',(req,_res,next) => {
    if (!['Administrador','Coordinador','Cliente'].includes(req.actor.rol)) return next(fail(403,'La evidencia inicial la registra el cliente o coordinación.'));
    next();
  },express.json({limit:'6mb'}),/** @param {import('./http-contracts.js').PortalRequest<import('./http-contracts.js').AttachmentBody>} req */ async (req,res) => {
    // Authorize before decoding; repeat inside the transaction before persisting.
    await authorizeTicketEvidence(pool,req.actor,req.body?.ticketId);
    const file = decodeAttachment({...req.body,category:'Solicitud'});
    try {
      // Decode actual pixels too, not just an extension, declared MIME or file signature.
      const image = sharp(file.bytes,{limitInputPixels:40_000_000,animated:true});
      const metadata = await image.metadata();
      if ((metadata.pages || 1) !== 1) throw Error('Animated image');
      await image.stats();
    } catch { throw fail(400,'La fotografía no se puede abrir. Usa una imagen JPG, PNG o WebP válida de hasta 40 megapíxeles.'); }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE');
      const ticket = await authorizeTicketEvidence(conn,req.actor,req.body.ticketId);
      /** @type {import('./contracts.js').AttachmentMetadata[]} */
      const previous = await select(conn,`SELECT ${fields} FROM em_attachments WHERE request_id=?`,[file.requestId]);
      if (previous.length) {
        if (previous[0].ticket_id !== ticket.id || previous[0].sha256 !== file.sha256) throw fail(409,'El identificador del envío ya pertenece a otra fotografía.');
        await conn.commit(); return res.json({file:previous[0]});
      }
      if (ticket.schema_operacion !== 1 || ['Resuelto','Cancelado'].includes(String(ticket.estado))) throw fail(409,'La solicitud está cerrada o es histórica; sus fotografías se conservan.');
      /** @type {import('./contracts.js').AttachmentMetadata[]} */
      const identical = await select(conn,`SELECT ${fields} FROM em_attachments WHERE ticket_id=? AND sha256=? LIMIT 1`,[ticket.id,file.sha256]);
      if (identical.length) { await conn.commit(); return res.json({file:identical[0]}); }
      /** @type {{n:number}[]} */
      const count = await select(conn,'SELECT COUNT(*) AS n FROM em_attachments WHERE ticket_id=?',[ticket.id]);
      if (Number(count[0].n) >= 10) throw fail(400,'La solicitud admite hasta 10 fotografías.');
      const id = randomUUID(), created = Date.now();
      await conn.execute('INSERT INTO em_attachments (id,order_id,ticket_id,request_id,category,name,mime,size,sha256,uploaded_by,created_at,content) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[id,'',ticket.id,file.requestId,'Solicitud',file.name,file.mime,file.bytes.length,file.sha256,req.actor.id,created,file.bytes]);
      await conn.execute('INSERT INTO em_security_events (id,actor_id,target_id,action,created_at) VALUES (?,?,?,?,?)',[randomUUID(),req.actor.id,id,'ticket.photo.added',created]);
      await conn.commit();
      res.status(201).json({file:{id,ticket_id:ticket.id,category:'Solicitud',name:file.name,mime:file.mime,size:file.bytes.length,created_at:created}});
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });
}
