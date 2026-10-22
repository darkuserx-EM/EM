import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import sharp from 'sharp';
import {migrate,readDatabase,readSnapshot,saveDatabase} from './database.mjs';
import {createApp} from './app.mjs';
import {token} from './security.mjs';
import {createFileStore,localFiles} from './file-storage.mjs';
import {DriveStorageError} from './drive-storage.mjs';

for (const external of [false,true]) test(`Fotografías de tickets (${external?'Drive privado simulado':'MySQL'}): cuatro perfiles, vínculo sin copias y recuperación`,{skip:process.env.MYSQL_INTEGRATION!=='1',timeout:120000},async t=>{
  const host=process.env.TEST_DB_HOST||'127.0.0.1';assert.ok(['127.0.0.1','localhost','::1'].includes(host));
  const config={host,port:Number(process.env.TEST_DB_PORT||3306),user:process.env.TEST_DB_USER||'root',password:process.env.TEST_DB_PASSWORD};assert.ok(config.password);
  const name=`em_ci_${randomUUID().replaceAll('-','')}`,control=await mysql.createConnection(config);await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
  const pool=mysql.createPool({...config,database:name,connectionLimit:5});let server;
  t.after(async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await pool.end();assert.match(name,/^em_ci_[a-f0-9]{32}$/);await control.query(`DROP DATABASE ${name}`);await control.end();});
  await migrate(pool);await migrate(pool);
  const remote=new Map(),folders=new Map(),locations=new Map(); let remoteFailure=false;
  const storage=external?createFileStore(pool,{
    reserve:async()=>randomUUID(),verifyFolder:async()=>({private:true}),
    rootId:'synthetic-private-root',
    folder:async(id,name,parent)=>{if(folders.has(id))assert.deepEqual(folders.get(id),{name,parent});folders.set(id,{name,parent});},
    move:async(id,destination,expected)=>{assert.ok(folders.has(destination));assert.equal(createHash('sha256').update(remote.get(id)).digest('hex'),expected.sha256);locations.set(id,destination);},
    put:async(id,bytes)=>{if(remoteFailure)throw new DriveStorageError('DRIVE_NETWORK','Drive unavailable');if(remote.has(id))assert.deepEqual(remote.get(id),bytes);remote.set(id,bytes);},
    get:async(id,size,sha)=>{const bytes=remote.get(id);assert.equal(bytes.length,size);assert.equal(createHash('sha256').update(bytes).digest('hex'),sha);return bytes;},
  }):localFiles;
  const now=new Date().toISOString(),row=(id,codigo,fields)=>({id,codigo,creado_por:'qa',actualizado_por:'qa',fecha_creacion:now,fecha_actualizacion:now,...fields});
  const conn=await pool.getConnection();try{await conn.beginTransaction();const before=await readDatabase(conn,true),db=structuredClone(before);for(const id of ['a','b']){db.entities.Cliente.push(row(`client-${id}`,`CLI-${id}`,{nombre:`Cliente ${id} PRUEBA`,estado:'Activo'}));db.entities.Equipo.push(row(`eq-${id}`,`TCE-${id}`,{marca:'Crown',modelo:'QA',serie:`SYNTHETIC-${id}`,tipo:'Reach',propiedad:'De cliente',estado:'Disponible',cliente_id:`client-${id}`,horometro:100}));}db.revision++;await saveDatabase(conn,db,before);await conn.commit();}finally{conn.release();}
  const origin='http://localhost:3000',setupToken=token();server=createApp({pool,origin,setupToken,production:false,logger:()=>{},files:storage}).listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;let serial=0;
  const headers=session=>({Origin:origin,'Content-Type':'application/json','X-Forwarded-For':`198.51.${Math.floor(serial/250)}.${++serial%250+1}`,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{})});
  async function call(path,body,session){const r=await fetch(`${url}/api/${path}`,{method:body===undefined?'GET':'POST',headers:headers(session),body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,headers:r.headers,data:(r.headers.get('content-type')||'').includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer())};}
  async function login(email,password){const r=await call('login',{email,password});assert.equal(r.status,200,JSON.stringify(r.data));const s={cookie:r.headers.getSetCookie()[0].split(';')[0],csrf:''};const state=(await call('session',undefined,s)).data;s.csrf=state.csrf;if(state.mustChangePassword)assert.equal((await call('password',{currentPassword:password,newPassword:password+' changed'},s)).status,200);return s;}
  const password='Synthetic ticket photo QA 2026!';assert.equal((await call('setup',{email:'admin@example.invalid',name:'QA Admin',password,setupToken})).status,201);const admin=await login('admin@example.invalid',password);
  const sessions={admin},accounts={};
  for(const [id,role,clientId] of [['client','Cliente','client-a'],['foreign','Cliente','client-b'],['tech','Técnico'],['otherTech','Técnico'],['coordinator','Coordinador']]){
    const account=await call('admin/users',{name:id+' PRUEBA',email:id+'@example.invalid',role,clientId,currentPassword:password,specialty:"Pruebas de fotografías",days:7},admin);assert.equal(account.status,201,JSON.stringify(account.data));accounts[id]=account.data;sessions[id]=await login(account.data.email,account.data.password);
  }
  async function create(entity,fields,actor=admin){const revision=(await call('database',undefined,admin)).data.revision;const r=await call('mutate',{revision,action:'create',entity,fields},actor);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.result;}
  const ticket=await create('Ticket',{equipo_id:'eq-a',titulo:'Problema con fotos',descripcion:'Solicitud sintética con evidencias',solicitud_id:randomUUID()},sessions.client);
  const foreign=await create('Ticket',{equipo_id:'eq-b',titulo:'Otra empresa',descripcion:'Solicitud ajena'});
  const photo=async red=>sharp({create:{width:32,height:32,channels:3,background:{r:red,g:80,b:20}}}).png().toBuffer();
  const bytes=await photo(100),body={ticketId:ticket.id,requestId:randomUUID(),name:'falla.png',base64:bytes.toString('base64')};let file,order;
  await t.test('cliente, coordinador y administrador cargan; reintentos y concurrencia no duplican',async()=>{
    const results=await Promise.all([call('ticket-attachments',body,sessions.client),call('ticket-attachments',body,sessions.client)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);file=results[0].data.file;assert.equal(file.id,results[1].data.file.id);
    assert.equal((await call('ticket-attachments',{...body,requestId:randomUUID()},sessions.coordinator)).data.file.id,file.id);
    for(const [actor,r] of [[sessions.coordinator,110],[admin,120]])assert.equal((await call('ticket-attachments',{...body,requestId:randomUUID(),base64:(await photo(r)).toString('base64')},actor)).status,201);
    const [rows]=await pool.query('SELECT * FROM em_attachments');assert.equal(rows.length,3);assert.equal(rows.find(r=>r.id===file.id).order_id,'');assert.deepEqual(await storage.read(pool,rows.find(r=>r.id===file.id)),bytes);
    if(external){assert.equal(remote.size,3);assert.ok(rows.every(row=>row.content.length===0&&row.storage_key===row.sha256));}
    const [events]=await pool.query("SELECT id FROM em_security_events WHERE action='ticket.photo.added'");assert.equal(events.length,3);
    assert.equal((await call('ticket-attachments',{...body,ticketId:foreign.id},admin)).status,409);
  });
  await t.test('permisos por recurso, CSRF y formato: no acepta video, PDF ni archivos falsos',async()=>{
    assert.equal((await call('ticket-attachments?ticketId='+ticket.id)).status,401);
    for(const actor of [sessions.foreign,sessions.tech,sessions.otherTech]){
      assert.equal((await call('ticket-attachments?ticketId='+ticket.id,undefined,actor)).status,404);
      assert.equal((await call(`attachments/${file.id}/file`,undefined,actor)).status,404);
    }
    assert.equal((await call('ticket-attachments',body,sessions.foreign)).status,404);
    const denied=await fetch(url+'/api/ticket-attachments',{method:'POST',headers:headers(sessions.tech),body:'{invalid'});assert.equal(denied.status,403);
    const noCsrf=headers(sessions.client);delete noCsrf['X-CSRF-Token'];assert.equal((await fetch(url+'/api/ticket-attachments',{method:'POST',headers:noCsrf,body:JSON.stringify(body)})).status,403);
    for(const content of [Buffer.from('%PDF-1.4 fake document'),Buffer.from('0000ftypmp42_video'),Buffer.concat([bytes.subarray(0,12),Buffer.alloc(100)])])assert.equal((await call('ticket-attachments',{...body,requestId:randomUUID(),base64:content.toString('base64')},admin)).status,400);
    assert.equal((await call('ticket-attachments',{...body,base64:Buffer.alloc(4*1024*1024+1).toString('base64')},admin)).status,400);
  });
  await t.test('orden asignada consulta los mismos IDs y bytes; otras órdenes no dan acceso',async()=>{
    order=await create('OrdenServicio',{equipo_id:'eq-a',ticket_id:ticket.id,sintoma:'Revisión con evidencia',tecnico_id:accounts.tech.technicianId,visible_cliente:true});
    const other=await create('OrdenServicio',{equipo_id:'eq-b',ticket_id:foreign.id,sintoma:'Otra revisión',tecnico_id:accounts.otherTech.technicianId,visible_cliente:true});
    for(const actor of [admin,sessions.coordinator,sessions.client,sessions.tech]){
      const listed=await call('ticket-attachments?orderId='+order.id,undefined,actor);assert.equal(listed.status,200);assert.equal(listed.data.files.length,3);assert.ok(listed.data.files.some(row=>row.id===file.id));
      const downloaded=await call(`attachments/${file.id}/file?orderId=${order.id}`,undefined,actor);assert.equal(downloaded.status,200);assert.deepEqual(downloaded.data,bytes);
    }
    for(const actor of [sessions.foreign,sessions.otherTech])assert.equal((await call('ticket-attachments?orderId='+order.id,undefined,actor)).status,404);
    assert.equal((await call(`attachments/${file.id}/file?orderId=${other.id}`,undefined,sessions.otherTech)).status,404);
    assert.equal((await call(`ticket-attachments?ticketId=${foreign.id}&orderId=${order.id}`,undefined,sessions.tech)).status,404);
    assert.equal((await call('attachments?orderId='+order.id,undefined,admin)).data.files.length,0);
    const [rows]=await pool.query('SELECT COUNT(*) AS n FROM em_attachments');assert.equal(rows[0].n,3);
  });
  await t.test('límite concurrente, cierre sin borrado y revocación de asignación',async()=>{
    if(external){await storage.organize();await storage.organize();assert.equal(locations.size,3);for(const destination of locations.values()){let folder=folders.get(destination);while(folder.parent!=='synthetic-private-root')folder=folders.get(folder.parent);assert.equal(folder.name,'Solicitudes','La orden consulta el original de la solicitud');}}
    for(let n=0;n<6;n++)assert.equal((await call('ticket-attachments',{...body,requestId:randomUUID(),base64:(await photo(130+n)).toString('base64')},admin)).status,201);
    const lastSlot=await Promise.all([148,149].map(async r=>call('ticket-attachments',{...body,requestId:randomUUID(),base64:(await photo(r)).toString('base64')},admin)));
    assert.deepEqual(lastSlot.map(r=>r.status).sort(),[201,400]);
    assert.equal((await call('ticket-attachments',{...body,requestId:randomUUID(),base64:(await photo(150)).toString('base64')},admin)).status,400);
    const current=(await readSnapshot(pool)).entities.OrdenServicio.find(r=>r.id===order.id);
    const edit=await call('mutate',{revision:0,action:'update',entity:'OrdenServicio',id:order.id,fields:{tecnico_id:accounts.otherTech.technicianId,expected_updated_at:current.fecha_actualizacion}},admin);assert.equal(edit.status,200,JSON.stringify(edit.data));
    assert.equal((await call(`attachments/${file.id}/file?orderId=${order.id}`,undefined,sessions.tech)).status,404);
    assert.equal((await call(`attachments/${file.id}/file?orderId=${order.id}`,undefined,sessions.otherTech)).status,200);
    const cancelledOrder=edit.data.result;
    assert.equal((await call('mutate',{revision:0,action:'update',entity:'OrdenServicio',id:order.id,fields:{estado:'Cancelada',expected_updated_at:cancelledOrder.fecha_actualizacion}},admin)).status,200);
    const original=(await readSnapshot(pool)).entities.Ticket.find(r=>r.id===ticket.id);
    assert.equal((await call('mutate',{revision:0,action:'update',entity:'Ticket',id:ticket.id,fields:{estado:'Cancelado',cancelacion_motivo:'El cliente cancela el servicio de prueba',expected_updated_at:original.fecha_actualizacion}},admin)).status,200);
    assert.equal((await call('ticket-attachments',{...body,requestId:randomUUID()},admin)).status,409);
    assert.equal((await call(`attachments/${file.id}/file`,undefined,sessions.client)).status,200);
  });
  await t.test('respaldo completo conserva fotos de ticket y restaura bytes, vínculo, autor y fecha',async()=>{
    const response=await call('admin/full-backup',undefined,admin);assert.equal(response.status,200);
    const lines=response.data.toString().trimEnd().split('\n'),entries=lines.map(line=>JSON.parse(line)),footer=entries.at(-1);
    assert.equal(footer.sha256,createHash('sha256').update(lines.slice(0,-1).join('\n')+'\n').digest('hex'));assert.equal(footer.counts.attachment,10);
    const restored=entries.find(entry=>entry.type==='attachment'&&entry.file.metadata.id===file.id).file;
    assert.equal(restored.metadata.ticket_id,ticket.id);assert.equal(restored.metadata.order_id,'');
    await pool.execute('DELETE FROM em_attachments WHERE id=?',[file.id]);
    assert.equal((await call('admin/attachments/restore',{file:restored},admin)).status,201);
    assert.equal((await call('admin/attachments/restore',{file:restored},admin)).status,200);
    const [rows]=await pool.execute('SELECT * FROM em_attachments WHERE id=?',[file.id]);for(const [key,value] of Object.entries(restored.metadata))assert.equal(rows[0][key],value,key);assert.deepEqual(rows[0].content,bytes);
    const invalid={...restored,metadata:{...restored.metadata,order_id:order.id}};assert.equal((await call('admin/attachments/restore',{file:invalid},admin)).status,400);
    const orphan={...restored,metadata:{...restored.metadata,id:randomUUID(),request_id:randomUUID(),ticket_id:'missing'}};assert.equal((await call('admin/attachments/restore',{file:orphan},admin)).status,409);
    assert.equal((await call(`attachments/${file.id}/file?orderId=${order.id}`,undefined,sessions.otherTech)).status,200);
  });
  await t.test('un fallo de auditoría revierte el archivo y el reintento guarda una sola copia',async()=>{
    const target=await create('Ticket',{equipo_id:'eq-a',titulo:'Reintento transaccional',descripcion:'Prueba sintética de recuperación'});
    const attempt={...body,ticketId:target.id,requestId:randomUUID()};
    const getConnection=pool.getConnection.bind(pool);
    pool.getConnection=async()=>{const conn=await getConnection();return new Proxy(conn,{get(object,key){
      const value=object[key];
      if(key==='execute')return(sql,args)=>{if(sql.startsWith('INSERT INTO em_security_events')&&args[3]==='ticket.photo.added')throw Error('Synthetic audit failure');return value.call(object,sql,args);};
      return typeof value==='function'?value.bind(object):value;
    }});};
    try {assert.equal((await call('ticket-attachments',attempt,admin)).status,500);}finally{pool.getConnection=getConnection;}
    const [rows]=await pool.execute('SELECT id FROM em_attachments WHERE request_id=?',[attempt.requestId]);assert.equal(rows.length,0);
    assert.equal((await call('ticket-attachments',attempt,admin)).status,201);
    assert.equal((await call('ticket-attachments',attempt,admin)).status,200);
  });
  if(external)await t.test('un fallo de Drive no crea el adjunto; reintento conserva el ID remoto reservado',async()=>{
    const target=await create('Ticket',{equipo_id:'eq-a',titulo:'Drive temporalmente sin conexión',descripcion:'Prueba sintética de recuperación'});
    const newBytes=await photo(234),attempt={...body,ticketId:target.id,requestId:randomUUID(),base64:newBytes.toString('base64')};
    remoteFailure=true;assert.equal((await call('ticket-attachments',attempt,admin)).status,503);remoteFailure=false;
    const [before]=await pool.execute('SELECT * FROM em_drive_blobs WHERE sha256=?',[createHash('sha256').update(newBytes).digest('hex')]);assert.equal(before[0].ready,0);
    const [absent]=await pool.execute('SELECT id FROM em_attachments WHERE request_id=?',[attempt.requestId]);assert.equal(absent.length,0);
    assert.equal((await call('ticket-attachments',attempt,admin)).status,201);
    const [after]=await pool.execute('SELECT * FROM em_drive_blobs WHERE sha256=?',[before[0].sha256]);assert.equal(after[0].file_id,before[0].file_id);assert.equal(after[0].ready,1);
  });
});
