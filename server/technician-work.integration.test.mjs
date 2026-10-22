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

test('Trabajo del técnico: permisos, concurrencia, reapertura e integridad',{skip:process.env.MYSQL_INTEGRATION!=='1',timeout:600000},async t=>{
  const host=process.env.TEST_DB_HOST||'127.0.0.1';assert.ok(['127.0.0.1','localhost','::1'].includes(host));
  const config={host,port:Number(process.env.TEST_DB_PORT||3306),user:process.env.TEST_DB_USER||'root',password:process.env.TEST_DB_PASSWORD};assert.ok(config.password);
  const name=`em_ci_${randomUUID().replaceAll('-','')}`,control=await mysql.createConnection(config);await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
  const pool=mysql.createPool({...config,database:name,connectionLimit:5});let server;
  t.after(async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await pool.end();assert.match(name,/^em_ci_[a-f0-9]{32}$/);await control.query(`DROP DATABASE ${name}`);await control.end();});
  await migrate(pool);await migrate(pool);
  const remote=new Map(),parts=new Map(),folders=new Map(),locations=new Map();let lost=false;
  const live=false;
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
  for(const [id,role,clientId] of [['client','Cliente','client-a'],['foreign','Cliente','client-b'],['tech','Técnico'],['otherTech','Técnico'],['thirdTech','Técnico'],['coordinator','Coordinador']]){
    const account=await call('admin/users',{name:id+' PRUEBA',email:id+'@example.invalid',role,clientId,currentPassword:password,specialty:"Pruebas de fotografías",days:7},admin);assert.equal(account.status,201,JSON.stringify(account.data));accounts[id]=account.data;sessions[id]=await login(account.data.email,account.data.password);
  }
  async function create(entity,fields,actor=admin){const revision=(await call('database',undefined,admin)).data.revision;const r=await call('mutate',{revision,action:'create',entity,fields},actor);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.result;}
  async function mutate(entity,action,fields,actor=admin,id){const snapshot=await readSnapshot(pool);if(action==='update')fields={expected_updated_at:snapshot.entities[entity].find(row=>row.id===id)?.fecha_actualizacion,...fields};return call('mutate',{revision:snapshot.revision,action,entity,fields,id},actor);}
  async function update(entity,row,fields,actor=admin){const r=await mutate(entity,'update',{...fields,expected_updated_at:row.fecha_actualizacion},actor,row.id);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.result;}
  const date='2026-10-14',tech=accounts.tech.technicianId;
  await t.test('cancelación con motivo, cuatro perfiles y órdenes asociadas',async()=>{
    const ticket=await create('Ticket',{equipo_id:'eq-a',titulo:'Cancelar prueba',descripcion:'Conservar descripción'},sessions.client);
    const fields={estado:'Cancelado',cancelacion_motivo:'El cliente cancela la visita de prueba'};
    for(const role of ['tech','client'])assert.equal((await mutate('Ticket','update',fields,sessions[role],ticket.id)).status,403);
    assert.equal((await mutate('Ticket','update',{estado:'Cancelado'},admin,ticket.id)).status,400);
    const order=await create('OrdenServicio',{equipo_id:'eq-a',ticket_id:ticket.id,sintoma:'Visita de prueba'});
    assert.equal((await mutate('Ticket','update',fields,admin,ticket.id)).status,400);
    await update('OrdenServicio',order,{estado:'Cancelada'});
    const result=await mutate('Ticket','update',fields,sessions.coordinator,ticket.id);assert.equal(result.status,200,JSON.stringify(result.data));
    assert.equal(result.data.result.descripcion,ticket.descripcion);
    const snapshot=await readSnapshot(pool);assert.equal(snapshot.entities.OrdenServicio.find(r=>r.id===order.id).estado,'Cancelada');
    assert.ok(snapshot.entities.Bitacora.some(r=>r.ticket_id===ticket.id&&r.accion==='Cancelación de solicitud'&&r.motivo===fields.cancelacion_motivo));
    const race=await create('Ticket',{equipo_id:'eq-a',titulo:'Concurrencia cancelación',descripcion:'No puede quedar cancelada con una orden abierta'});
    const outcomes=await Promise.all([
      mutate('Ticket','update',fields,admin,race.id),
      mutate('OrdenServicio','create',{equipo_id:'eq-a',ticket_id:race.id,sintoma:'Alta concurrente'},sessions.coordinator),
    ]);
    assert.equal(outcomes.filter(r=>r.status===200).length,1,JSON.stringify(outcomes.map(r=>({status:r.status,data:r.data}))));
    const after=await readSnapshot(pool),closed=after.entities.Ticket.find(r=>r.id===race.id).estado==='Cancelado';
    assert.equal(after.entities.OrdenServicio.some(r=>r.ticket_id===race.id),!closed);

  });

  let ticket=await create('Ticket',{equipo_id:'eq-a',titulo:'Cadena floja',descripcion:'Solicitud sintética con video'},sessions.client);
  const clip=await fs.readFile(new URL('./fixtures/video-qa.mp4',import.meta.url));
  const requestId=randomUUID(),sha256=createHash('sha256').update(clip).digest('hex');
  assert.equal((await call('videos/start',{ticketId:ticket.id,requestId,name:'Cadena.mp4',size:clip.length,sha256},sessions.client)).status,200);
  const chunk=await fetch(`${url}/api/videos/${requestId}/chunk?offset=0`,{method:'POST',headers:{...headers(sessions.client),'Content-Type':'application/octet-stream'},body:clip});assert.equal(chunk.status,200);
  const finish=await call(`videos/${requestId}/finish`,{},sessions.client);assert.equal(finish.status,201);const file=finish.data.file;
  ticket=await update('Ticket',ticket,{responsable_id:tech,estado:'Programado',fecha_programada:date},sessions.coordinator);
  const fields={equipo_id:'eq-a',ticket_id:ticket.id,desde_solicitud:true,estado:'Programada',fecha_programada:date,sintoma:'Cadena floja'};
  let order;
  await t.test('administración, coordinador y técnico inician borrador y conservan versión e historial en avances',async()=>{
    for(const actor of [admin,sessions.coordinator,sessions.tech]){
      const draft=await create('OrdenServicio',{equipo_id:'eq-a',tecnico_id:tech,sintoma:'Atención continua sintética',estado:'Borrador'},actor);
      const started=await update('OrdenServicio',draft,{estado:'En proceso',fecha_programada:date},actor);
      assert.ok(started.fecha);assert.equal(started.visible_cliente,false);
      const advance=await update('OrdenServicio',started,{diagnostico:'Revisión parcial sin cierre'},actor);
      assert.equal(advance.fecha,started.fecha);assert.equal(advance.estado,'En proceso');
      const stale=await mutate('OrdenServicio','update',{trabajo_realizado:'Versión obsoleta',expected_updated_at:started.fecha_actualizacion},actor,draft.id);
      assert.equal(stale.status,409);
      const after=await readSnapshot(pool);assert.equal(after.entities.OrdenServicio.find(row=>row.id===draft.id).diagnostico,advance.diagnostico);
      assert.equal(after.entities.LecturaHorometro.some(row=>row.orden_id===draft.id),false);
    }
  });
  await t.test('autoriza únicamente al técnico asignado; rechaza cliente, técnico ajeno y publicación',async()=>{
    for(const actor of [sessions.client,sessions.foreign,sessions.otherTech])assert.equal((await mutate('OrdenServicio','create',fields,actor)).status,403);
    assert.equal((await mutate('OrdenServicio','create',{...fields,visible_cliente:true},sessions.tech)).status,403);
    assert.equal((await mutate('OrdenServicio','create',{...fields,tecnico_id:accounts.otherTech.technicianId},sessions.tech)).status,403);
    assert.equal((await mutate('OrdenServicio','create',{...fields,cliente_id:'client-b'},sessions.tech)).status,400);
  });
  await t.test('dos altas simultáneas crean una sola orden, sin duplicar evidencia ni cambiar la solicitud',async()=>{
    const before=await readSnapshot(pool),revision=before.revision;
    const results=await Promise.all([sessions.tech,sessions.coordinator].map(actor=>call('mutate',{revision,action:'create',entity:'OrdenServicio',fields:{...fields,tecnico_id:tech,solicitud_id:randomUUID()}},actor)));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);order=results.find(r=>r.status===200).data.result;
    assert.equal(order.tecnico_id,tech);assert.equal(order.visible_cliente,false);
    const after=await readSnapshot(pool);assert.equal(after.entities.OrdenServicio.filter(row=>row.ticket_id===ticket.id).length,1);
    assert.deepEqual(after.entities.Ticket.find(row=>row.id===ticket.id),before.entities.Ticket.find(row=>row.id===ticket.id));
    const [attachments]=await pool.query('SELECT id FROM em_attachments');assert.equal(attachments.length,1);assert.equal(attachments[0].id,file.id);
    assert.equal((await call('ticket-attachments?orderId='+order.id,undefined,sessions.client)).status,404);
    order=await update('OrdenServicio',order,{visible_cliente:true},sessions.coordinator);
    for(const actor of [admin,sessions.coordinator,sessions.tech,sessions.client]){
      const list=await call('ticket-attachments?orderId='+order.id,undefined,actor);assert.equal(list.data.files[0].id,file.id);
      assert.deepEqual((await call(`attachments/${file.id}/file?orderId=${order.id}`,undefined,actor)).data,clip);
    }
    for(const actor of [sessions.foreign,sessions.otherTech])assert.equal((await call(`attachments/${file.id}/file?orderId=${order.id}`,undefined,actor)).status,404);
  });
  await t.test('el técnico ejecuta y cierra su orden; solicitud e historial permanecen relacionados',async()=>{
    order=await update('OrdenServicio',order,{estado:'En proceso'},sessions.tech);
    order=await update('OrdenServicio',order,{estado:'Completada',diagnostico:'Cadena destensada',trabajo_realizado:'Ajuste de cadena',pruebas_realizadas:'Prueba de elevación',resultado_pruebas:'Correcto',recibido_por:'Responsable de pruebas'},sessions.tech);
    const db=await readSnapshot(pool),closed=db.entities.Ticket.find(row=>row.id===ticket.id);
    assert.equal(closed.estado,'Resuelto');assert.equal(closed.id,ticket.id);
    assert.equal((await mutate('Ticket','update',{estado:'En revisión',reapertura_motivo:'Cierre accidental sin orden'},admin,ticket.id)).status,403);
    assert.deepEqual((await call(`attachments/${file.id}/file?orderId=${order.id}`,undefined,sessions.tech)).data,clip);
  });
  await t.test('habilitaciones antiguas no limitan la creación; conserva el historial y los demás permisos',async()=>{
    const standalone={equipo_id:'eq-b',sintoma:'Inspección autorizada',estado:'Borrador'};
    assert.equal((await mutate('OrdenServicio','create',standalone,sessions.tech)).status,200);
    let technician=(await readSnapshot(pool)).entities.Tecnico.find(row=>row.id===tech);
    for(const actor of [sessions.tech,sessions.coordinator,sessions.client])assert.equal((await mutate('Tecnico','update',{equipos_habilitados:'["eq-b"]'},actor,tech)).status,403);
    technician=await update('Tecnico',technician,{equipos_habilitados:'["eq-b"]'});
    const visible=(await call('database',undefined,sessions.tech)).data;
    assert.ok(visible.entities.Equipo.some(row=>row.id==='eq-b'));assert.ok(visible.entities.Cliente.some(row=>row.id==='client-b'));
    let own=await create('OrdenServicio',standalone,sessions.tech);assert.equal(own.tecnico_id,tech);assert.equal(own.visible_cliente,false);
    own=await update('OrdenServicio',own,{estado:'Programada',fecha_programada:date},sessions.tech);
    assert.equal((await mutate('OrdenServicio','update',{tecnico_id:accounts.otherTech.technicianId},sessions.tech,own.id)).status,400);
    await update('Tecnico',technician,{equipos_habilitados:'[]'});
    own=await update('OrdenServicio',own,{estado:'Cancelada'},sessions.coordinator);
    assert.equal((await mutate('OrdenServicio','create',standalone,sessions.tech)).status,200);
    assert.equal((await call('database',undefined,sessions.tech)).data.entities.OrdenServicio.find(row=>row.id===own.id).id,own.id,'Revocar la habilitación conserva el historial propio');
  });
  await t.test('tres participantes comparten orden y concurrencia sin duplicados',async()=>{
    let shared=await create('OrdenServicio',{equipo_id:'eq-a',sintoma:'Trabajo compartido',estado:'En proceso',tecnico_apoyo_1_id:accounts.otherTech.technicianId,tecnico_apoyo_2_id:accounts.thirdTech.technicianId},sessions.tech);
    for(const who of ['tech','otherTech','thirdTech']){
      const page=await call('operations/OrdenServicio?id='+shared.id,undefined,sessions[who]);assert.equal(page.status,200);assert.equal(page.data.total,1);
      const filtered=await call('operations/OrdenServicio?id='+shared.id+'&technician='+accounts[who].technicianId,undefined,sessions.coordinator);assert.equal(filtered.data.total,1);
    }
    const revision=(await readSnapshot(pool)).revision;
    const writes=await Promise.all(['otherTech','thirdTech'].map(who=>call('mutate',{revision,entity:'OrdenServicio',action:'update',id:shared.id,fields:{expected_updated_at:shared.fecha_actualizacion,diagnostico:'Apoyo '+who}},sessions[who])));
    assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);shared=writes.find(r=>r.status===200).data.result;
    assert.equal((await mutate('OrdenServicio','update',{tecnico_apoyo_2_id:''},sessions.otherTech,shared.id)).status,400);
    assert.equal((await call('operations/OrdenServicio?id='+shared.id,undefined,sessions.client)).data.total,0);
    const uploadId=randomUUID();assert.equal((await call('videos/start',{orderId:shared.id,category:'Antes',requestId:uploadId,name:'Apoyo.mp4',size:clip.length,sha256},sessions.otherTech)).status,200);
    const uploaded=await call('videos/'+uploadId+'/finish',{},sessions.otherTech);assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));
    for(const who of ['tech','otherTech','thirdTech'])assert.deepEqual((await call('attachments/'+uploaded.data.file.id+'/file',undefined,sessions[who])).data,clip);
    shared=await update('OrdenServicio',shared,{tecnico_apoyo_2_id:''},sessions.tech);
    assert.equal((await call('operations/OrdenServicio?id='+shared.id,undefined,sessions.thirdTech)).data.total,0);
    assert.equal((await call('attachments/'+uploaded.data.file.id+'/file',undefined,sessions.thirdTech)).status,404);
    shared=await update('OrdenServicio',shared,{tecnico_apoyo_2_id:accounts.thirdTech.technicianId},sessions.coordinator);
    shared=await update('OrdenServicio',shared,{estado:'Completada',trabajo_realizado:'Ajuste',pruebas_realizadas:'Elevación',resultado_pruebas:'Correcto'},sessions.thirdTech);assert.equal(shared.estado,'Completada');
    assert.equal((await readSnapshot(pool)).entities.OrdenServicio.filter(r=>r.id===shared.id).length,1);
  });
  await t.test('reapertura con motivo conserva video, autor, fecha, historial y rechaza versiones antiguas',async()=>{
    for(const actor of [admin,sessions.coordinator,sessions.tech]){
      let closed=await create('Ticket',{equipo_id:'eq-a',titulo:'Cierre sin orden',descripcion:'Reapertura sintética',responsable_id:tech,estado:'Programado',fecha_programada:date});
      // Reuse the same private blob, with a distinct evidence record belonging to this request.
      const rId=randomUUID();assert.equal((await call('videos/start',{ticketId:closed.id,requestId:rId,name:'Cadena.mp4',size:clip.length,sha256},admin)).status,200);
      const upload=await call(`videos/${rId}/finish`,{},admin);assert.equal(upload.status,201,JSON.stringify(upload.data));const evidence=upload.data.file;
      closed=await update('Ticket',closed,{estado:'Resuelto'});
      const before=await readSnapshot(pool),reason='Se cerró por error antes de registrar la orden.';
      for(const rejected of [sessions.client,sessions.otherTech,sessions.foreign])assert.equal((await mutate('Ticket','update',{estado:'En revisión',reapertura_motivo:reason},rejected,closed.id)).status,403);
      assert.equal((await mutate('Ticket','update',{estado:'En revisión',reapertura_motivo:''},actor,closed.id)).status,400);
      assert.equal((await mutate('Ticket','update',{estado:'En revisión',reapertura_motivo:reason,titulo:'Alterado'},actor,closed.id)).status,400);
      await update('Ticket',closed,{estado:'En revisión',reapertura_motivo:reason},actor);
      const reopened=(await readSnapshot(pool)).entities.Ticket.find(row=>row.id===closed.id);
      for(const key of ['id','codigo','fecha_creacion','creado_por','descripcion','equipo_id','cliente_id'])assert.equal(reopened[key],closed[key]);
      assert.equal((await mutate('Ticket','update',{estado:'Resuelto',expected_updated_at:closed.fecha_actualizacion},admin,closed.id)).status,409);
      const after=await readSnapshot(pool),audit=after.entities.Bitacora.find(row=>row.ticket_id===closed.id&&row.accion==='Reapertura sin orden');
      assert.equal(audit.motivo,reason);assert.equal(audit.estado_anterior,'Resuelto');assert.equal(audit.estado_nuevo,'En revisión');
      for(const previous of before.entities.Bitacora)assert.deepEqual(after.entities.Bitacora.find(row=>row.id===previous.id),previous);
      const created=await create('OrdenServicio',{...fields,ticket_id:closed.id,solicitud_id:randomUUID()},sessions.tech);
      assert.equal((await call('ticket-attachments?orderId='+created.id,undefined,sessions.tech)).data.files[0].id,evidence.id);
      assert.deepEqual((await call(`attachments/${evidence.id}/file?orderId=${created.id}`,undefined,sessions.tech)).data,clip);
    }
    const backup=await call('admin/full-backup',undefined,admin);assert.equal(backup.status,200);
    const entries=backup.data.toString().trimEnd().split('\n').map(JSON.parse);
    assert.equal(entries.filter(row=>row.type==='attachment').length,5);
    assert.ok(entries.filter(row=>row.type==='attachment').every(row=>row.file.metadata.sha256===sha256));
    const [blobs]=await pool.query('SELECT * FROM em_drive_blobs WHERE sha256=?',[sha256]);assert.equal(blobs.length,1);
  });
  await t.test('coordinador participante y revisión de cierre: cuatro perfiles, motivo, versiones y evidencias',async()=>{
    const coordId=accounts.coordinator.technicianId;assert.ok(coordId);
    const request=await create('Ticket',{equipo_id:'eq-a',titulo:'Prueba revisión',descripcion:'Trabajo compartido',responsable_id:tech});
    let order=await create('OrdenServicio',{equipo_id:'eq-a',ticket_id:request.id,sintoma:'Servicio en campo',estado:'En proceso',tecnico_apoyo_1_id:coordId},sessions.tech);
    order=await update('OrdenServicio',order,{estado:'Completada',diagnostico:'Original',trabajo_realizado:'Trabajo',pruebas_realizadas:'Prueba',resultado_pruebas:'Correcto',visible_cliente:true},sessions.coordinator);
    const reason='Se precisa el diagnóstico conservando cierre';
    for(const actor of [sessions.tech,sessions.client])for(const action of ['corregir','reabrir'])assert.equal((await mutate('OrdenServicio','update',{revision_accion:action,revision_motivo:reason},actor,order.id)).status,403);
    assert.equal((await mutate('OrdenServicio','update',{revision_accion:'corregir',revision_motivo:''},sessions.coordinator,order.id)).status,400);
    const original={...order};order=await update('OrdenServicio',order,{revision_accion:'corregir',revision_motivo:reason,diagnostico:'Precisado'},sessions.coordinator);
    assert.equal(order.fecha_fin,original.fecha_fin);assert.equal(order.estado,'Completada');
    const snapshot=await readSnapshot(pool),audit=snapshot.entities.Bitacora.find(row=>row.orden_id===order.id&&row.accion==='Corrección de orden completada');assert.deepEqual(JSON.parse(audit.version_anterior),original);assert.deepEqual(JSON.parse(audit.version_nueva),order);
    const body={orderId:order.id,category:'Después',requestId:randomUUID(),name:'Prueba.jpg',base64:Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1,0,0,0,0]).toString('base64')};
    assert.equal((await call('attachments',body,sessions.coordinator)).status,400);
    for(const actor of [sessions.tech,sessions.client])assert.equal((await call('attachments',{...body,reason},actor)).status,403);
    const image=await call('attachments',{...body,reason},sessions.coordinator);assert.equal(image.status,201,JSON.stringify(image.data));
    assert.equal((await call('attachments',{...body,reason},sessions.coordinator)).data.file.id,image.data.file.id);
    for(const actor of [admin,sessions.coordinator,sessions.tech,sessions.client])assert.equal((await call('attachments/'+image.data.file.id+'/file',undefined,actor)).status,200);
    const videoId=randomUUID();assert.equal((await call('videos/start',{orderId:order.id,category:'Después',requestId:videoId,name:'Final.mp4',size:clip.length,sha256,reason},sessions.coordinator)).status,200);
    assert.equal((await call('videos/'+videoId+'/finish',{},sessions.coordinator)).status,400);
    assert.equal((await call('videos/'+videoId+'/finish',{reason},sessions.coordinator)).status,201);
    const history=await call('orders/'+order.id+'/revisions',undefined,sessions.coordinator);assert.equal(history.status,200);assert.equal(history.data.events.filter(row=>row.action==='Evidencia posterior al cierre').length,2);
    assert.equal((await call('orders/'+order.id+'/revisions',undefined,sessions.tech)).status,403);
    assert.equal((await call('orders/'+order.id+'/revisions',undefined,sessions.client)).status,403);
    order=await update('OrdenServicio',order,{revision_accion:'reabrir',revision_motivo:'Falta prueba final en campo'},admin);assert.equal(order.estado,'En proceso');assert.equal(order.visible_cliente,false);
    assert.equal((await readSnapshot(pool)).entities.Ticket.find(row=>row.id===request.id).estado,'En revisión');
    assert.equal((await call('attachments/'+image.data.file.id+'/file',undefined,sessions.client)).status,404);
    order=await update('OrdenServicio',order,{estado:'Completada'},sessions.coordinator);assert.equal(order.estado,'Completada');
    assert.equal((await readSnapshot(pool)).entities.Ticket.find(row=>row.id===request.id).estado,'Resuelto');
  });

});
