import express from 'express';
import {randomUUID} from 'node:crypto';
import {select,change} from './sql.mjs';
import {authorizeTicketEvidence} from './ticket-evidence-access.mjs';
import {permitted,readOrder} from './attachments.mjs';
import {VIDEO_MAX_BYTES,VIDEO_CHUNK_BYTES,validateVideo} from './video-validation.mjs';

/** @typedef {{id:string,actor_id:string,target_kind:string,target_id:string,category:string,name:string,size:number,sha256:string,file_id:string|null,location:string|null,lease_until:number,created_at:number}} Upload */
/** @typedef {{requestId?:unknown,ticketId?:unknown,orderId?:unknown,category?:unknown,name?:unknown,size?:unknown,sha256?:unknown}} VideoInput */
/** @param {number} status @param {string} message */
const fail=(status,message)=>Object.assign(new Error(message),{status,expose:true});
const fields='id,order_id,ticket_id,category,name,mime,size,sha256,uploaded_by,created_at';
/** @param {import('./contracts.js').SqlConnection} conn @param {import('../src/domain/model.js').Actor} actor @param {Pick<Upload,'target_kind'|'target_id'>} upload @param {boolean} [write] */
async function authorize(conn,actor,upload,write=true) {
  if(upload.target_kind==='order')return permitted(await readOrder(conn,upload.target_id),actor,write);
  const ticket=await authorizeTicketEvidence(conn,actor,upload.target_id);
  if(write&&(!['Administrador','Coordinador','Cliente'].includes(actor.rol)||ticket.schema_operacion!==1||['Resuelto','Cancelado'].includes(String(ticket.estado))))throw fail(403,'El cliente o coordinación pueden adjuntar archivos a solicitudes abiertas.');
  return ticket;
}
/** @param {import('express').Express} app @param {{pool:import('mysql2/promise').Pool,files:import('./file-storage.mjs').FileStore}} options */
export function registerVideoRoutes(app,{pool,files}) {
  let verifying=0;
  /** @param {import('./http-contracts.js').PortalRequest} req */
  async function owned(req) {
    if(!files.enabled||!files.video)throw fail(503,'Los videos requieren la conexión privada con Google Drive.');
    /** @type {Upload[]} */const rows=await select(pool,'SELECT * FROM em_video_uploads WHERE id=? AND actor_id=?',[req.params.id,req.actor.id]);const row=rows[0];
    if(!row)throw fail(404,'Carga no disponible.');
    if(Number(row.created_at)<Date.now()-24*3600000)throw fail(410,'La carga venció. Selecciona nuevamente el video.');
    await authorize(pool,req.actor,row);return row;
  }
  /** @template T @param {Upload} row @param {()=>Promise<T>} operation */
  async function exclusive(row,operation) {
    // A per-upload expiring lease, never a global SQL lock during Google requests.
    const lease=Date.now()+5*60000;
    const claimed=await change(pool,'UPDATE em_video_uploads SET lease_until=? WHERE id=? AND lease_until<?',[lease,row.id,Date.now()]);
    if(claimed.affectedRows!==1)throw fail(409,'Este video tiene un envío en curso. Espera unos segundos y reintenta.');
    try{return await operation();}finally{await pool.execute('UPDATE em_video_uploads SET lease_until=0 WHERE id=? AND lease_until=?',[row.id,lease]);}
  }
  app.post('/api/videos/start',/** @param {import('./http-contracts.js').PortalRequest<VideoInput>} req */async(req,res)=>{
    if(!files.enabled||!files.video)throw fail(503,'Los videos requieren Google Drive.');
    const b=req.body;
    if(typeof b?.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(b.requestId)||typeof b.name!=='string'||!b.name.trim()||b.name.length>160||/[\x00-\x1f]/.test(b.name)||typeof b.size!=='number'||!Number.isSafeInteger(b.size)||b.size<32||b.size>VIDEO_MAX_BYTES||typeof b.sha256!=='string'||!/^[a-f0-9]{64}$/.test(b.sha256)||Boolean(b.ticketId)===Boolean(b.orderId))throw fail(400,'Video inválido. Usa MP4 de hasta 25 MB y 60 segundos.');
    const target=b.ticketId||b.orderId;
    if(typeof target!=='string'||target.length>128||!target)throw fail(400,'Registro inválido.');
    const category=b.ticketId?'Solicitud':b.category;if(typeof category!=='string'||!['Solicitud','Antes','Después'].includes(category)||(!b.ticketId&&category==='Solicitud'))throw fail(400,'Elige Antes o Después para el video de la orden.');
    const row={id:b.requestId,actor_id:req.actor.id,target_kind:b.ticketId?'ticket':'order',target_id:target,category,name:b.name.trim(),size:b.size,sha256:b.sha256,file_id:null,location:null,lease_until:0,created_at:Date.now()};
    await authorize(pool,req.actor,row,false);
    /** @type {import('./contracts.js').AttachmentMetadata[]} */const prior=await select(pool,`SELECT ${fields} FROM em_attachments WHERE request_id=?`,[row.id]);
    if(prior.length){const f=prior[0];if((f.ticket_id||f.order_id)!==target||f.sha256!==row.sha256||f.category!==category)throw fail(409,'El envío pertenece a otro archivo.');return res.json({offset:row.size,file:f});}
    await authorize(pool,req.actor,row);
    /** @type {{n:number}[]} */const capacity=await select(pool,`SELECT COUNT(*) AS n FROM em_attachments WHERE ${row.target_kind==='ticket'?'ticket_id':'order_id'}=?`,[row.target_id]);
    if(Number(capacity[0].n)>=(row.target_kind==='ticket'?10:20))throw fail(400,'El registro alcanzó su límite de adjuntos.');
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction();await conn.execute('SELECT id FROM em_users WHERE id=? FOR UPDATE',[req.actor.id]);
      /** @type {{n:number}[]} */const count=await select(conn,'SELECT COUNT(*) AS n FROM em_video_uploads WHERE actor_id=? AND created_at>? AND id<>?',[req.actor.id,Date.now()-24*3600000,row.id]);
      if(Number(count[0].n)>=10)throw fail(429,'Tienes 10 cargas pendientes. Termina una o vuelve a intentarlo mañana.');
      await conn.execute('INSERT IGNORE INTO em_video_uploads (id,actor_id,target_kind,target_id,category,name,size,sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[row.id,row.actor_id,row.target_kind,row.target_id,row.category,row.name,row.size,row.sha256,row.created_at]);await conn.commit();
    }catch(error){await conn.rollback();throw error;}finally{conn.release();}
    /** @type {Upload[]} */const existing=await select(pool,'SELECT * FROM em_video_uploads WHERE id=?',[row.id]);const current=existing[0];
    if(!current||['actor_id','target_kind','target_id','category','name','size','sha256'].some(key=>String(current[/** @type {keyof Upload} */(key)])!==String(row[/** @type {keyof typeof row} */(key)])))throw fail(409,'El envío pertenece a otro archivo.');
    if(Number(current.created_at)<Date.now()-24*3600000)throw fail(410,'La carga venció. Selecciona nuevamente el video.');
    const video=files.video;
    const offset=await exclusive(current,async()=>{
      const position=current.file_id?await video.progress(current.file_id,current.location||'',Number(current.size),current.sha256):-1;
      if(position>=0)return position;
      const started=await video.start(current.sha256,Number(current.size));
      await pool.execute('UPDATE em_video_uploads SET file_id=?,location=? WHERE id=?',[started.fileId,started.location,row.id]);return started.offset;
    });res.json({offset,chunkSize:VIDEO_CHUNK_BYTES});
  });
  app.post('/api/videos/:id/chunk',async(req,_res,next)=>{await owned(req);next();},express.raw({type:'application/octet-stream',limit:VIDEO_CHUNK_BYTES}),/** @param {import('./http-contracts.js').PortalRequest<Buffer>} req */async(req,res)=>{
    const row=await owned(req),offset=Number(req.query.offset),bytes=req.body,video=files.video;
    if(!video||!row.file_id||!row.location||!Buffer.isBuffer(bytes)||!Number.isSafeInteger(offset)||offset<0||offset%262144||!bytes.length||bytes.length>VIDEO_CHUNK_BYTES||offset+bytes.length>Number(row.size)||(offset+bytes.length<Number(row.size)&&bytes.length%262144))throw fail(400,'Bloque de video inválido.');
    const next=await exclusive(row,async()=>{
      const current=await video.progress(row.file_id||'',row.location||'',Number(row.size),row.sha256);
      if(current<0)throw fail(410,'La carga venció. Reintenta desde el archivo original.');
      if(current!==offset)return current;
      return video.chunk(row.location||'',offset,Number(row.size),bytes);
    });if(next<0)throw fail(410,'La carga venció. Reintenta desde el archivo original.');res.json({offset:next});
  });
  app.post('/api/videos/:id/finish',async(req,res)=>{
    const row=await owned(req),video=files.video;if(!video||!row.file_id)throw fail(409,'Falta iniciar la carga.');
    const result=await exclusive(row,async()=>{
      if(verifying>=2)throw fail(429,'Hay videos verificándose. Espera unos segundos y reintenta; las partes recibidas se conservan.');
      verifying++;
      try {
      if(await video.progress(row.file_id||'',row.location||'',Number(row.size),row.sha256)!==Number(row.size))throw fail(409,'Faltan partes del video. Reintenta su envío.');
      const bytes=await video.get(row.file_id||'',Number(row.size),row.sha256);await validateVideo(bytes);
      const stored=await files.prepare(bytes,'video/mp4');
      const conn=await pool.getConnection();
      try {
        await conn.beginTransaction();await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE');await authorize(conn,req.actor,row);
        /** @type {import('./contracts.js').AttachmentMetadata[]} */const prior=await select(conn,`SELECT ${fields} FROM em_attachments WHERE request_id=? OR (${row.target_kind==='ticket'?'ticket_id':'order_id'}=? AND sha256=? AND category=?)`,[row.id,row.target_id,row.sha256,row.category]);
        if(prior.length){await conn.commit();return prior[0];}
        /** @type {{n:number}[]} */const counts=await select(conn,`SELECT COUNT(*) AS n FROM em_attachments WHERE ${row.target_kind==='ticket'?'ticket_id':'order_id'}=?`,[row.target_id]);
        if(Number(counts[0].n)>=(row.target_kind==='ticket'?10:20))throw fail(400,'El registro alcanzó su límite de adjuntos.');
        const file={id:randomUUID(),order_id:row.target_kind==='order'?row.target_id:'',ticket_id:row.target_kind==='ticket'?row.target_id:null,request_id:row.id,category:row.category,name:row.name,mime:'video/mp4',size:Number(row.size),sha256:row.sha256,uploaded_by:req.actor.id,created_at:Date.now()};
        await conn.execute('INSERT INTO em_attachments (id,order_id,ticket_id,request_id,category,name,mime,size,sha256,uploaded_by,created_at,content,storage_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[file.id,file.order_id,file.ticket_id,file.request_id,file.category,file.name,file.mime,file.size,file.sha256,file.uploaded_by,file.created_at,stored.content,stored.storage_key]);
        await conn.execute('INSERT INTO em_security_events (id,actor_id,target_id,action,created_at) VALUES (?,?,?,?,?)',[randomUUID(),req.actor.id,file.id,'video.added',Date.now()]);await conn.commit();return file;
      }catch(error){await conn.rollback();throw error;}finally{conn.release();}
      }finally{verifying--;}
    });
    await pool.execute('DELETE FROM em_video_uploads WHERE id=? AND actor_id=?',[row.id,req.actor.id]);res.status(201).json({file:result});
  });
}
