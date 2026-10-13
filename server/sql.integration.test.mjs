import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import {migrate} from './database.mjs';
import {createApp} from './app.mjs';
import {token} from './security.mjs';
import {attachmentBatches,attachmentFields} from './attachment-batches.mjs';

test('SQL: planes reales, lotes por bytes y permisos',{skip:process.env.MYSQL_INTEGRATION!=='1',timeout:180000},async t=>{
 const host=process.env.TEST_DB_HOST||'127.0.0.1';assert.ok(['127.0.0.1','localhost','::1'].includes(host));
 const config={host,port:Number(process.env.TEST_DB_PORT||3306),user:process.env.TEST_DB_USER||'root',password:process.env.TEST_DB_PASSWORD};assert.ok(config.password);
 const name='em_ci_'+randomUUID().replaceAll('-',''),control=await mysql.createConnection(config);await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
 const pool=mysql.createPool({...config,database:name});let server;
 t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await pool.end();assert.match(name,/^em_ci_[a-f0-9]{32}$/);await control.query(`DROP DATABASE ${name}`);await control.end();});
 await migrate(pool);const origin='http://localhost:3000',setupToken=token();server=createApp({pool,origin,setupToken,production:false}).listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}/api/`;let serial=1;
 async function call(path,body,s){const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Forwarded-For':`198.51.100.${serial++%240+1}`,...(s?{Cookie:s.cookie,'X-CSRF-Token':s.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),headers:r.headers};}
 const password='Clave sintética SQL extensa 2026!';assert.equal((await call('setup',{setupToken,email:'admin@example.invalid',name:'QA',password})).status,201);const login=await call('login',{email:'admin@example.invalid',password}),admin={cookie:login.headers.getSetCookie()[0].split(';')[0],csrf:''};admin.csrf=(await call('session',undefined,admin)).data.csrf;
 async function create(entity,fields){const revision=(await call('database',undefined,admin)).data.revision,r=await call('mutate',{revision,action:'create',entity,fields},admin);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.result;}
 const client=await create('Cliente',{nombre:'Cliente SQL sintético',estado:'Activo'}),equipment=await create('Equipo',{marca:'QA',modelo:'SQL',serie:'SYNTHETIC-SQL',tipo:'Reach',propiedad:'De cliente',estado:'Disponible',cliente_id:client.id}),order=await create('OrdenServicio',{equipo_id:equipment.id,cliente_id:client.id,sintoma:'Prueba SQL'});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp9sAAAAASUVORK5CYII=','base64'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const bytes=Buffer.concat([png,Buffer.alloc(1024)]),now=Date.now();
 for(let group=0;group<200;group++){
  const rows=Array.from({length:20},()=>[randomUUID(),'order-'+group,null,randomUUID(),'Antes','qa.png','image/png',bytes.length,sha(bytes),'qa',now,bytes]);
  await pool.query(`INSERT INTO em_attachments (${attachmentFields},content) VALUES ?`,[rows]);
 }
 const explain=async(sql,values=[])=>{const [rows]=await pool.execute('EXPLAIN '+sql,values);return rows.map(({type,key,rows,Extra})=>({type,key,rows,Extra}));};
 await t.test('índices idempotentes evitan ordenar las consultas acotadas con 4,000 adjuntos',async()=>{
  await pool.query('ALTER TABLE em_attachments DROP INDEX idx_attachment_order_created, DROP INDEX idx_attachment_created');
  const query=`SELECT ${attachmentFields} FROM em_attachments WHERE order_id=? ORDER BY created_at,id`,manifest=`SELECT ${attachmentFields} FROM em_attachments ORDER BY created_at,id LIMIT 101`;
  await pool.query('ANALYZE TABLE em_attachments');
  const before={order:await explain(query,['order-100']),manifest:await explain(manifest)};
  await migrate(pool);await migrate(pool);await pool.query('ANALYZE TABLE em_attachments');
  const after={order:await explain(query,['order-100']),manifest:await explain(manifest)};
  assert.ok(after.order.some(row=>row.key==='idx_attachment_order_created'));assert.ok(after.manifest.some(row=>row.key==='idx_attachment_created'));
  assert.ok([...after.order,...after.manifest].every(row=>!/filesort/i.test(row.Extra||'')));
  t.diagnostic(JSON.stringify({explain:{before,after}}));
 });
 await t.test('manifiesto paginado sin pérdidas ni duplicados cuando coinciden fechas; conserva contrato anterior',async()=>{
  assert.equal((await call('admin/attachments-manifest?limit=200')).status,401);
  for(const suffix of ['limit=0','limit=201','cursor=bad'])assert.equal((await call('admin/attachments-manifest?'+suffix,undefined,admin)).status,400);
  const ids=[];let cursor=null;
  do{const r=await call('admin/attachments-manifest?limit=200'+(cursor?'&cursor='+encodeURIComponent(cursor):''),undefined,admin);assert.equal(r.status,200);ids.push(...r.data.files.map(f=>f.id));cursor=r.data.nextCursor;}while(cursor);
  assert.equal(ids.length,4000);assert.equal(new Set(ids).size,4000);assert.equal((await call('admin/attachments-manifest',undefined,admin)).data.files.length,4000);
 });
 await t.test('respaldos agrupan archivos pequeños y limitan a 8 MiB los bytes binarios del lote',async()=>{
  const big=Buffer.concat([png,Buffer.alloc(4*1024*1024-png.length)]);
  for(let i=0;i<3;i++)await pool.execute(`INSERT INTO em_attachments (${attachmentFields},content) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,['00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),'big-order',null,randomUUID(),'Antes','large.png','image/png',big.length,sha(big),'qa',now,big]);
  const conn=await pool.getConnection();let queries=0,total=0,maximum=0;const ids=new Set();
  try{
   await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await conn.beginTransaction();
   const instrumented={execute:async(...args)=>{queries++;return conn.execute(...args);}};
   for await(const rows of attachmentBatches(instrumented)){
    const sum=rows.reduce((n,r)=>n+r.content.length,0);assert.ok(sum<=8*1024*1024);maximum=Math.max(maximum,sum);
    for(const row of rows){assert.equal(sha(row.content),row.sha256);assert.equal(row.content.length,row.size);ids.add(row.id);total++;}
   }
   assert.equal(maximum,8*1024*1024);assert.equal(total,4003);assert.equal(ids.size,total);assert.ok(queries<200,`queries=${queries}`);await conn.commit();
  }finally{conn.release();}
  t.diagnostic(JSON.stringify({backup:{files:total,queries,previousQueries:total+1,maxBinaryBytes:maximum}}));
 });
 await t.test('subir adjunto consulta solo la orden bajo bloqueo y mantiene permisos e idempotencia',async()=>{
  const statements=[],getConnection=pool.getConnection.bind(pool);pool.getConnection=async()=>{const conn=await getConnection();return new Proxy(conn,{get(target,key){const value=target[key];if(['query','execute'].includes(key))return(...args)=>{statements.push(args[0]);return value.apply(target,args);};return typeof value==='function'?value.bind(target):value;}});};
  const body={orderId:order.id,requestId:randomUUID(),category:'Antes',name:'qa.png',base64:png.toString('base64')};
  try{assert.equal((await call('attachments',body,admin)).status,201);assert.equal((await call('attachments',body,admin)).status,200);assert.equal((await call('attachments',{...body,orderId:'missing'},admin)).status,404);}
  finally{pool.getConnection=getConnection;}
  assert.ok(!statements.some(sql=>/SELECT entity, payload FROM em_records/.test(sql)));assert.ok(statements.some(sql=>/em_meta.*FOR UPDATE/.test(sql)));
 });
});
