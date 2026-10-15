import {appendAudit,auditSequence} from './audit-storage.mjs';
import { select, selectQuery } from './sql.mjs';
import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { filterVisible } from './generated/domain.mjs';
import { manifestPage } from './attachment-batches.mjs';
import { authorizeTicketEvidence } from './ticket-evidence-access.mjs';
import { localFiles } from './file-storage.mjs';
import {videoRange} from './video-range.mjs';
import {VIDEO_MAX_BYTES} from './video-validation.mjs';
/** @param {number} status @param {string} message */
const fail =(status,message)=>Object.assign(new Error(message),{status,expose:true});
const fields='id,order_id,ticket_id,category,name,mime,size,sha256,uploaded_by,created_at';
/** @param {import("./http-contracts.js").AttachmentBody|undefined} body @param {boolean} [allowVideo] */
export function decodeAttachment(body,allowVideo=false) {
  if(!body || typeof body.category!=='string' || !['Antes','Después','Documento','Solicitud','Firma'].includes(body.category) || typeof body.requestId!=='string' || !/^[a-f0-9-]{36}$/i.test(body.requestId)) throw fail(400,'Adjunto inválido.');
  const name=String(body.name || '').trim();
  if(!name || name.length>160 || /[\x00-\x1f]/.test(name)) throw fail(400,'Nombre de archivo inválido.');
  const max=allowVideo?VIDEO_MAX_BYTES:4*1024*1024;
  if(typeof body.base64!=='string' || body.base64.length>Math.ceil(max/3)*4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) throw fail(400,'Archivo inválido o mayor al límite permitido.');
  const bytes=Buffer.from(body.base64,'base64');
  if(bytes.length<12 || bytes.length>max || bytes.toString('base64')!==body.base64) throw fail(400,'Archivo inválido o mayor al límite permitido.');
  let mime;
  if(bytes.subarray(0,3).equals(Buffer.from([255,216,255]))) mime='image/jpeg';
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime='image/png';
  if(bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP') mime='image/webp';
  if(bytes.subarray(0,5).toString()==='%PDF-' && body.category==='Documento') mime='application/pdf';
  if(allowVideo&&bytes.subarray(4,8).toString()==='ftyp'&&body.category!=='Documento')mime='video/mp4';
  if(mime!=='video/mp4'&&bytes.length>4*1024*1024)throw fail(400,'La fotografía o documento supera 4 MB.');
  if(!mime) throw fail(400,'Usa JPG, PNG, WebP o un documento PDF.');
  if(body.category==='Firma'&&mime!=='image/png') throw fail(400,'La firma debe ser una imagen PNG.');
  return {name,bytes,mime,requestId:body.requestId,category:body.category,sha256:createHash('sha256').update(bytes).digest('hex')};
}
/** @param {import("../src/domain/model.js").EntityRecord|undefined} order @param {import("../src/domain/model.js").Actor} actor @param {boolean} [write] */
export function permitted(order,actor,write=false) {
  if(!order || !filterVisible(actor,'OrdenServicio',[order]).length) throw fail(404,'Orden o archivo no disponible.');
  if(write && (order.schema_operacion!==1 || order.importado===true || order.estado==='Cancelada' || order.estado==='Completada'&&!['Administrador','Coordinador'].includes(actor.rol) || !['Administrador','Coordinador','Técnico'].includes(actor.rol))) throw fail(403,'Los adjuntos se agregan a órdenes abiertas por administración o el técnico asignado.');
  return order;
}
/** @param {import('../src/domain/model.js').EntityRecord} order @param {unknown} reason */
export function evidenceReason(order,reason) {
  if(order.estado==='Completada'&&(typeof reason!=='string'||reason.trim().length<8||reason.trim().length>500))throw fail(400,'Explica el motivo de la evidencia posterior al cierre (8 a 500 caracteres).');
}
/** @param {import('mysql2/promise').PoolConnection} conn @param {import('../src/domain/model.js').Actor} actor @param {import('../src/domain/model.js').EntityRecord} order @param {string} fileId @param {string} name @param {unknown} reason @param {{open:string,closed:string}} [actions] */
export async function auditEvidence(conn,actor,order,fileId,name,reason,actions={open:'Evidencia agregada',closed:'Evidencia posterior al cierre'}) {
  evidenceReason(order,reason);const id=randomUUID(),now=new Date().toISOString();
  const row={id,codigo:'LOG-'+String(await auditSequence(conn)+1).padStart(3,'0'),creado_por:actor.id,actualizado_por:actor.id,fecha_creacion:now,fecha_actualizacion:now,entidad:'OrdenServicio',accion:order.estado==='Completada'?actions.closed:actions.open,detalle:order.codigo+' · '+name,orden_id:order.id,equipo_id:order.equipo_id,archivo_id:fileId,motivo:typeof reason==='string'?reason.trim():'',registrado_por:actor.nombre,registrado_rol:actor.rol};
  await appendAudit(conn,[{id,payload:JSON.stringify(row)}]);
  await conn.execute('UPDATE em_meta SET revision=revision+1 WHERE id=1');
}
/** @param {import("./contracts.js").SqlConnection} pool @param {unknown} id */
export async function readOrder(pool,id) {
  if(typeof id!=='string' || !id || id.length>128) return undefined;
  /** @type {{payload:string}[]} */
    const rows = await select(pool,"SELECT payload FROM em_records WHERE entity='OrdenServicio' AND id=?",[id]);
  if(!rows[0]) return undefined;
  /** @type {import("../src/domain/model.js").EntityRecord} */
  const order=JSON.parse(rows[0].payload);
  return order.id===id?order:undefined;
}
/** @param {import("express").Express} app @param {{pool:import("mysql2/promise").Pool,files?:import('./file-storage.mjs').FileStore}} options */
export function registerAttachmentRoutes(app,{pool,files:storage=localFiles}) {
  app.get('/api/orders/:id/revisions',async(req,res)=>{
    if(!['Administrador','Coordinador'].includes(req.actor.rol))throw fail(403,'Solo administración y coordinación pueden revisar el historial.');
    const order=permitted(await readOrder(pool,req.params.id),req.actor);
    /** @type {{payload:string}[]} */
    const rows=await select(pool,"SELECT payload FROM em_audit_log WHERE entity='OrdenServicio' AND equipment_id=? AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.orden_id'))=? ORDER BY created_at DESC,id DESC LIMIT 100",[order.equipo_id,order.id]);
    res.json({events:rows.map(entry=>{const row=JSON.parse(entry.payload),before=JSON.parse(row.version_anterior||'{}'),after=JSON.parse(row.version_nueva||'{}');
      const keys=['sintoma','diagnostico','causa_confirmada','trabajo_realizado','recomendaciones','pruebas_realizadas','resultado_pruebas','recibido_por','notas_seguridad','insumos','repuestos','fecha_fin','visible_cliente'];
      return {id:row.id,action:row.accion,date:row.fecha_creacion,actor:row.registrado_por,reason:row.motivo,previous:row.estado_anterior,next:row.estado_nuevo,changes:keys.filter(key=>before[key]!==after[key]).map(key=>({field:key,before:before[key]??'',after:after[key]??''}))};})});
  });
  app.get('/api/attachments',/** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").AttachmentBody>} req @param {import("./http-contracts.js").PortalResponse<import("./http-contracts.js").AttachmentReply|Buffer>} res */ async (req,res)=>{
    const id=String(req.query.orderId || ''); permitted(await readOrder(pool,id),req.actor);
    /** @type {Omit<import("./contracts.js").AttachmentMetadata,"request_id">[]} */
    // La firma de quien recibe se muestra en el reporte, no como evidencia ni en el anexo de fotos.
    const files = await select(pool,`SELECT ${fields} FROM em_attachments WHERE order_id=? AND category<>'Firma' ORDER BY created_at,id`,[id]); res.json({files});
  });
  app.get('/api/attachments/:id/file',/** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").AttachmentBody>} req @param {import("./http-contracts.js").PortalResponse<import("./http-contracts.js").AttachmentReply|Buffer>} res */ async (req,res)=>{
    /** @type {Omit<import("./contracts.js").AttachmentMetadata,"request_id">[]} */
    const rows = await select(pool,`SELECT ${fields} FROM em_attachments WHERE id=?`,[req.params.id]); const file=rows[0];
    if(!file) throw fail(404,'Archivo no disponible.');
    if(file.ticket_id) await authorizeTicketEvidence(pool,req.actor,file.ticket_id,req.query.orderId);
    else permitted(await readOrder(pool,file.order_id),req.actor);
    /** @type {{content:Buffer,storage_key:string|null}[]} */
    const contents = await select(pool,'SELECT content,storage_key FROM em_attachments WHERE id=?',[file.id]);
    if(!contents[0]) throw fail(404,'Archivo no disponible.');
    res.set('Content-Disposition',`${file.mime==='application/pdf'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    if(file.mime==='video/mp4'){
      // The browser's standalone media document must load its own authenticated URL.
      res.set('Content-Security-Policy',"default-src 'none'; media-src 'self'; frame-ancestors 'self'");
      const range=videoRange(req.get('range'),Number(file.size));res.set('Accept-Ranges','bytes');
      if(range===false)return res.status(416).set('Content-Range',`bytes */${file.size}`).end();
      if(range){
        const stored={...contents[0],sha256:file.sha256,size:Number(file.size)};
        const bytes=storage.range?await storage.range(pool,stored,range.start,range.end):(await storage.read(pool,stored)).subarray(range.start,range.end+1);
        return res.status(206).set('Content-Range',`bytes ${range.start}-${range.end}/${file.size}`).type(file.mime).send(bytes);
      }
    }
    const bytes=await storage.read(pool,{...contents[0],sha256:file.sha256,size:Number(file.size)});
    if(file.mime!=='video/mp4')res.set('Content-Security-Policy',"default-src 'none'; sandbox");res.type(file.mime).send(bytes);
  });
  app.post('/api/attachments',(req,_res,next)=>{
    if(!['Administrador','Coordinador','Técnico'].includes(req.actor.rol)) return next(fail(403,'Los adjuntos se agregan por administración o el técnico asignado.'));
    next();
  },express.json({limit:'6mb'}),/** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").AttachmentBody>} req @param {import("./http-contracts.js").PortalResponse<import("./http-contracts.js").AttachmentReply|Buffer>} res */ async (req,res)=>{
    const initialOrder=permitted(await readOrder(pool,req.body?.orderId),req.actor,true);
    evidenceReason(initialOrder,req.body?.reason);
    const file=decodeAttachment(req.body);
    if(file.category==='Solicitud') throw fail(400,'La evidencia inicial se agrega desde la solicitud.');
    if(file.category==='Firma') throw fail(400,'La firma se guarda desde «Pedir firma» en la orden.');
    /** @type {import('./contracts.js').AttachmentMetadata[]} */
    const prior=await select(pool,`SELECT ${fields} FROM em_attachments WHERE request_id=?`,[file.requestId]);
    if(prior.length){
      if(prior[0].order_id!==req.body.orderId||prior[0].sha256!==file.sha256||prior[0].category!==file.category)throw fail(409,'El identificador del envío ya pertenece a otro archivo.');
      return res.json({file:prior[0]});
    }
    /** @type {{n:number}[]} */
    const totals=await select(pool,"SELECT COUNT(*) AS n FROM em_attachments WHERE order_id=? AND category<>'Firma'",[initialOrder.id]);
    if(Number(totals[0].n)>=20)throw fail(400,'La orden admite hasta 20 adjuntos.');
    const stored=await storage.prepare(file.bytes,file.mime);
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction(); await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE'); const order=permitted(await readOrder(conn,req.body?.orderId),req.actor,true);
      /** @type {Omit<import("./contracts.js").AttachmentMetadata,"request_id">[]} */
    const existing = await select(conn,`SELECT ${fields} FROM em_attachments WHERE request_id=?`,[file.requestId]);
      if(existing.length) {
        if(existing[0].order_id!==req.body.orderId || existing[0].sha256!==file.sha256 || existing[0].category!==req.body.category) throw fail(409,'El identificador del envío ya pertenece a otro archivo.');
        await conn.commit();return res.json({file:existing[0]});
      }
      /** @type {{n:number}[]} */
    const count = await select(conn,"SELECT COUNT(*) AS n FROM em_attachments WHERE order_id=? AND category<>'Firma'",[order.id]);
      if(Number(count[0].n)>=20) throw fail(400,'La orden admite hasta 20 adjuntos.');
      const id=randomUUID(),created=Date.now();
      await conn.execute('INSERT INTO em_attachments (id,order_id,request_id,category,name,mime,size,sha256,uploaded_by,created_at,content,storage_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[id,order.id,file.requestId,file.category,file.name,file.mime,file.bytes.length,file.sha256,req.actor.id,created,stored.content,stored.storage_key]);
      await auditEvidence(conn,req.actor,order,id,file.name,req.body?.reason);
      await conn.commit();res.status(201).json({file:{id,order_id:order.id,category:file.category,name:file.name,mime:file.mime,size:file.bytes.length,created_at:created}});
    } catch(error){await conn.rollback();throw error;}finally{conn.release();}
  });
  app.get('/api/admin/attachments-manifest',/** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").AttachmentBody>} req @param {import("./http-contracts.js").PortalResponse<import("./http-contracts.js").AttachmentReply|Buffer>} res */ async (req,res)=>{
    if(req.actor.rol!=='Administrador') throw fail(403,'Solo administración puede respaldar archivos.');
    const page=manifestPage(req.query);
    if(!page){
    /** @type {Omit<import("./contracts.js").AttachmentMetadata,"request_id">[]} */
    const files = await selectQuery(pool,`SELECT ${fields} FROM em_attachments ORDER BY created_at,id`);return res.json({files});}
    /** @type {Omit<import("./contracts.js").AttachmentMetadata,"request_id">[]} */
    const files = await select(pool,`SELECT ${fields} FROM em_attachments ${page.cursor?'WHERE created_at>? OR (created_at=? AND id>?)':''} ORDER BY created_at,id LIMIT ${page.limit+1}`,page.cursor?[page.cursor[0],page.cursor[0],page.cursor[1]]:[]);
    const more=files.length>page.limit,rows=files.slice(0,page.limit),last=rows[rows.length-1];
    res.json({files:rows,nextCursor:more?Buffer.from(JSON.stringify([Number(last.created_at),last.id])).toString('base64url'):null});
  });
}
