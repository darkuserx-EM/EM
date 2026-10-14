import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { registerAttachmentRoutes } from './attachments.mjs';

test('lectura de adjuntos usa sólo la orden y autoriza antes de cargar el binario', async t => {
  const queries = [];
  const order = { id:'order-a', cliente_id:'client-a', tecnico_id:'tech-a', visible_cliente:true, schema_operacion:1, estado:'En proceso' };
  const file = { id:'file-a', order_id:'order-a', mime:'image/png', name:'evidencia.png', category:'Antes', size:12 };
  const bytes = Buffer.from('private-image');
  const pool = {
    async execute(sql, args) {
      queries.push(sql);
      if (sql.startsWith("SELECT payload FROM em_records WHERE entity='OrdenServicio'")) return [[{ payload:JSON.stringify(order) }]];
      if (sql === 'SELECT content,storage_key FROM em_attachments WHERE id=?') return [[{content:bytes,storage_key:null}]];
      if (sql.startsWith('SELECT id,order_id') && args[0]) return [[file]];
      throw new Error(`Unexpected broad read: ${sql}`);
    },
    async query() { throw new Error('No se debe consultar la base completa.'); },
    async getConnection() { throw new Error('Los GET no deben abrir un snapshot de la base.'); },
  };
  const app=express();
  app.use((req,_res,next)=>{req.actor={id:'test',nombre:'Test',rol:req.get('x-role')||'Cliente',cliente_id:req.get('x-client')||'client-a'};next();});
  registerAttachmentRoutes(app,{pool});
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const url=`http://127.0.0.1:${server.address().port}`;
  const list=await fetch(`${url}/api/attachments?orderId=order-a`);assert.equal(list.status,200);assert.equal((await list.json()).files.length,1);
  assert.equal(queries.filter(sql=>sql.includes('SELECT content')).length,0);
  const hidden=await fetch(`${url}/api/attachments/file-a/file`,{headers:{'x-client':'client-b'}});assert.equal(hidden.status,404);
  assert.equal(queries.filter(sql=>sql.includes('SELECT content')).length,0);
  const visible=await fetch(`${url}/api/attachments/file-a/file`);assert.equal(visible.status,200);assert.deepEqual(Buffer.from(await visible.arrayBuffer()),bytes);
  assert.equal(queries.filter(sql=>sql.includes('SELECT content')).length,1);
  // Invalid JSON would return 400 if the upload parser ran before checking this role.
  const forbidden=await fetch(`${url}/api/attachments`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{invalid JSON'});assert.equal(forbidden.status,403);
});
