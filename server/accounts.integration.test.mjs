import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import {migrate,readSnapshot,readDatabase,saveDatabase} from './database.mjs';
import {createApp} from './app.mjs';
import {token} from './security.mjs';

test('Ciclo de cuentas: recuperación, perfiles, contraseñas y último administrador',{skip:process.env.MYSQL_INTEGRATION!=='1',timeout:120000},async t=>{
 const host=process.env.TEST_DB_HOST||'127.0.0.1';assert.ok(['127.0.0.1','localhost','::1'].includes(host));
 const config={host,port:Number(process.env.TEST_DB_PORT||3306),user:process.env.TEST_DB_USER||'root',password:process.env.TEST_DB_PASSWORD};assert.ok(config.password);
 const name='em_ci_'+randomUUID().replaceAll('-',''),control=await mysql.createConnection(config);await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
 const pool=mysql.createPool({...config,database:name});let server;
 t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await pool.end();assert.match(name,/^em_ci_[a-f0-9]{32}$/);await control.query(`DROP DATABASE ${name}`);await control.end();});
 await migrate(pool);await migrate(pool);
 const origin='http://localhost:3000',setupToken=token();server=createApp({pool,origin,setupToken,production:false}).listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}/api/`;let serial=1;
 async function call(path,body,session,extra={}){const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Forwarded-For':`198.51.100.${serial++%250+1}`,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,headers:r.headers,data:await r.json()};}
 async function login(email,password,change=true){const r=await call('login',{email,password});assert.equal(r.status,200,JSON.stringify(r.data));const s={cookie:r.headers.getSetCookie()[0].split(';')[0],csrf:'',password,email};const state=(await call('session',undefined,s)).data;s.csrf=state.csrf;if(change&&state.mustChangePassword){s.password=password+' personal';assert.equal((await call('password',{currentPassword:password,newPassword:s.password},s)).status,200);}return s;}
 const password='Administrador sintético seguro 2026!';assert.equal((await call('setup',{setupToken,email:'admin@example.invalid',name:'QA Admin',password})).status,201);const admin=await login('admin@example.invalid',password);const adminId=(await call('session',undefined,admin)).data.actor.id;
 async function create(role,email,extra={}){const r=await call('admin/users',{name:'Persona sintética',role,email,days:90,currentPassword:password,specialty:'Diagnóstico eléctrico',...extra},admin);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;}
 async function mutate(entity,fields){const db=(await call('database',undefined,admin)).data;const r=await call('mutate',{action:'create',entity,fields,revision:db.revision},admin);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.result;}
 const client=await mutate('Cliente',{nombre:'Empresa sintética',estado:'Activo'}),equipment=await mutate('Equipo',{marca:'QA',modelo:'Q1',serie:'ACCOUNTS-QA',tipo:'Reach',propiedad:'De cliente',cliente_id:client.id,estado:'Disponible'});
 let customer,clientSession,coord,tech,secondAdmin;
 await t.test('alta temporal impide consultar datos hasta cambiar contraseña; conserva ámbito',async()=>{
  customer=await create('Cliente','client@example.invalid',{clientId:client.id});clientSession=await login(customer.email,customer.password,false);
  assert.equal((await call('session',undefined,clientSession)).data.mustChangePassword,true);
  for(const route of ['database','equipment-images/x/foto_equipo/x','admin/users','admin/full-backup'])assert.equal((await call(route,undefined,clientSession)).status,403);
  assert.equal((await call('mutate',{action:'create',entity:'Ticket'},clientSession)).data.code,'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await call('password',{currentPassword:customer.password,newPassword:customer.password},clientSession)).status,400);
  assert.equal((await call('password',{currentPassword:customer.password,newPassword:customer.password+' personal'},clientSession,{'X-CSRF-Token':'incorrect'})).status,403);
  clientSession=await login(customer.email,customer.password);
  assert.equal((await call('database',undefined,clientSession)).status,200);assert.equal((await call('session',undefined,clientSession)).data.mustChangePassword,false);
  assert.equal((await call('admin/users',undefined,clientSession)).status,403);
 });
 await t.test('Coordinador exige reautenticación, gestiona órdenes sin administrar accesos',async()=>{
  assert.equal((await call('admin/users',{name:'QA',email:'denied@example.invalid',role:'Coordinador',days:null},admin)).status,400);
  const account=await create('Coordinador','coord@example.invalid',{days:null});coord=await login(account.email,account.password);
  assert.equal((await call('admin/users',undefined,coord)).status,403);
  const revision=(await call('database',undefined,coord)).data.revision;
  const result=await call('mutate',{action:'create',entity:'OrdenServicio',revision,fields:{equipo_id:equipment.id,sintoma:'Revisión sintética',estado:'Borrador'}},coord);assert.equal(result.status,200,JSON.stringify(result.data));
 });
 await t.test('alta de técnico requiere especialidad; coordinador tiene su registro de campo',async()=>{
  assert.equal((await call('admin/users',{name:'QA',email:'missing@example.invalid',role:'Técnico'},admin)).status,400);
  const account=await create('Técnico','tech@example.invalid');tech=await login(account.email,account.password);
  const db=await readSnapshot(pool);assert.equal(db.entities.Tecnico.length,2);assert.equal(db.entities.Tecnico.find(row=>row.id===account.technicianId).especialidad,'Diagnóstico eléctrico');
  assert.equal((await call('admin/users',undefined,tech)).status,403);
 });
 await t.test('coordinador con registro de campo y vinculación de cuenta anterior sin cambiar perfil',async()=>{
  const account=await create('Coordinador','field-coord@example.invalid',{days:null});assert.ok(account.technicianId);
  await pool.execute('UPDATE em_users SET technician_id=NULL WHERE id=?',[account.id]);
  const before=await readSnapshot(pool);
  const path='admin/users/'+account.id+'/technician';
  assert.equal((await call(path,{technicianId:account.technicianId,currentPassword:password},coord)).status,403);
  assert.equal((await call(path,{technicianId:account.technicianId},admin)).status,400);
  assert.equal((await call(path,{technicianId:account.technicianId,currentPassword:password},admin)).status,200);
  assert.equal((await call(path,{currentPassword:password},admin)).data.technicianId,account.technicianId);
  const after=await readSnapshot(pool);assert.deepEqual(after.entities.Tecnico,before.entities.Tecnico);
  const session=await login(account.email,account.password);const actor=(await call('session',undefined,session)).data.actor;assert.equal(actor.rol,'Coordinador');assert.equal(actor.tecnico_id,account.technicianId);
 });
 await t.test('renovar vencida y reactivar revocada mantiene empresa y revoca sesiones antiguas',async()=>{
  await pool.execute('UPDATE em_users SET expires_at=? WHERE id=?',[Date.now()-1000,customer.id]);
  assert.equal((await call('session',undefined,clientSession)).status,401);
  assert.equal((await call('admin/users/'+customer.id+'/renew',{days:30},admin)).status,200);clientSession=await login(customer.email,clientSession.password);
  const before=(await call('admin/users',undefined,admin)).data.users.find(u=>u.id===customer.id);
  const renewal=await call('admin/users/'+customer.id+'/renew',{days:30},admin);assert.equal(renewal.status,200);assert.equal(renewal.data.expiresAt,Number(before.expires_at)+30*86400000);
  assert.equal((await call('admin/users/'+customer.id+'/revoke',{},admin)).status,200);assert.equal((await call('session',undefined,clientSession)).status,401);
  assert.equal((await call('admin/users/'+customer.id+'/renew',{days:30},admin)).status,400);
  assert.equal((await call('admin/users/'+customer.id+'/reactivate',{days:30,clientId:'another-client'},admin)).status,200);
  clientSession=await login(customer.email,clientSession.password);assert.equal((await call('session',undefined,clientSession)).data.actor.cliente_id,client.id);
 });
 await t.test('restablecer requiere contraseña de admin, invalida sesiones y vuelve a exigir cambio',async()=>{
  assert.equal((await call('admin/users/'+customer.id+'/reset-password',{},admin)).status,400);
  const reset=await call('admin/users/'+customer.id+'/reset-password',{currentPassword:password},admin);assert.equal(reset.status,200);assert.ok(reset.data.password.length>=32);
  assert.equal((await call('session',undefined,clientSession)).status,401);assert.equal((await call('login',{email:customer.email,password:clientSession.password})).status,401);
  clientSession=await login(customer.email,reset.data.password,false);assert.equal((await call('database',undefined,clientSession)).status,403);
  clientSession=await login(customer.email,reset.data.password);assert.equal((await call('database',undefined,clientSession)).status,200);
 });
 await t.test('las nuevas rutas exigen sesión, rol y CSRF; eventos no incluyen contraseñas',async()=>{
  for(const action of ['renew','reactivate','revoke','reset-password']){
   const path='admin/users/'+customer.id+'/'+action,body={days:30,currentPassword:password};
   assert.equal((await call(path,body)).status,401);assert.equal((await call(path,body,clientSession)).status,403);assert.equal((await call(path,body,coord)).status,403);assert.equal((await call(path,body,admin,{'X-CSRF-Token':'incorrect'})).status,403);
  }
  const [events]=await pool.query('SELECT action FROM em_security_events');for(const action of ['created','renewed','revoked','reactivated','password-reset','password-changed'])assert.ok(events.some(e=>e.action==='account.'+action));
  const list=await call('admin/users',undefined,admin);assert.ok(!JSON.stringify(list.data).includes('password_hash'));assert.ok(!JSON.stringify(list.data).includes(password));
 });
 await t.test('protege un administrador permanente y admite revocar a otro con reautenticación',async()=>{
  assert.equal((await call('admin/users',{name:'QA',email:'bad-admin@example.invalid',role:'Administrador',days:null,currentPassword:'incorrecta'},admin)).status,400);
  const account=await create('Administrador','admin2@example.invalid',{days:7});secondAdmin=await login(account.email,account.password);
  assert.equal((await call('admin/users/'+adminId+'/revoke',{currentPassword:secondAdmin.password},secondAdmin)).status,400);
  assert.equal((await call('admin/users/'+adminId+'/reactivate',{days:30,currentPassword:password},admin)).status,400);
  assert.equal((await call('admin/users/'+account.id+'/revoke',{currentPassword:password},admin)).status,200);
  assert.equal((await call('admin/users/'+account.id+'/reactivate',{days:null,currentPassword:password},admin)).status,200);secondAdmin=await login(account.email,secondAdmin.password);
  assert.equal((await call('admin/users/'+adminId+'/revoke',{currentPassword:secondAdmin.password},secondAdmin)).status,200);
  assert.equal((await call('session',undefined,admin)).status,401);
  assert.equal((await call('admin/users/'+account.id+'/revoke',{currentPassword:secondAdmin.password},secondAdmin)).status,400);
 });
 await t.test('historial paginado, filtros, respaldo íntegro y eventos privados',async()=>{
  const admin=secondAdmin;
  const conn=await pool.getConnection();try{await conn.beginTransaction();const before=await readDatabase(conn,true),db=structuredClone(before);for(let i=0;i<250;i++){const id='audit-'+String(i).padStart(3,'0');db.entities.Bitacora.push({id,codigo:'LOG-QA-'+i,creado_por:adminId,actualizado_por:adminId,fecha_creacion:'2026-10-12T01:00:00.000Z',fecha_actualizacion:'2026-10-12T01:00:00.000Z',entidad:'Equipo',accion:'Cambio de estado',detalle:'Movimiento sintético',equipo_id:i<125?equipment.id:'other-equipment',hallazgo_id:i<20?'finding-qa':''});}db.revision++;await saveDatabase(conn,db,before);await conn.commit();}finally{conn.release();}
  await migrate(pool);await migrate(pool);
  assert.equal((await call('database',undefined,admin)).data.entities.Bitacora.length,0);
  const seen=new Set();let cursor='';do{const r=await call('audit-log?limit=37&entity=Equipo'+(cursor?'&cursor='+encodeURIComponent(cursor):''),undefined,admin);assert.equal(r.status,200,JSON.stringify(r.data));for(const row of r.data.rows){assert.ok(!seen.has(row.id));seen.add(row.id);}cursor=r.data.nextCursor;}while(cursor);assert.ok([...seen].filter(x=>x.startsWith('audit-')).length===250);
  const own=await call('audit-log?equipo_id='+equipment.id+'&limit=200',undefined,admin);assert.ok(own.data.rows.every(row=>row.equipo_id===equipment.id));assert.ok(own.data.rows.length>=125);
  assert.equal((await call('audit-log?hallazgo_id=finding-qa',undefined,admin)).data.rows.length,20);
  assert.equal((await call('audit-log?from=2026-10-12',undefined,admin)).data.rows.filter(row=>row.id.startsWith('audit-')).length,0);
  assert.equal((await call('audit-log?limit=201',undefined,admin)).status,400);assert.equal((await call('audit-log?cursor=bad',undefined,admin)).status,400);
  assert.equal((await call('audit-log',undefined,coord)).status,403);assert.equal((await call('admin/security-events',undefined,tech)).status,403);
  const backup=await call('backup',undefined,admin);assert.equal(backup.data.entities.Bitacora.filter(row=>row.id.startsWith('audit-')).length,250);
  const first=await call('admin/security-events?limit=2',undefined,admin);assert.equal(first.status,200);assert.equal(first.data.rows.length,2);assert.ok(first.data.nextCursor);const second=await call('admin/security-events?limit=2&cursor='+encodeURIComponent(first.data.nextCursor),undefined,admin);assert.ok(second.data.rows.every(row=>!first.data.rows.some(previous=>previous.id===row.id)));
 });



});
