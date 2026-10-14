import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import {createDriveStorage} from './drive-storage.mjs';
import {migrate,readDatabase,readSnapshot,saveDatabase} from './database.mjs';
import {createApp} from './app.mjs';
import {token} from './security.mjs';
import {createFileStore} from './file-storage.mjs';
import {DriveStorageError} from './drive-storage.mjs';

test('Videos privados: cuatro perfiles, reintentos, rangos y recuperación',{skip:process.env.MYSQL_INTEGRATION!=='1',timeout:600000},async t=>{
  const host=process.env.TEST_DB_HOST||'127.0.0.1';assert.ok(['127.0.0.1','localhost','::1'].includes(host));
  const config={host,port:Number(process.env.TEST_DB_PORT||3306),user:process.env.TEST_DB_USER||'root',password:process.env.TEST_DB_PASSWORD};assert.ok(config.password);
  const name=`em_ci_${randomUUID().replaceAll('-','')}`,control=await mysql.createConnection(config);await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
  const pool=mysql.createPool({...config,database:name,connectionLimit:5});let server;
  t.after(async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await pool.end();assert.match(name,/^em_ci_[a-f0-9]{32}$/);await control.query(`DROP DATABASE ${name}`);await control.end();});
  await migrate(pool);await migrate(pool);
  const remote=new Map(),parts=new Map(),folders=new Map(),locations=new Map();let lost=false;
  const live=process.env.LIVE_DRIVE_TEST==='1';
  const real=live?createDriveStorage({clientId:process.env.GOOGLE_DRIVE_CLIENT_ID,clientSecret:process.env.GOOGLE_DRIVE_CLIENT_SECRET,refreshToken:process.env.GOOGLE_DRIVE_REFRESH_TOKEN,folderId:process.env.GOOGLE_DRIVE_FOLDER_ID,ownerEmail:process.env.GOOGLE_DRIVE_OWNER_EMAIL}):null;
  const provider={
    rootId:real?.rootId||'synthetic-private-root',verifyFolder:async()=>({private:true}),
    reserve:async()=>real?real.reserve():randomUUID(),
    folder:async(id,name,parent)=>{folders.set(id,{name,parent});if(real)await real.folder(id,parent===real.rootId?'PRUEBA_'+name:name,parent);},
    move:async(id,destination,expected)=>{if(real)await real.move(id,destination,expected);locations.set(id,destination);},
    put:async(id,bytes,mime)=>{if(real)await real.put(id,bytes,mime);if(remote.has(id))assert.deepEqual(remote.get(id),bytes);remote.set(id,bytes);},
    get:async(id,size,sha)=>{const bytes=real?await real.get(id,size,sha):remote.get(id);assert.equal(bytes.length,size);assert.equal(createHash('sha256').update(bytes).digest('hex'),sha);return bytes;},
    range:async(id,size,sha,start,end)=>real?real.range(id,size,sha,start,end):remote.get(id).subarray(start,end+1),
    video:{
      start:async(id,size,sha)=>{if(real)return real.video.start(id,size,sha);if(remote.has(id))return {location:'',offset:size};parts.set(id,Buffer.alloc(0));return {location:id,offset:0};},
      progress:async(id,location,size,sha)=>real?real.video.progress(id,location,size,sha):remote.has(id)?size:parts.get(id)?.length??-1,
      chunk:async(location,offset,size,bytes)=>{let result;if(real)result=await real.video.chunk(location,offset,size,bytes);else{const previous=parts.get(location);assert.equal(previous.length,offset);const next=Buffer.concat([previous,bytes]);parts.set(location,next);if(next.length===size)remote.set(location,next);result=next.length;}if(lost){lost=false;throw new DriveStorageError('DRIVE_NETWORK','Prueba de conexión interrumpida');}return result;},
    },
  };
  const storage=createFileStore(pool,provider);
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
  const clip=await fs.readFile(new URL('./fixtures/video-qa.mp4',import.meta.url));
  const padding=Buffer.alloc(5*1024*1024);padding.writeUInt32BE(padding.length);padding.write('free',4);
  const bytes=Buffer.concat([clip,padding]),sha256=createHash('sha256').update(bytes).digest('hex');
  const body={ticketId:ticket.id,requestId:randomUUID(),name:'Prueba de video.mp4',size:bytes.length,sha256};
  let file,order;
  async function chunk(id,offset,part,actor=sessions.client){const r=await fetch(`${url}/api/videos/${id}/chunk?offset=${offset}`,{method:'POST',headers:{...headers(actor),'Content-Type':'application/octet-stream'},body:part});return {status:r.status,data:await r.json()};}
  async function upload(input,actor,content=bytes){const initial=await call('videos/start',input,actor);assert.equal(initial.status,200,JSON.stringify(initial.data));if(initial.data.file)return initial.data.file;let offset=initial.data.offset;while(offset<content.length){const r=await chunk(input.requestId,offset,content.subarray(offset,offset+1024*1024),actor);assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.offset>offset);offset=r.data.offset;}const final=await call(`videos/${input.requestId}/finish`,{},actor);assert.equal(final.status,201,JSON.stringify(final.data));return final.data.file;}
  await t.test('rechaza anónimo, cliente ajeno, técnico sin alcance, tamaños y CSRF',async()=>{
    assert.equal((await call('videos/start',body)).status,401);
    for(const actor of [sessions.foreign,sessions.tech,sessions.otherTech])assert.equal((await call('videos/start',body,actor)).status,404);
    assert.equal((await call('videos/start',{...body,ticketId:foreign.id},sessions.client)).status,404);
    assert.equal((await call('videos/start',{...body,size:25*1024*1024+1},admin)).status,400);
    const unsafe=headers(admin);delete unsafe['X-CSRF-Token'];assert.equal((await fetch(url+'/api/videos/start',{method:'POST',headers:unsafe,body:JSON.stringify(body)})).status,403);
  });
  await t.test('reanuda después de una respuesta perdida sin copiar ni revelar la sesión de Drive',async()=>{
    const initial=await call('videos/start',body,sessions.client);assert.equal(initial.status,200);assert.equal(initial.data.offset,0);assert.deepEqual(Object.keys(initial.data).sort(),['chunkSize','offset']);
    assert.equal((await chunk(body.requestId,0,bytes.subarray(0,1024*1024),sessions.foreign)).status,404);
    assert.equal((await chunk(body.requestId,0,bytes.subarray(0,1024*1024+1))).status,413);
    lost=true;assert.equal((await chunk(body.requestId,0,bytes.subarray(0,1024*1024))).status,503);
    const resumed=await call('videos/start',body,sessions.client);assert.equal(resumed.data.offset,1024*1024,JSON.stringify(resumed));
    const repeated=await chunk(body.requestId,0,bytes.subarray(0,1024*1024));assert.equal(repeated.data.offset,1024*1024);
    file=await upload(body,sessions.client);assert.equal(file.mime,'video/mp4');
    assert.equal((await upload(body,sessions.client)).id,file.id);
    const [rows]=await pool.query('SELECT * FROM em_attachments');assert.equal(rows.length,1);assert.equal(rows[0].content.length,0);assert.equal(rows[0].storage_key,sha256);
    for(const actor of [admin,sessions.coordinator])assert.equal((await upload({...body,requestId:randomUUID()},actor)).id,file.id);
  });
  await t.test('los cuatro perfiles reproducen el original desde la orden; rangos y permisos cruzados',async()=>{
    order=await create('OrdenServicio',{equipo_id:'eq-a',ticket_id:ticket.id,sintoma:'Prueba video',tecnico_id:accounts.tech.technicianId,visible_cliente:true});
    for(const actor of [admin,sessions.coordinator,sessions.client,sessions.tech]){
      const list=await call('ticket-attachments?orderId='+order.id,undefined,actor);assert.equal(list.data.files[0].id,file.id);
      const result=await fetch(`${url}/api/attachments/${file.id}/file?orderId=${order.id}`,{headers:{...headers(actor),Range:'bytes=100-199'}});assert.equal(result.status,206);assert.equal(result.headers.get('content-range'),`bytes 100-199/${bytes.length}`);assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes.subarray(100,200));
    }
    for(const actor of [sessions.foreign,sessions.otherTech])assert.equal((await call(`attachments/${file.id}/file?orderId=${order.id}`,undefined,actor)).status,404);
    assert.equal((await fetch(`${url}/api/attachments/${file.id}/file`,{headers:{...headers(admin),Range:`bytes=${bytes.length}-`}})).status,416);
    assert.equal((await call('attachments?orderId='+order.id,undefined,admin)).data.files.length,0);
    for(const actor of [sessions.client])assert.equal((await call('videos/start',{...body,ticketId:undefined,orderId:order.id,category:'Antes',requestId:randomUUID()},actor)).status,403);
    const report=await upload({...body,ticketId:undefined,orderId:order.id,category:'Antes',requestId:randomUUID()},sessions.tech);
    assert.notEqual(report.id,file.id);assert.equal(report.sha256,file.sha256);
    const [blobs]=await pool.query('SELECT * FROM em_drive_blobs WHERE sha256=?',[sha256]);assert.equal(blobs.length,1,'Contenido idéntico sigue en una sola copia');
    await storage.organize();assert.equal(locations.size,1);
  });
  await t.test('rechaza un archivo falso aunque su extensión sea mp4',async()=>{
    const invalid=Buffer.alloc(32);invalid.writeUInt32BE(32);invalid.write('ftyp',4);
    const input={...body,requestId:randomUUID(),size:invalid.length,sha256:createHash('sha256').update(invalid).digest('hex')};
    assert.equal((await call('videos/start',input,admin)).status,200);assert.equal((await chunk(input.requestId,0,invalid,admin)).status,200);
    assert.equal((await call(`videos/${input.requestId}/finish`,{},admin)).status,400);
    const [rows]=await pool.execute('SELECT id FROM em_attachments WHERE request_id=?',[input.requestId]);assert.equal(rows.length,0);
  });
  await t.test('respaldo mayor a 4 MB recupera bytes, identidades, permisos e historial',async()=>{
    const before=(await readSnapshot(pool)).entities.Bitacora;
    const backup=await call('admin/full-backup',undefined,admin);assert.equal(backup.status,200);
    const lines=backup.data.toString().trimEnd().split('\n'),entries=lines.map(JSON.parse);assert.equal(entries.at(-1).sha256,createHash('sha256').update(lines.slice(0,-1).join('\n')+'\n').digest('hex'));
    const stored=entries.find(e=>e.type==='attachment'&&e.file.metadata.id===file.id).file;assert.deepEqual(Buffer.from(stored.base64,'base64'),bytes);
    await pool.execute('DELETE FROM em_attachments WHERE id=?',[file.id]);
    assert.equal((await call('admin/attachments/restore',{file:stored},admin)).status,201);
    assert.equal((await call('admin/attachments/restore',{file:stored},admin)).status,200);
    const [rows]=await pool.execute('SELECT * FROM em_attachments WHERE id=?',[file.id]);for(const [key,value] of Object.entries(stored.metadata))assert.equal(rows[0][key],value);assert.equal(rows[0].content.length,0);
    assert.deepEqual((await readSnapshot(pool)).entities.Bitacora,before);
    const reopened=await call(`attachments/${file.id}/file?orderId=${order.id}`,undefined,sessions.tech);
    assert.deepEqual(reopened.data,bytes);assert.match(reopened.headers.get('content-security-policy'),/media-src 'self'/);assert.ok(!reopened.headers.get('content-security-policy').includes('sandbox'));
  });
});
