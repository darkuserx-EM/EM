import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { filterVisible } from './generated/domain.mjs';
import { manifestPage } from './attachment-batches.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status,expose:true});
const fields='id,order_id,category,name,mime,size,sha256,uploaded_by,created_at';
export function decodeAttachment(body) {
  if(!body || !['Antes','Después','Documento'].includes(body.category) || !/^[a-f0-9-]{36}$/i.test(body.requestId || '')) throw fail(400,'Adjunto inválido.');
  const name=String(body.name || '').trim();
  if(!name || name.length>160 || /[\x00-\x1f]/.test(name)) throw fail(400,'Nombre de archivo inválido.');
  if(typeof body.base64!=='string' || body.base64.length>5592408 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) throw fail(400,'Archivo inválido o mayor a 4 MB.');
  const bytes=Buffer.from(body.base64,'base64');
  if(bytes.length<12 || bytes.length>4*1024*1024 || bytes.toString('base64')!==body.base64) throw fail(400,'Archivo inválido o mayor a 4 MB.');
  let mime;
  if(bytes.subarray(0,3).equals(Buffer.from([255,216,255]))) mime='image/jpeg';
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime='image/png';
  if(bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP') mime='image/webp';
  if(bytes.subarray(0,5).toString()==='%PDF-' && body.category==='Documento') mime='application/pdf';
  if(!mime) throw fail(400,'Usa JPG, PNG, WebP o un documento PDF.');
  return {name,bytes,mime,sha256:createHash('sha256').update(bytes).digest('hex')};
}
function permitted(order,actor,write=false) {
  if(!order || !filterVisible(actor,'OrdenServicio',[order]).length) throw fail(404,'Orden o archivo no disponible.');
  if(write && (order.schema_operacion!==1 || ['Completada','Cancelada'].includes(order.estado) || !['Administrador','Técnico'].includes(actor.rol))) throw fail(403,'Los adjuntos se agregan a órdenes abiertas por administración o el técnico asignado.');
  return order;
}
async function readOrder(pool,id) {
  if(typeof id!=='string' || !id || id.length>128) return undefined;
  const [rows]=await pool.execute("SELECT payload FROM em_records WHERE entity='OrdenServicio' AND id=?",[id]);
  if(!rows[0]) return undefined;
  const order=JSON.parse(rows[0].payload);
  return order.id===id?order:undefined;
}
export function registerAttachmentRoutes(app,{pool}) {
  app.get('/api/attachments',async(req,res)=>{
    const id=String(req.query.orderId || ''); permitted(await readOrder(pool,id),req.actor);
    const [files]=await pool.execute(`SELECT ${fields} FROM em_attachments WHERE order_id=? ORDER BY created_at,id`,[id]); res.json({files});
  });
  app.get('/api/attachments/:id/file',async(req,res)=>{
    const [rows]=await pool.execute(`SELECT ${fields} FROM em_attachments WHERE id=?`,[req.params.id]); const file=rows[0];
    if(!file) throw fail(404,'Archivo no disponible.'); permitted(await readOrder(pool,file.order_id),req.actor);
    const [contents]=await pool.execute('SELECT content FROM em_attachments WHERE id=?',[file.id]);
    if(!contents[0]) throw fail(404,'Archivo no disponible.');
    res.set('Content-Disposition',`${file.mime==='application/pdf'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.set('Content-Security-Policy',"default-src 'none'; sandbox");res.type(file.mime).send(contents[0].content);
  });
  app.post('/api/attachments',(req,_res,next)=>{
    if(!['Administrador','Técnico'].includes(req.actor.rol)) return next(fail(403,'Los adjuntos se agregan por administración o el técnico asignado.'));
    next();
  },express.json({limit:'6mb'}),async(req,res)=>{
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction(); await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE'); permitted(await readOrder(conn,req.body?.orderId),req.actor,true);
      const file=decodeAttachment(req.body);
      const [existing]=await conn.execute(`SELECT ${fields} FROM em_attachments WHERE request_id=?`,[req.body.requestId]);
      if(existing.length) {
        if(existing[0].order_id!==req.body.orderId || existing[0].sha256!==file.sha256 || existing[0].category!==req.body.category) throw fail(409,'El identificador del envío ya pertenece a otro archivo.');
        await conn.commit();return res.json({file:existing[0]});
      }
      const [count]=await conn.execute('SELECT COUNT(*) AS n FROM em_attachments WHERE order_id=?',[req.body.orderId]);
      if(Number(count[0].n)>=20) throw fail(400,'La orden admite hasta 20 adjuntos.');
      const id=randomUUID(),created=Date.now();
      await conn.execute('INSERT INTO em_attachments (id,order_id,request_id,category,name,mime,size,sha256,uploaded_by,created_at,content) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[id,req.body.orderId,req.body.requestId,req.body.category,file.name,file.mime,file.bytes.length,file.sha256,req.actor.id,created,file.bytes]);
      await conn.commit();res.status(201).json({file:{id,order_id:req.body.orderId,category:req.body.category,name:file.name,mime:file.mime,size:file.bytes.length,created_at:created}});
    } catch(error){await conn.rollback();throw error;}finally{conn.release();}
  });
  app.get('/api/admin/attachments-manifest',async(req,res)=>{
    if(req.actor.rol!=='Administrador') throw fail(403,'Solo administración puede respaldar archivos.');
    const page=manifestPage(req.query);
    if(!page){const [files]=await pool.query(`SELECT ${fields} FROM em_attachments ORDER BY created_at,id`);return res.json({files});}
    const [files]=await pool.execute(`SELECT ${fields} FROM em_attachments ${page.cursor?'WHERE created_at>? OR (created_at=? AND id>?)':''} ORDER BY created_at,id LIMIT ${page.limit+1}`,page.cursor?[page.cursor[0],page.cursor[0],page.cursor[1]]:[]);
    const more=files.length>page.limit,rows=files.slice(0,page.limit),last=rows.at(-1);
    res.json({files:rows,nextCursor:more?Buffer.from(JSON.stringify([Number(last.created_at),last.id])).toString('base64url'):null});
  });
}
