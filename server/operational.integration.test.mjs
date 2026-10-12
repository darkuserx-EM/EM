import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import {migrate,readDatabase,readSnapshot,saveDatabase} from './database.mjs';
import {createApp} from './app.mjs';
import {token} from './security.mjs';

test('Cuentas y adjuntos privados: aislamiento, expiración, reintentos y recuperación',{skip:process.env.MYSQL_INTEGRATION!=='1',timeout:120000},async t=>{
 const host=process.env.TEST_DB_HOST||'127.0.0.1';assert.ok(['127.0.0.1','localhost','::1'].includes(host));
 const config={host,port:Number(process.env.TEST_DB_PORT||3306),user:process.env.TEST_DB_USER||'root',password:process.env.TEST_DB_PASSWORD};assert.ok(config.password);
 const name=`em_ci_${randomUUID().replaceAll('-','')}`,control=await mysql.createConnection(config);await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
 const pool=mysql.createPool({...config,database:name});let server;
 t.after(async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await pool.end();assert.match(name,/^em_ci_[a-f0-9]{32}$/);await control.query(`DROP DATABASE ${name}`);await control.end();});
 await migrate(pool);await migrate(pool);
 const now=new Date().toISOString(),row=(id,codigo,fields)=>({id,codigo,creado_por:'qa',actualizado_por:'qa',fecha_creacion:now,fecha_actualizacion:now,...fields});
 const conn=await pool.getConnection();try{await conn.beginTransaction();const before=await readDatabase(conn,true),db=structuredClone(before);for(const id of ['a','b']){db.entities.Cliente.push(row(`client-${id}`,`CLI-${id}`,{nombre:`Cliente ${id} PRUEBA`,estado:'Activo'}));db.entities.Equipo.push(row(`eq-${id}`,`TCE-${id}`,{marca:'Crown',modelo:'QA',serie:`SYNTHETIC-${id}`,tipo:'Reach',propiedad:'De cliente',estado:'Disponible',cliente_id:`client-${id}`,horometro:100}));}db.revision++;await saveDatabase(conn,db,before);await conn.commit();}finally{conn.release();}
 const origin='http://localhost:3000',setupToken=token();server=createApp({pool,origin,setupToken,production:false}).listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;let serial=1;
 async function call(path,body,session){const r=await fetch(`${url}/api/${path}`,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Forwarded-For':`198.51.100.${serial++}`,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,headers:r.headers,data:(r.headers.get('content-type')||'').includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};}
 async function login(email,password){const r=await call('login',{email,password});assert.equal(r.status,200,JSON.stringify(r.data));const s={cookie:r.headers.getSetCookie()[0].split(';')[0],csrf:''};const state=(await call('session',undefined,s)).data;s.csrf=state.csrf;if(state.mustChangePassword)assert.equal((await call('password',{currentPassword:password,newPassword:password+' changed'},s)).status,200);return s;}
 const password='Synthetic QA password 2026!';assert.equal((await call('setup',{email:'admin@example.invalid',name:'QA Admin',password,setupToken})).status,201);const admin=await login('admin@example.invalid',password);
 const technicianRequest={name:'Técnico PRUEBA',email:'tech@example.invalid',role:'Técnico',specialty:'Mantenimiento sintético',days:7,password:'Synthetic technician stable password 2026!',requestId:randomUUID()};
 const tech=(await call('admin/users',technicianRequest,admin));assert.equal(tech.status,201,JSON.stringify(tech.data));
 const clientA=await call('admin/users',{name:'A PRUEBA',email:'a@example.invalid',role:'Cliente',clientId:'client-a',days:7},admin);assert.equal(clientA.status,201);
 const clientB=await call('admin/users',{name:'B PRUEBA',email:'b@example.invalid',role:'Cliente',clientId:'client-b',days:7},admin);assert.equal(clientB.status,201);
 const a=await login(clientA.data.email,clientA.data.password),b=await login(clientB.data.email,clientB.data.password),technician=await login(tech.data.email,tech.data.password);
 await t.test('cuentas limitadas y técnico persistido sin exponer hashes',async()=>{
   assert.equal((await call('admin/users',undefined,technician)).status,403);const list=await call('admin/users',undefined,admin);assert.ok(!JSON.stringify(list.data).includes('password_hash'));
   assert.equal((await call('admin/users',{name:'Inválido',email:'bad@example.invalid',role:'Cliente',clientId:'absent'},admin)).status,400);
   assert.equal((await readSnapshot(pool)).entities.Tecnico.filter(row=>row.id===tech.data.technicianId).length,1);
 });
 await t.test('reintentar alta de cuenta conserva usuario, técnico y vigencia sin duplicar eventos',async()=>{
   const retryRequest={...technicianRequest,email:'retry@example.invalid',requestId:randomUUID()};
   const first=await call('admin/users',retryRequest,admin);assert.equal(first.status,201);
   const before=await readSnapshot(pool);
   const repeated=await call('admin/users',retryRequest,admin);assert.equal(repeated.status,200,JSON.stringify(repeated.data));
   assert.deepEqual(repeated.data,first.data);
   assert.deepEqual(await readSnapshot(pool),before);
   const [users]=await pool.execute('SELECT id,technician_id FROM em_users WHERE email=?',[technicianRequest.email]);assert.equal(users.length,1);assert.equal(users[0].technician_id,tech.data.technicianId);
   const [events]=await pool.execute("SELECT id FROM em_security_events WHERE target_id=? AND action='account.created'",[tech.data.id]);assert.equal(events.length,1);
   assert.equal((await call('admin/users',{...technicianRequest,requestId:randomUUID()},admin)).status,409);
   assert.equal((await call('admin/users',{...technicianRequest,password:'Synthetic wrong retry password 2026!'},admin)).status,409);
   assert.equal((await call('admin/users',{...technicianRequest,name:'Nombre distinto'},admin)).status,409);
   assert.deepEqual(await readSnapshot(pool),before);
 });
 async function mutate(action,entity,fields,id){const revision=(await call('database',undefined,admin)).data.revision;return call('mutate',{revision,action,entity,fields,id},admin);}
 const created=await mutate('create','OrdenServicio',{equipo_id:'eq-a',tipo:'Preventivo',sintoma:'Prueba sintética',estado:'Programada',prioridad:'Media',tecnico_id:tech.data.technicianId,fecha_programada:'2026-10-10',visible_cliente:true,solicitud_id:randomUUID()});assert.equal(created.status,200,JSON.stringify(created.data));const order=created.data.result;
 await t.test('ediciones operativas usan la versión del registro y conservan validación bajo bloqueo',async()=>{
   assert.equal((await mutate('create','LecturaHorometro',{equipo_id:'eq-a',valor:100,fecha:new Date(Date.now()-60000).toISOString()})).status,200);
   const initial=(await call('database',undefined,admin)).data;
   const ticket=await call('mutate',{action:'create',entity:'Ticket',revision:initial.revision,fields:{equipo_id:'eq-a',titulo:'Solicitud concurrente',descripcion:'Prueba de independencia',prioridad:'Media',solicitud_id:randomUUID()}},admin);assert.equal(ticket.status,200,JSON.stringify(ticket.data));
   const edit={action:'update',entity:'OrdenServicio',id:order.id,revision:initial.revision,fields:{estado:'En proceso',expected_updated_at:order.fecha_actualizacion}};
   const saved=await call('mutate',edit,technician);assert.equal(saved.status,200,JSON.stringify(saved.data));
   const stale=await call('mutate',edit,technician);assert.equal(stale.status,409);assert.match(stale.data.error,/Este registro cambió/);
   const clientConflict=await call('mutate',{action:'update',entity:'Cliente',id:'client-a',revision:initial.revision,fields:{nombre:'No debe guardarse'}},admin);assert.equal(clientConflict.status,409);
   const date=new Date().toISOString();
   const readings=await Promise.all([90,110].map(valor=>call('mutate',{action:'create',entity:'LecturaHorometro',revision:initial.revision,fields:{equipo_id:'eq-a',orden_id:order.id,fecha:date,valor,solicitud_id:randomUUID()}},technician)));
   assert.deepEqual(readings.map(r=>r.status).sort(),[200,400]);
   const final=await readSnapshot(pool);assert.equal(Math.max(...final.entities.LecturaHorometro.filter(r=>r.equipo_id==='eq-a').map(r=>r.valor)),110);
   assert.equal(final.entities.Equipo.find(r=>r.id==='eq-a').horometro,100); // La ficha conserva la lectura de ingreso.
   assert.equal(final.entities.LecturaHorometro.filter(r=>r.equipo_id==='eq-a'&&r.valor===90).length,0);
 });
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');const body={orderId:order.id,requestId:randomUUID(),category:'Antes',name:'evidencia.png',base64:bytes.toString('base64')};let file;
 await t.test('subida autorizada e idempotente, rechazo HTML y acceso cruzado',async()=>{
   assert.equal((await call('attachments',body,a)).status,403);const up=await call('attachments',body,technician);assert.equal(up.status,201,JSON.stringify(up.data));file=up.data.file;
   assert.equal((await call('attachments',body,technician)).data.file.id,file.id);
   assert.equal((await call('attachments',{...body,requestId:randomUUID(),base64:Buffer.from('<html>invalid attachment</html>').toString('base64')},technician)).status,400);
   assert.equal((await call(`attachments?orderId=${order.id}`,undefined,a)).data.files.length,1);
   assert.equal((await call(`attachments?orderId=${order.id}`,undefined,b)).status,404);
   const download=await call(`attachments/${file.id}/file`,undefined,a);assert.equal(download.status,200);assert.deepEqual(download.data,bytes);
   assert.equal((await call(`attachments/${file.id}/file`,undefined,b)).status,404);
   assert.ok(!JSON.stringify((await call('database',undefined,a)).data).includes(bytes.toString('base64')));
 });
 await t.test('respaldo de metadatos y recuperación binaria aislada',async()=>{
   const manifest=await call('admin/attachments-manifest',undefined,admin);assert.equal(manifest.data.files.length,1);assert.equal((await call('admin/attachments-manifest',undefined,a)).status,403);
   const [saved]=await pool.execute('SELECT * FROM em_attachments WHERE id=?',[file.id]);
   const c=await pool.getConnection();try{await c.beginTransaction();await c.execute('DELETE FROM em_attachments WHERE id=?',[file.id]);await c.execute('INSERT INTO em_attachments SET ?',[saved[0]]).catch(async()=>{await c.query('INSERT INTO em_attachments SET ?',saved[0]);});await c.commit();}finally{c.release();}
   assert.deepEqual((await call(`attachments/${file.id}/file`,undefined,a)).data,bytes);
 });
 await t.test('revocar o vencer cuentas invalida sesiones existentes',async()=>{
   assert.equal((await call(`admin/users/${clientB.data.id}/revoke`,{},admin)).status,200);assert.equal((await call('session',undefined,b)).status,401);
   await pool.execute('UPDATE em_users SET expires_at=? WHERE id=?',[Date.now()-1,clientA.data.id]);assert.equal((await call('session',undefined,a)).status,401);assert.equal((await call('login',{email:clientA.data.email,password:clientA.data.password})).status,401);
   assert.equal((await call(`admin/users/${(await call('session',undefined,admin)).data.actor.id}/revoke`,{},admin)).status,400);
 });
});
