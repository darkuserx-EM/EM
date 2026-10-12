import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import sharp from 'sharp';
import mysql from 'mysql2/promise';
import { migrate, readDatabase, readSnapshot, saveDatabase } from './database.mjs';
import { createApp } from './app.mjs';
import { token } from './security.mjs';
import { migrateLegacyMedia, hydrateEquipment, cleanupMediaUploads } from './media.mjs';

test('Fotografías separadas: permisos, migración, integridad y recuperación completa', { skip: process.env.MYSQL_INTEGRATION !== '1', timeout: 180000 }, async t => {
  const host = process.env.TEST_DB_HOST || '127.0.0.1'; assert.ok(['127.0.0.1','localhost','::1'].includes(host));
  const config = { host, port: Number(process.env.TEST_DB_PORT || 3306), user: process.env.TEST_DB_USER || 'root', password: process.env.TEST_DB_PASSWORD }; assert.ok(config.password);
  const name = `em_ci_${randomUUID().replaceAll('-','')}`, control = await mysql.createConnection(config);
  await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`); const pool = mysql.createPool({...config,database:name}); let server;
  t.after(async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await pool.end(); assert.match(name,/^em_ci_[a-f0-9]{32}$/); await control.query(`DROP DATABASE ${name}`); await control.end(); });
  await migrate(pool); await migrate(pool);
  const png = await sharp({create:{width:960,height:720,channels:3,background:'#315d29'}}).png().toBuffer();
  const picture = `data:image/png;base64,${png.toString('base64')}`;
  const now = new Date().toISOString(), row = (id,codigo,fields) => ({id,codigo,creado_por:'qa-original',actualizado_por:'qa-original',fecha_creacion:now,fecha_actualizacion:now,...fields});
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction(); const before = await readDatabase(conn,true), db = structuredClone(before);
    for (const id of ['a','b']) {
      db.entities.Cliente.push(row(`client-${id}`,`CLI-${id}`,{nombre:`Cliente ${id} sintético`,estado:'Activo'}));
      db.entities.Equipo.push(row(`eq-${id}`,`TCE-${id}`,{marca:'QA',modelo:'Prueba',serie:`MEDIA-QA-${id}`,tipo:'Reach',propiedad:'De cliente',estado:'Disponible',cliente_id:`client-${id}`,foto_equipo:picture,placa_datos:picture}));
    }
    db.revision++; await saveDatabase(conn,db,before); await conn.commit();
  } finally { conn.release(); }
  const original = await readSnapshot(pool);
  await t.test('migra en lotes atómicos, reanuda y conserva bytes, identidad e historial', async () => {
    await assert.rejects(migrateLegacyMedia(pool,{batchSize:1,afterBatch:() => {throw new Error('interrupción simulada');}}),/interrupción/);
    const partial = await readSnapshot(pool); assert.match(partial.entities.Equipo[0].foto_equipo,/^media:/); assert.equal(partial.entities.Equipo[1].foto_equipo,picture);
    assert.deepEqual(await migrateLegacyMedia(pool),{migrated:1,images:2});
    assert.deepEqual(await migrateLegacyMedia(pool),{migrated:0,images:0});
    const migrated = await readSnapshot(pool); assert.deepEqual(await hydrateEquipment(pool,migrated.entities.Equipo),original.entities.Equipo);
    assert.deepEqual(migrated.entities.Bitacora,original.entities.Bitacora);
    const [copies] = await pool.query('SELECT equipment_id,payload FROM em_media_migration'); assert.equal(copies.length,2);
    for (const copy of copies) assert.deepEqual(JSON.parse(copy.payload),original.entities.Equipo.find(r=>r.id===copy.equipment_id));
    const [files] = await pool.query('SELECT content,thumbnail FROM em_media'); assert.equal(files.length,4);
    for (const file of files) { assert.deepEqual(file.content,png); assert.ok(file.thumbnail.length<png.length); const thumb=await sharp(file.thumbnail).metadata(); assert.ok(thumb.width<=480 && thumb.height<=360); }
  });
  const origin='http://localhost:3000', setupToken=token(), errors=[];
  server=createApp({pool,origin,setupToken,production:false,logger:entry=>errors.push(entry)}).listen(0,'127.0.0.1'); await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}/api/`; let serial=1;
  const headers = session => ({Origin:origin,'Content-Type':'application/json','X-Forwarded-For':`198.51.100.${serial++ % 250 + 1}`,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{})});
  async function call(path,body,session) { const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:headers(session),body:body===undefined?undefined:JSON.stringify(body)}); return {status:r.status,headers:r.headers,data:await r.json()}; }
  async function login(email,password) { const r=await call('login',{email,password}); assert.equal(r.status,200); const s={cookie:r.headers.getSetCookie()[0].split(';')[0],csrf:''}; const session=(await call('session',undefined,s)).data; s.csrf=session.csrf;if(session.mustChangePassword)assert.equal((await call('password',{currentPassword:password,newPassword:password+' changed'},s)).status,200);return s; }
  const password='Synthetic media test password 2026!'; assert.equal((await call('setup',{setupToken,email:'admin@example.invalid',name:'QA Media',password})).status,201);
  const admin=await login('admin@example.invalid',password);
  const createUser=async(role,email,extra={})=>{const r=await call('admin/users',{name:'Cuenta sintética',email,role,days:7,specialty:'Diagnóstico sintético',...extra},admin);assert.equal(r.status,201,JSON.stringify(r.data));return {...await login(r.data.email,r.data.password),...r.data};};
  const a=await createUser('Cliente','a@example.invalid',{clientId:'client-a'}),b=await createUser('Cliente','b@example.invalid',{clientId:'client-b'});
  const tech=await createUser('Técnico','tech@example.invalid'),otherTech=await createUser('Técnico','other@example.invalid');
  async function mutate(action,entity,fields,id,extra={}) { const revision=(await call('database',undefined,admin)).data.revision; return call('mutate',{action,entity,fields,id,revision,...extra},admin); }
  const order=await mutate('create','OrdenServicio',{equipo_id:'eq-a',sintoma:'Prueba sintética',estado:'Programada',tecnico_id:tech.technicianId,fecha_programada:'2026-10-11',visible_cliente:true}); assert.equal(order.status,200,JSON.stringify(order.data));
  let current=(await call('database',undefined,admin)).data.entities.Equipo.find(r=>r.id==='eq-a');
  const imageUrl=(equipment,field='foto_equipo',preview=false)=>`equipment-images/${equipment.id}/${field}/${equipment[field].slice(6)}${preview?'?preview=1':''}`;
  await t.test('guardar solo datos no lee binarios y la exportación no incluye fotos',async()=>{
    const statements=[]; const getConnection=pool.getConnection.bind(pool);
    pool.getConnection=async()=>{const conn=await getConnection();return new Proxy(conn,{get(target,key){const value=target[key];if(['query','execute'].includes(key))return(...args)=>{statements.push(args[0]);return value.apply(target,args);};return typeof value==='function'?value.bind(target):value;}});};
    try {
      assert.equal((await mutate('update','Equipo',{notas:'Verificación sin imágenes'},'eq-a')).status,200);
      assert.equal(statements.some(sql=>/FROM em_media(?:\s|$)/.test(sql)),false);
    } finally {pool.getConnection=getConnection;}
    const exported=await call('equipment-export',{ids:['eq-a']},admin);
    assert.equal(exported.status,200);assert.equal(exported.data.includesImages,false);
    assert.equal(exported.data.rows[0].foto_equipo,undefined);assert.ok(!JSON.stringify(exported.data).includes('data:'));
    await assert.rejects(hydrateEquipment(pool,[current],{maxBytes:1}),error=>error.status===413);
  });
  await t.test('original y miniatura requieren sesión y equipo autorizado; reasignar revoca acceso', async()=>{
    for (const preview of [false,true]) {
      for (const actor of [admin,a,tech]) {const r=await fetch(url+imageUrl(current,'foto_equipo',preview),{headers:headers(actor)});assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());if(!preview)assert.deepEqual(bytes,png);else assert.ok(bytes.length<png.length);assert.equal(r.headers.get('cache-control'),'private, no-cache');}
      for(const actor of [undefined,b,otherTech]) assert.equal((await fetch(url+imageUrl(current,'foto_equipo',preview),{headers:headers(actor)})).status,actor?404:401);
    }
    const tag=`"${current.foto_equipo.slice(6)}-original"`;
    assert.equal((await fetch(url+imageUrl(current),{headers:{...headers(a),'If-None-Match':tag,'Cache-Control':'max-age=0'}})).status,304);
    assert.equal((await fetch(url+imageUrl(current),{headers:{...headers(b),'If-None-Match':tag}})).status,404);
    const unassigned=(await call('database',undefined,admin)).data.entities.Equipo.find(r=>r.id==='eq-b');
    const reassigned=await mutate('update','Equipo',{cliente_id:'client-a'},'eq-b');assert.equal(reassigned.status,200,JSON.stringify(reassigned.data));
    assert.equal((await fetch(url+imageUrl(unassigned),{headers:headers(b)})).status,404);
    assert.equal((await mutate('update','Equipo',{cliente_id:'client-b'},'eq-b')).status,200);
  });
  const jpg=await sharp(png).jpeg().toBuffer();
  async function upload(bytes=jpg,session=admin,{id=randomUUID(),field='foto_frontal',mime='image/jpeg',extra={}}={}) {
    const r=await fetch(url+'equipment-media/upload',{method:'POST',headers:{...headers(session),'Content-Type':mime,'X-Upload-ID':id,'X-Equipment-Field':field,...extra},body:bytes});return {status:r.status,data:await r.json()};
  }
  let receipt;
  await t.test('la subida binaria autentica antes de procesar, valida formato/tamaño y es idempotente',async()=>{
    assert.equal((await upload(jpg,null)).status,401); assert.equal((await upload(Buffer.alloc(200000),a)).status,403);assert.equal((await upload(jpg,tech)).status,403);
    assert.equal((await upload(jpg,admin,{extra:{Origin:'https://other.invalid'}})).status,403);assert.equal((await upload(jpg,admin,{extra:{'X-CSRF-Token':'wrong'}})).status,403);
    assert.equal((await upload(jpg,admin,{mime:'text/html'})).status,403);assert.equal((await upload(Buffer.from([255,216,255,0,1,2]),admin)).status,400);
    assert.equal((await upload(Buffer.alloc(2624971),admin)).status,413);assert.equal((await upload(jpg,admin,{field:'otro'})).status,400);
    const id=randomUUID();receipt=await upload(jpg,admin,{id});assert.equal(receipt.status,201,JSON.stringify(receipt.data));assert.deepEqual((await upload(jpg,admin,{id})).data,receipt.data);
    assert.equal((await upload(png,admin,{id,mime:'image/png'})).status,409);
    const r=await fetch(url+'mutate',{method:'POST',headers:{...headers(admin),'Content-Type':'image/jpeg'},body:jpg});assert.equal(r.status,403);
  });
  await t.test('una huella no permite adjuntar fotos ajenas; recibo enlazado a actor, equipo y campo',async()=>{
    assert.equal((await mutate('update','Equipo',{foto_frontal:receipt.data.reference},'eq-a')).status,400);
    const saved=await mutate('update','Equipo',{foto_frontal:receipt.data.reference},'eq-a',{mediaUploads:{foto_frontal:receipt.data.uploadId}});assert.equal(saved.status,200,JSON.stringify(saved.data));
    current=saved.data.result;assert.ok(!JSON.stringify(saved.data).includes('base64'));
    assert.equal((await mutate('update','Equipo',{foto_frontal:receipt.data.reference},'eq-b',{mediaUploads:{foto_frontal:receipt.data.uploadId}})).status,400);
    assert.equal((await mutate('update','Equipo',{foto_trasera:receipt.data.reference},'eq-a',{mediaUploads:{foto_trasera:receipt.data.uploadId}})).status,400);
    assert.deepEqual(Buffer.from(await (await fetch(url+imageUrl(current,'foto_frontal'),{headers:headers(a)})).arrayBuffer()),jpg);
    const [stored]=await pool.execute("SELECT payload FROM em_records WHERE entity='Equipo' AND id='eq-a'");assert.ok(!stored[0].payload.includes('base64'));
  });
  let archive, backupEntries;
  await t.test('respaldo consistente contiene registros y todos los binarios, incluso fotos retiradas',async()=>{
    assert.equal((await mutate('update','Equipo',{foto_frontal:''},'eq-a')).status,200);
    assert.equal((await fetch(url+imageUrl(current,'foto_frontal'),{headers:headers(a)})).status,404);
    for(const actor of [undefined,a,tech])assert.equal((await fetch(url+'admin/full-backup',{headers:headers(actor)})).status,actor?403:401);
    const uploaded=await call('attachments',{orderId:order.data.result.id,requestId:randomUUID(),category:'Antes',name:'prueba.jpg',base64:jpg.toString('base64')},admin);assert.equal(uploaded.status,201);
    const response=await fetch(url+'admin/full-backup',{headers:headers(admin)});assert.equal(response.status,200);archive=await response.text();backupEntries=archive.trimEnd().split('\n').map(JSON.parse);
    const footer=backupEntries.at(-1);assert.equal(footer.sha256,createHash('sha256').update(archive.slice(0,archive.lastIndexOf(JSON.stringify(footer)))).digest('hex'));
    assert.equal(footer.counts.media,5);assert.equal(footer.counts.attachment,1);
    assert.equal(backupEntries.filter(x=>x.type==='record').length,footer.counts.record);
    assert.ok(!JSON.stringify(backupEntries.filter(x=>x.type==='record')).includes('base64'));
    assert.equal(backupEntries.filter(x=>x.type==='media'&&x.file.metadata.field==='foto_frontal').length,1);
  });
  await t.test('recupera en base operativa vacía, rechaza corrupción, reanuda y no pierde auditoría',async()=>{
    const old=await readSnapshot(pool),beforeAudit=old.entities.Bitacora;
    // Destructive operations are confined to this test's generated database.
    await pool.query("DELETE FROM em_records WHERE entity<>'Catalogos'");await pool.query('DELETE FROM em_media');await pool.query('DELETE FROM em_attachments');
    const db={schemaVersion:1,revision:1,entities:Object.fromEntries(Object.keys(old.entities).map(k=>[k,[]]))};
    for(const entry of backupEntries)if(entry.type==='record')db.entities[entry.entity].push(entry.record);
    let revision=(await call('database',undefined,admin)).data.revision;
    assert.equal((await call('mutate',{action:'restore',database:db,revision},admin)).status,409);
    for(const entry of backupEntries.filter(x=>x.type==='media')) {
      assert.equal((await call('admin/media/restore',{file:entry.file},a)).status,403);
      assert.equal((await call('admin/media/restore',{file:{...entry.file,metadata:{...entry.file.metadata,sha256:'0'.repeat(64)}}},admin)).status,400);
      assert.equal((await call('admin/media/restore',{file:entry.file},admin)).status,201);
      assert.equal((await call('admin/media/restore',{file:entry.file},admin)).data.duplicate,true);
    }
    const restored=await call('mutate',{action:'restore',database:db,revision},admin);assert.equal(restored.status,200,JSON.stringify(restored.data));
    for(const entry of backupEntries.filter(x=>x.type==='attachment'))assert.equal((await call('admin/attachments/restore',{file:entry.file},admin)).status,201);
    const after=await readSnapshot(pool);for(const entity of Object.keys(old.entities))if(entity!=='Bitacora')assert.deepEqual(after.entities[entity],old.entities[entity]);
    assert.ok(after.entities.Bitacora.length>=beforeAudit.length);
    // A second recovery preserves the current audit and immutable file identities.
    revision=after.revision;const r=await call('mutate',{action:'restore',database:db,revision},admin);assert.equal(r.status,200);assert.equal(r.data.database.entities.Bitacora.length,0);assert.ok((await readSnapshot(pool)).entities.Bitacora.length>after.entities.Bitacora.length);
    const media=backupEntries.find(x=>x.type==='media').file;
    assert.equal((await call('admin/media/restore',{file:{...media,metadata:{...media.metadata,uploaded_by:'otro'}}},admin)).status,409);
    const [stored]=await pool.query('SELECT content,sha256 FROM em_media');assert.equal(stored.length,5);for(const f of stored)assert.equal(createHash('sha256').update(f.content).digest('hex'),f.sha256);
  });
  await t.test('limpia recibos vencidos sin borrar originales ni fotos retiradas',async()=>{
    await pool.query('UPDATE em_media_uploads SET expires_at=1');assert.equal(await cleanupMediaUploads(pool),1);
    const [[count]]=await pool.query('SELECT COUNT(*) AS n FROM em_media');assert.equal(Number(count.n),5);
  });
  await t.test('un respaldo con referencia faltante o binario corrupto no emite cierre válido',async()=>{
    const active=(await readSnapshot(pool)).entities.Equipo[0];const hash=active.foto_equipo.slice(6);
    await pool.execute("UPDATE em_media SET sha256=? WHERE equipment_id=? AND field='foto_equipo' AND hash=?",['0'.repeat(64),active.id,hash]);
    await assert.rejects(async()=>{const r=await fetch(url+'admin/full-backup',{headers:headers(admin)});await r.text();});assert.equal(errors.length,1);
    assert.ok(!JSON.stringify(errors).includes(png.toString('base64')));
  });
});
