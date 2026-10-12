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
 const pool=mysql.createPool({...config,database:name,connectionLimit:5});let server;
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
 await t.test('ediciones operativas usan la versión del registro y conservan validación al confirmar',async()=>{
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
 await t.test('base validada por revisión: reutilización secuencial, concurrencia y cambios de otro proceso',async()=>{
   const getConnection=pool.getConnection.bind(pool);let wholeReads=0;
   pool.getConnection=async()=>{const conn=await getConnection();return new Proxy(conn,{get(target,key){const value=target[key];if(key==='query')return(...args)=>{if(args[0].startsWith('SELECT entity, payload FROM em_records'))wholeReads++;return value.apply(target,args);};return typeof value==='function'?value.bind(target):value;}});};
   let other;
   try {
     const request=()=>({action:'create',entity:'Ticket',revision:0,fields:{equipo_id:'eq-a',titulo:'Concurrencia '+randomUUID(),descripcion:'Solicitud sintética',solicitud_id:randomUUID()}});
     assert.equal((await call('mutate',request(),admin)).status,200);wholeReads=0;
     assert.equal((await call('mutate',request(),admin)).status,200);assert.equal(wholeReads,0);
     const results=await Promise.all(Array.from({length:5},()=>call('mutate',request(),admin)));
     // Concurrent repeatable-read snapshots can observe an older revision after
     // another writer publishes a newer cache. A validated reread is required then.
     assert.ok(results.every(r=>r.status===200),JSON.stringify(results.map(r=>r.data.error)));
     assert.equal(new Set(results.map(r=>r.data.result.codigo)).size,5);
     const committed=await readSnapshot(pool);
     for(const result of results)assert.deepEqual(committed.entities.Ticket.find(row=>row.id===result.data.result.id),result.data.result);
     other=createApp({pool,origin,setupToken,production:false}).listen(0,'127.0.0.1');await once(other,'listening');
     const r=await fetch(`http://127.0.0.1:${other.address().port}/api/mutate`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:admin.cookie,'X-CSRF-Token':admin.csrf},body:JSON.stringify(request())});assert.equal(r.status,200);const external=await r.json();
     wholeReads=0;const refreshed=await call('mutate',request(),admin);assert.equal(refreshed.status,200);assert.equal(wholeReads,1);assert.ok(refreshed.data.database.entities.Ticket.some(row=>row.id===external.result.id));
     const [original]=await pool.execute("SELECT payload FROM em_records WHERE entity='Cliente' AND id='client-a'");
     await pool.execute("UPDATE em_records SET payload=? WHERE entity='Cliente' AND id='client-a'",[JSON.stringify({...JSON.parse(original[0].payload),nombre:''})]);await pool.query('UPDATE em_meta SET revision=revision+1 WHERE id=1');
     try {assert.equal((await call('mutate',request(),admin)).status,500);}finally{await pool.execute("UPDATE em_records SET payload=? WHERE entity='Cliente' AND id='client-a'",[original[0].payload]);await pool.query('UPDATE em_meta SET revision=revision+1 WHERE id=1');}
     assert.equal((await call('mutate',request(),admin)).status,200);
   } finally {pool.getConnection=getConnection;if(other){other.closeAllConnections();await new Promise(resolve=>other.close(resolve));}}
 });

 await t.test('dos escritores calculan en paralelo; el perdedor revalida sin duplicar códigos ni eventos',async()=>{
   const getConnection=pool.getConnection.bind(pool);let waiting=0,release;
   const gate=new Promise(resolve=>{release=resolve;});const timer=setTimeout(()=>release(),5000);
   pool.getConnection=async()=>{const conn=await getConnection();return new Proxy(conn,{get(target,key){const value=target[key];if(key==='execute')return async(...args)=>{if(args[0]==='UPDATE em_meta SET revision=? WHERE id=1 AND revision=?'&&waiting<2){waiting++;if(waiting===2)release();await gate;}return value.apply(target,args);};return typeof value==='function'?value.bind(target):value;}});};
   try {
     const before=await readSnapshot(pool),requestId=randomUUID();
     const request={action:'create',entity:'Ticket',revision:0,fields:{equipo_id:'eq-a',titulo:'Idempotencia concurrente',descripcion:'Solo un alta aunque lleguen dos envíos',solicitud_id:requestId}};
     const results=await Promise.all([call('mutate',request,admin),call('mutate',request,admin)]);
     assert.equal(waiting,2,'ambas validaciones deben alcanzar la confirmación sin bloquearse entre sí');assert.ok(results.every(r=>r.status===200),JSON.stringify(results.map(r=>r.data.error)));assert.equal(results[0].data.result.id,results[1].data.result.id);
     const after=await readSnapshot(pool);assert.equal(after.revision,before.revision+1);assert.equal(after.entities.Bitacora.length,before.entities.Bitacora.length+1);assert.equal(after.entities.Ticket.filter(row=>row.solicitud_id===requestId).length,1);
   }finally{clearTimeout(timer);pool.getConnection=getConnection;}
 });
 await t.test('un commit sin confirmación no se repite y el reintento explícito recupera el mismo registro',async()=>{
   const getConnection=pool.getConnection.bind(pool);let commits=0;
   pool.getConnection=async()=>{const conn=await getConnection();return new Proxy(conn,{get(target,key){const value=target[key];if(key==='commit')return async()=>{await value.call(target);commits++;throw Error('Synthetic lost COMMIT acknowledgement');};return typeof value==='function'?value.bind(target):value;}});};
   const requestId=randomUUID(),request={action:'create',entity:'Ticket',revision:0,fields:{equipo_id:'eq-a',titulo:'Confirmación incierta',descripcion:'No repetir automáticamente',solicitud_id:requestId}};
   try{assert.equal((await call('mutate',request,admin)).status,500);assert.equal(commits,1);}finally{pool.getConnection=getConnection;}
   const before=await readSnapshot(pool),rows=before.entities.Ticket.filter(row=>row.solicitud_id===requestId);assert.equal(rows.length,1);
   const retry=await call('mutate',request,admin);assert.equal(retry.status,200);assert.equal(retry.data.result.id,rows[0].id);assert.deepEqual(await readSnapshot(pool),before);
 });
 await t.test('revalida la asignación modificada por otro proceso antes de aceptar una lectura',async()=>{
   const getConnection=pool.getConnection.bind(pool);let changed=false;
   pool.getConnection=async()=>{const conn=await getConnection();return new Proxy(conn,{get(target,key){const value=target[key];if(key==='execute')return async(...args)=>{
     if(args[0]==='UPDATE em_meta SET revision=? WHERE id=1 AND revision=?'&&!changed) {
       changed=true;const external=await getConnection();
       try {await external.beginTransaction();const before=await readDatabase(external,true),next=structuredClone(before);const row=next.entities.OrdenServicio.find(row=>row.id===order.id);row.tecnico_id=next.entities.Tecnico.find(row=>row.id!==tech.data.technicianId).id;row.fecha_actualizacion=new Date().toISOString();next.revision++;await saveDatabase(external,next,before);await external.commit();}catch(error){await external.rollback();throw error;}finally{external.release();}
     }
     return value.apply(target,args);
   };return typeof value==='function'?value.bind(target):value;}});};
   const requestId=randomUUID(),before=await readSnapshot(pool);
   try {
     const result=await call('mutate',{action:'create',entity:'LecturaHorometro',revision:before.revision,fields:{equipo_id:'eq-a',orden_id:order.id,valor:120,fecha:new Date().toISOString(),solicitud_id:requestId}},technician);
     assert.equal(changed,true);assert.equal(result.status,403,JSON.stringify(result.data));
     const after=await readSnapshot(pool);assert.equal(after.revision,before.revision+1);assert.deepEqual(after.entities.Bitacora,before.entities.Bitacora);assert.ok(!after.entities.LecturaHorometro.some(row=>row.solicitud_id===requestId));
   }finally{pool.getConnection=getConnection;}
   const current=(await readSnapshot(pool)).entities.OrdenServicio.find(row=>row.id===order.id);
   assert.equal((await mutate('update','OrdenServicio',{tecnico_id:tech.data.technicianId,expected_updated_at:current.fecha_actualizacion},order.id)).status,200);
 });
 await t.test('un fallo de persistencia posterior al control de revisión revierte también el historial',async()=>{
   const before=await readSnapshot(pool),getConnection=pool.getConnection.bind(pool);let guarded=false;
   pool.getConnection=async()=>{const conn=await getConnection();return new Proxy(conn,{get(target,key){const value=target[key];if(key==='execute')return async(...args)=>{
     if(args[0]==='UPDATE em_meta SET revision=? WHERE id=1 AND revision=?') {const result=await value.apply(target,args);guarded=true;return result;}
     if(args[0].startsWith('INSERT INTO em_records'))throw Error('Synthetic failure after revision guard');
     return value.apply(target,args);
   };return typeof value==='function'?value.bind(target):value;}});};
   try{assert.equal((await call('mutate',{action:'create',entity:'Ticket',revision:0,fields:{equipo_id:'eq-a',titulo:'No guardar',descripcion:'Prueba rollback',solicitud_id:randomUUID()}},admin)).status,500);assert.equal(guarded,true);}finally{pool.getConnection=getConnection;}
   assert.deepEqual(await readSnapshot(pool),before);
 });
 const closure={estado:'Completada',diagnostico:'Prueba',trabajo_realizado:'Ajuste',pruebas_realizadas:'Frenado',resultado_pruebas:'Satisfactorio'};
 async function linkedWork(count=1) {
   const ticket=(await mutate('create','Ticket',{equipo_id:'eq-a',titulo:'Cierre '+randomUUID(),descripcion:'Prueba de cierre atómico',solicitud_id:randomUUID()})).data.result;
   const orders=[];
   for(let i=0;i<count;i++) {
     const created=await mutate('create','OrdenServicio',{equipo_id:'eq-a',ticket_id:ticket.id,sintoma:'Prueba vinculada',estado:'Programada',tecnico_id:tech.data.technicianId,fecha_programada:'2026-10-12',solicitud_id:randomUUID()});
     assert.equal(created.status,200,JSON.stringify(created.data));
     const started=await mutate('update','OrdenServicio',{estado:'En proceso',expected_updated_at:created.data.result.fecha_actualizacion},created.data.result.id);assert.equal(started.status,200);orders.push(started.data.result);
   }
   return {ticket,orders};
 }
 await t.test('dos cierres concurrentes resuelven el ticket una sola vez al completar la última orden',async()=>{
   const {ticket,orders}=await linkedWork(2),getConnection=pool.getConnection.bind(pool);let waiting=0,release;
   const gate=new Promise(resolve=>{release=resolve;}),timer=setTimeout(()=>release(),5000);
   pool.getConnection=async()=>{const conn=await getConnection();return new Proxy(conn,{get(target,key){const value=target[key];if(key==='execute')return async(...args)=>{if(args[0]==='UPDATE em_meta SET revision=? WHERE id=1 AND revision=?'&&waiting<2){waiting++;if(waiting===2)release();await gate;}return value.apply(target,args);};return typeof value==='function'?value.bind(target):value;}});};
   let results;
   try {results=await Promise.all(orders.map(row=>call('mutate',{action:'update',entity:'OrdenServicio',id:row.id,revision:0,fields:{...closure,expected_updated_at:row.fecha_actualizacion}},technician)));}
   finally {clearTimeout(timer);pool.getConnection=getConnection;}
   assert.equal(waiting,2);assert.ok(results.every(r=>r.status===200),JSON.stringify(results.map(r=>r.data)));
   const after=await readSnapshot(pool),resolved=after.entities.Ticket.find(row=>row.id===ticket.id);
   assert.equal(resolved.estado,'Resuelto');assert.equal(resolved.creado_por,ticket.creado_por);
   assert.equal(after.entities.Bitacora.filter(row=>row.ticket_id===ticket.id&&row.accion==='Resolución por orden').length,1);
   const [indexed]=await pool.execute("SELECT state FROM em_operation_index WHERE entity='Ticket' AND id=?",[ticket.id]);assert.equal(indexed[0].state,'Resuelto');
   const clientView=await call(`operations/Ticket?id=${ticket.id}`,undefined,a);assert.equal(clientView.status,200);assert.equal(clientView.data.rows[0].estado,'Resuelto');
   const retry=await call('mutate',{action:'update',entity:'OrdenServicio',id:orders[1].id,revision:0,fields:{...closure,expected_updated_at:orders[1].fecha_actualizacion}},technician);assert.ok([400,409].includes(retry.status));assert.deepEqual(await readSnapshot(pool),after);
 });
 await t.test('un fallo al guardar la auditoría revierte orden, ticket, lectura e índices',async()=>{
   const {ticket,orders}=await linkedWork(),before=await readSnapshot(pool),getConnection=pool.getConnection.bind(pool);let failed=false;
   pool.getConnection=async()=>{const conn=await getConnection();return new Proxy(conn,{get(target,key){const value=target[key];if(key==='execute')return async(...args)=>{if(args[0].startsWith('INSERT INTO em_audit_log')){failed=true;throw Error('Synthetic closure audit failure');}return value.apply(target,args);};return typeof value==='function'?value.bind(target):value;}});};
   try {const r=await call('mutate',{action:'update',entity:'OrdenServicio',id:orders[0].id,revision:0,fields:{...closure,horometro:130,expected_updated_at:orders[0].fecha_actualizacion}},technician);assert.equal(r.status,500);assert.equal(failed,true);}
   finally {pool.getConnection=getConnection;}
   assert.deepEqual(await readSnapshot(pool),before);
   const [indexed]=await pool.execute("SELECT state FROM em_operation_index WHERE entity='Ticket' AND id=?",[ticket.id]);assert.equal(indexed[0].state,'Nuevo');
   const saved=await call('mutate',{action:'update',entity:'OrdenServicio',id:orders[0].id,revision:0,fields:{...closure,horometro:130,expected_updated_at:orders[0].fecha_actualizacion}},technician);assert.equal(saved.status,200,JSON.stringify(saved.data));
   const after=await readSnapshot(pool);assert.equal(after.entities.Ticket.find(row=>row.id===ticket.id).estado,'Resuelto');assert.equal(after.entities.LecturaHorometro.filter(row=>row.orden_id===orders[0].id).length,1);
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
