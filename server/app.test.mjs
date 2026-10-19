import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { createApp } from './app.mjs';
import { createSeed, LocalDataSource, equipmentImageFields } from './generated/domain.mjs';
import { token } from './security.mjs';
import { imageReference, presentDatabase, resolveEquipmentImages } from './equipment-images.mjs';
import { logFailure, parseTrustProxy } from './diagnostics.mjs';
import { createSnapshotCache, snapshotByteSize } from './snapshot-cache.mjs';
import { cleanupExpired } from './database.mjs';
const origin = 'http://localhost:3000';
const csrf = token();
const coordinator = {id:'test-coord',name:'Prueba',role:'Coordinador',csrf,token_hash:'hash'};
const client = {id:'test-client',name:'Prueba',role:'Cliente',client_id:'client-1',csrf,token_hash:'hash'};
function poolFor(user, prepare = () => {}) {
  const db = createSeed();
  const media = new Map();
  prepare(db);
  const fake = {
    async query(sql) {
      if(sql.includes('SELECT revision')) return [[{revision:db.revision}]];
      if(sql.includes('SELECT last_sequence'))return [[{last_sequence:db.entities.Bitacora.reduce((n,row)=>Math.max(n,Number(/-(\d+)$/.exec(row.codigo)?.[1]||0)),0)}]];
      if(sql.includes('FROM em_audit_log'))return [db.entities.Bitacora.map(row=>({payload:JSON.stringify(row)}))];
      if(sql.includes('SELECT entity')) return [Object.entries(db.entities).filter(([entity])=>entity!=='Bitacora').flatMap(([entity,rows])=>rows.map(row=>({entity,payload:JSON.stringify(row)})))];
      if(sql.includes('COUNT(*)')) return [[{n:1}]];
      if(sql==='SELECT 1') return [[{1:1}]];
      throw new Error('Unexpected query');
    },
    async execute(sql, args) {
      if(sql.startsWith('INSERT INTO em_operation_index')||sql.startsWith('DELETE FROM em_operation_index'))return [{}];
      if(sql.startsWith('SELECT id,payload FROM em_audit_log'))return [db.entities.Bitacora.filter(row=>args.includes(row.id)).map(row=>({id:row.id,payload:JSON.stringify(row)}))];
      if(sql.startsWith('INSERT INTO em_audit_log')) {for(let i=0;i<args.length;i+=7)db.entities.Bitacora.push(JSON.parse(args[i+6]));return [{}];}
      if(sql.startsWith('UPDATE em_audit_state'))return [{}];
      if(sql.includes('FROM em_media WHERE equipment_id=?')) {
        const row = media.get(JSON.stringify(args.slice(0,3)));
        return [row ? [{...row, bytes: sql.includes('COALESCE') ? row.thumbnail || row.content : row.content, preview: sql.includes('COALESCE') && !!row.thumbnail}] : []];
      }
      if(sql.startsWith('INSERT INTO em_media ')) {
        const [equipment_id,field,hash,mime,size,sha256,uploaded_by,created_at,content,thumbnail] = args;
        media.set(JSON.stringify([equipment_id,field,hash]),{equipment_id,field,hash,mime,size,sha256,uploaded_by,created_at,content,thumbnail}); return [{}];
      }
      if(sql.startsWith("SELECT payload FROM em_records WHERE entity='OrdenServicio'")) return [db.entities.OrdenServicio.filter(row=>row.equipo_id===args[0]&&row.tecnico_id===args[1]).map(row=>({payload:JSON.stringify(row)}))];
      if(sql.startsWith("SELECT payload FROM em_records WHERE entity='Ticket'")) return [db.entities.Ticket.filter(row=>row.equipo_id===args[0]&&row.responsable_id===args[1]).map(row=>({payload:JSON.stringify(row)}))];
      if(sql.startsWith("SELECT payload FROM em_records WHERE entity='Tecnico'")) return [db.entities.Tecnico.filter(row=>row.id===args[0]).map(row=>({payload:JSON.stringify(row)}))];
      if(sql.includes('em_sessions s')) return [user?[user]:[]];
      if(sql.startsWith("SELECT payload FROM em_records WHERE entity='Equipo'")) {
        const row=db.entities.Equipo.find(item=>item.id===args[0]);
        return [row?[{payload:JSON.stringify(row)}]:[]];
      }
      if(sql.startsWith('INSERT INTO em_audit_index')) return [{}];
      if(sql.startsWith('DELETE FROM em_records WHERE entity=? AND id IN')) { db.entities[args[0]]=db.entities[args[0]].filter(row=>!args.slice(1).includes(row.id));return [{}]; }
      if(sql.startsWith('INSERT INTO em_records')) {
        for(let i=0;i<args.length;i+=3) {
          const [entity,id,payload]=args.slice(i,i+3); const row=JSON.parse(payload); const index=db.entities[entity].findIndex(item=>item.id===id);
          if(index < 0) db.entities[entity].push(row); else db.entities[entity][index]=row;
        }
        return [{}];
      }
      if(sql==='UPDATE em_meta SET revision=? WHERE id=1 AND revision=?'){if(db.revision!==args[1])return [{affectedRows:0}];db.revision=args[0];return [{affectedRows:1}];}
      if(sql.startsWith('UPDATE em_meta SET revision=')) { db.revision=args[0]; return [{}]; }
      throw new Error('Unexpected write');
    },
    async getConnection() { return {...fake,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{}}; },
  };
  return fake;
}
async function fixture(t,user,prepare,options={}) {
  const app=createApp({pool:poolFor(user,prepare),origin,setupToken:token(),production:true,...options});
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  return (path,options={})=>fetch(url+path,options);
}
const jsonHeaders = {'Content-Type':'application/json',Origin:origin,Cookie:'em_session=example','X-CSRF-Token':csrf};
test('data requires an authenticated session even if an administrator is supplied',async t=>{
  const request=await fixture(t,null);
  assert.equal((await request('/api/database?actor=user-admin')).status,401);
  assert.equal((await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({actor:{rol:'Administrador'},action:'create'})})).status,401);
});
test('server rejects role forgery and cross-origin writes',async t=>{
  const request=await fixture(t,coordinator);
  assert.equal((await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({actor:{rol:'Administrador'},action:'create',revision:0})})).status,403);
  assert.equal((await request('/api/login',{method:'POST',headers:{...jsonHeaders,Origin:'https://otro.example'},body:'{}'})).status,403);
});
test('an authenticated write still requires the session CSRF token',async t=>{
  const request=await fixture(t,{...coordinator,role:'Administrador'});
  assert.equal((await request('/api/mutate',{method:'POST',headers:{...jsonHeaders,'X-CSRF-Token':'incorrect'},body:'{}'})).status,403);
});
test('client responses exclude other companies, internal costs, and audit data',async t=>{
  const request=await fixture(t,client); const response=await request('/api/database',{headers:{Cookie:'em_session=example'}}); const db=await response.json();
  assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(db.entities.Cliente.map(row=>row.id),['client-1']);
  assert.ok(db.entities.Equipo.every(row=>row.cliente_id==='client-1'));
  assert.equal(db.entities.Bitacora.length,0); assert.equal(JSON.stringify(db).includes('costo_'),false);
});
test('coordinator responses omit cost fields and audit data',async t=>{
  const request=await fixture(t,coordinator); const response=await request('/api/database',{headers:{Cookie:'em_session=example'}}); const db=await response.json();
  assert.equal(response.status,200); assert.equal(db.entities.Bitacora.length,0); assert.equal(JSON.stringify(db).includes('costo_'),false);
});
test('shared engine does not inject demo records into an empty online workspace',()=>{
  const db=createSeed(); for(const name of Object.keys(db.entities)) if(name!=='Catalogos') db.entities[name]=[];
  let saved=JSON.stringify(db); const source=new LocalDataSource({getItem:()=>saved,setItem:(_key,value)=>saved=value},{demoHistory:false});
  const snapshot=source.snapshot({id:'admin',nombre:'Prueba',rol:'Administrador'});
  assert.equal(snapshot.entities.Cliente.length,0);assert.equal(snapshot.entities.Equipo.length,0);assert.equal(snapshot.entities.OrdenServicio.length,0);
});

const picture='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp9sAAAAASUVORK5CYII=';
const imageHash=imageReference(picture).slice(6);
const withImages=db=>{for(const field of equipmentImageFields) db.entities.Equipo[0][field]=picture;db.entities.Equipo[0].cliente_id='client-1';};

test('agenda de técnico: ticket asignado, equipo y foto autorizados; cambios y recursos ajenos rechazados',async t=>{
  const prepare=db=>{
    withImages(db);for(const name of ['OrdenServicio','LecturaHorometro','OTRepuesto','OTHoras'])db.entities[name]=[];
    const template={...db.entities.Equipo[0],titulo:'Agenda QA',descripcion:'Solicitud de prueba',equipo_id:'equipment-1',cliente_id:'client-1',schema_operacion:1,estado:'Programado',fecha_programada:'2026-10-13',prioridad:'Alta'};
    db.entities.Ticket=[{...template,id:'ticket-own',codigo:'TKT-1',responsable_id:'tech-1'},{...template,id:'ticket-other',codigo:'TKT-2',responsable_id:'tech-2'}];
  };
  const user={...coordinator,role:'Técnico',technician_id:'tech-1'};
  const request=await fixture(t,user,prepare);
  const response=await request('/api/database',{headers:{Cookie:'em_session=x'}});assert.equal(response.status,200);
  const db=await response.json();assert.deepEqual(db.entities.Ticket.map(row=>row.id),['ticket-own']);assert.equal(db.entities.Equipo.length,25);
  assert.equal((await request(`/api/equipment-images/equipment-1/foto_equipo/${imageHash}`,{headers:{Cookie:'em_session=x'}})).status,200);
  assert.equal((await request(`/api/equipment-images/equipment-2/foto_equipo/${imageHash}`,{headers:{Cookie:'em_session=x'}})).status,404);
  assert.equal((await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'update',entity:'Ticket',id:'ticket-own',revision:db.revision,fields:{estado:'Resuelto',expected_updated_at:db.entities.Ticket[0].fecha_actualizacion}})})).status,403);
});

test('findings persist with trusted audit, reject stale or invalid updates and preserve equipment/history/images',async t=>{
  const request=await fixture(t,{...coordinator,role:'Administrador'},withImages);
  const before=await (await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  const fields={equipo_id:'equipment-1',descripcion:'Rueda por revisar',componente:'Llantas y rodos',prioridad:'Por definir',estado:'Por confirmar',actualizado_nombre:'Forged',cerrado_el:'2000-01-01'};
  const create=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'create',entity:'Hallazgo',revision:before.revision,fields})});
  assert.equal(create.status,200);const saved=await create.json();
  assert.equal(saved.result.actualizado_nombre,'Prueba');assert.equal(saved.result.cerrado_el,'');
  const invalid=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'update',entity:'Hallazgo',id:saved.result.id,revision:saved.database.revision,fields:{estado:'Resuelto',prioridad:'Alta',orden_resolucion_id:'service-2-0',detalle_resolucion:'Reparado',nota_cambio:'Cierre'}})});
  assert.equal(invalid.status,400);
  const stale=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'update',entity:'Hallazgo',id:saved.result.id,revision:before.revision,fields:{descripcion:'Cambio atrasado'}})});
  assert.equal(stale.status,409);
  const after=await (await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  for(const entity of ['Equipo','LecturaHorometro','OrdenServicio']) assert.deepEqual(after.entities[entity],before.entities[entity]);
  assert.equal(after.entities.Hallazgo.length,1);assert.equal(after.entities.Bitacora.find(row=>row.hallazgo_id===saved.result.id).registrado_por,'Prueba');
});

test('findings are absent for non-admin roles and cannot be changed by role forgery',async t=>{
  for(const user of [coordinator,client,{...coordinator,role:'Técnico'}]){
    const request=await fixture(t,user,db=>{db.entities.Hallazgo.push({...db.entities.Equipo[0],id:'finding-test',codigo:'HAL-001',equipo_id:'equipment-1',descripcion:'Nota interna',componente:'Otro',prioridad:'Baja',estado:'Abierto'});});
    const response=await request('/api/database',{headers:{Cookie:'em_session=x'}});
    assert.equal(response.status,200);assert.deepEqual((await response.json()).entities.Hallazgo,[]);
    const change=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({actor:{rol:'Administrador'},action:'update',entity:'Hallazgo',revision:0,id:'finding-test',fields:{estado:'Resuelto'}})});
    assert.equal(change.status,403);
  }
});

test('operational status persists independently through the HTTP API with trusted authorship and concurrency checks',async t=>{
  const request=await fixture(t,{...coordinator,role:'Administrador'},withImages);
  const original=await (await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  const equipment=original.entities.Equipo[0];
  const response=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'update',entity:'Equipo',id:equipment.id,revision:original.revision,fields:{estado_operativo:'Operativo',estado_mantenimiento:'Mantenimiento pendiente',motivo_estado:'Preventivo por programar',estado_actualizado_por:'Impostor',estado_actualizado_el:'2000-01-01T00:00:00.000Z'}})});
  assert.equal(response.status,200);const saved=await response.json();
  assert.equal(saved.result.estado_operativo,'Operativo');assert.equal(saved.result.estado_mantenimiento,'Mantenimiento pendiente');assert.equal(saved.result.estado,equipment.estado);
  assert.equal(saved.result.estado_actualizado_por,'Prueba');assert.notEqual(saved.result.estado_actualizado_el,'2000-01-01T00:00:00.000Z');
  const after=await (await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  assert.deepEqual(after.entities.LecturaHorometro,original.entities.LecturaHorometro);
  for(const field of equipmentImageFields) assert.equal(after.entities.Equipo[0][field],picture);
  assert.equal(after.entities.Bitacora.find(row=>row.accion==='Cambio de estado').equipo_id,equipment.id);
  const conflict=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'update',entity:'Equipo',id:equipment.id,revision:original.revision,fields:{estado_operativo:'No operativo'}})});
  assert.equal(conflict.status,409);
  const invalid=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'update',entity:'Equipo',id:equipment.id,revision:saved.database.revision,fields:{estado_operativo:'Valor desconocido'}})});
  assert.equal(invalid.status,400);
});

test('historical report import is administrator-only, revision-checked and additive',async t=>{
  const request=await fixture(t,{...coordinator,role:'Administrador'},db=>{db.entities.Sede.push({id:'site-hist',codigo:'SED-901',creado_por:'test-admin',fecha_creacion:'2026-01-01T12:00:00Z',actualizado_por:'test-admin',fecha_actualizacion:'2026-01-01T12:00:00Z',cliente_id:db.entities.Cliente[0].id,nombre:'Planta de prueba'});});
  const before=await (await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  const clientId=before.entities.Cliente[0].id;
  const payload={cliente_id:clientId,sede_id:'site-hist',equipos:[{serie:'HIST-SERIAL-1',id_interno_cliente:'FC#1',marca:'Yale',modelo:'FC4500'}],reportes:[{origen_id:'source-1',orden_origen:'21',serie:'HIST-SERIAL-1',fecha:'2025-02-08T20:00:00.000Z',fecha_fin:'',estado:'Completado',prioridad:'Programada',tipo:'Correctivo',diagnostico:'Hidráulica',trabajo:'Cambio de manguera',notas_seguridad:'',tecnicos:'Técnico',recibido_por:'Contacto',inspector:'inspector@example.com',horometro:100,odometro_millas:125,ubicacion:'Ubicación enviada por el navegador',insumos_origen:'',repuestos_origen:'',adjuntos_referencias:'Foto Antes: antes.jpg',firma_cliente_referencia:'',checklist_origen:'',bocina_origen:'',mes_origen:'febrero',semana_origen:'Semana 6',dia_origen:'sábado',ubicacion_coordenadas:'14.6, -90.4'}]};
  const response=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'importHistoricalReports',payload,revision:before.revision})});
  assert.equal(response.status,200);const saved=await response.json();assert.deepEqual(saved.result,{equipos:1,reportes:1,lecturas:1,repetidos:0});
  const after=await (await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  assert.equal(after.entities.Equipo.length,before.entities.Equipo.length+1);assert.equal(after.entities.OrdenServicio.length,before.entities.OrdenServicio.length+1);assert.equal(after.entities.LecturaHorometro.length,before.entities.LecturaHorometro.length+1);
  assert.equal(after.entities.OrdenServicio.at(-1).importado,true);assert.equal(after.entities.OrdenServicio.at(-1).origen_id,'source-1');assert.equal(after.entities.LecturaHorometro.at(-1).valor,100);
  assert.equal(after.entities.OrdenServicio.at(-1).ubicacion,'Planta de prueba');assert.equal(after.entities.LecturaHorometro.at(-1).ubicacion,'Planta de prueba');
  assert.equal(after.entities.Equipo.at(-1).marca,'Yale');assert.equal(after.entities.Equipo.at(-1).tipo,'Clasificación pendiente');assert.equal(after.entities.Equipo.at(-1).sede_id,'site-hist');
  const repeated=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'importHistoricalReports',payload:{...payload,equipos:[]},revision:after.revision})});
  assert.equal(repeated.status,200);assert.deepEqual((await repeated.json()).result,{equipos:0,reportes:0,lecturas:0,repetidos:1});
});
test('historical report import rejects stale revision and non-admin users',async t=>{
  const request=await fixture(t,{...coordinator,role:'Administrador'});const before=await (await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  const stale=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'importHistoricalReports',payload:{cliente_id:before.entities.Cliente[0].id,equipos:[],reportes:[]},revision:before.revision+1})});assert.equal(stale.status,409);
  const clientRequest=await fixture(t,client);const denied=await clientRequest('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'importHistoricalReports',payload:{cliente_id:'client-1',equipos:[],reportes:[]},revision:0})});assert.equal(denied.status,403);
});

test('client HTTP view includes only its operational status and maintenance alert and rejects status edits',async t=>{
  const request=await fixture(t,client,db=>{withImages(db);Object.assign(db.entities.Equipo[0],{estado_operativo:'En reparación',estado_mantenimiento:'Mantenimiento pendiente',estado_administrativo:'En renta',estado_actualizado_por:'Administrador interno'});});
  const db=await (await request('/api/database',{headers:{Cookie:'em_session=x'}})).json();
  assert.ok(db.entities.Equipo.every(row=>row.cliente_id==='client-1'));
  const row=db.entities.Equipo.find(row=>row.id==='equipment-1');
  assert.equal(row.estado_operativo,'En reparación');assert.equal(row.estado_mantenimiento,'Mantenimiento pendiente');
  for(const key of ['estado','estado_administrativo','estado_actualizado_por']) assert.equal(key in row,false);
  const denied=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'update',entity:'Equipo',id:row.id,revision:db.revision,fields:{estado_operativo:'Operativo'}})});
  assert.equal(denied.status,403);
});
test('equipment images require authentication and equipment visibility, including knowledge of the hash',async t=>{
  const path=`/api/equipment-images/equipment-1/foto_equipo/${imageHash}`;
  const anon=await fixture(t,null,withImages); assert.equal((await anon(path)).status,401);
  const other=await fixture(t,{...client,client_id:'client-2'},withImages); assert.equal((await other(path,{headers:{Cookie:'em_session=x'}})).status,404);
  const technician=await fixture(t,{...client,role:'Técnico'},withImages); assert.equal((await technician(path,{headers:{Cookie:'em_session=x'}})).status,404);
  const allowed=await fixture(t,client,withImages);const response=await allowed(path,{headers:{Cookie:'em_session=x'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('cache-control'),'private, no-cache');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(picture.split(',')[1],'base64'));
  assert.equal((await allowed(`/api/equipment-images/equipment-1/foto_equipo/${'0'.repeat(64)}`,{headers:{Cookie:'em_session=x'}})).status,404);
  for(const field of equipmentImageFields) {
    const url=`/api/equipment-images/equipment-1/${field}/${imageHash}`;
    assert.equal((await other(url,{headers:{Cookie:'em_session=x'}})).status,404);
    assert.equal((await allowed(url,{headers:{Cookie:'em_session=x'}})).status,200);
  }
});
test('normal responses exclude image bytes and only administration exports complete image backups',async t=>{
  const limited=await fixture(t,client,withImages);
  const db=await (await limited('/api/database',{headers:{Cookie:'em_session=x'}})).json();
  assert.equal(JSON.stringify(db).includes('base64'),false);assert.equal(db.entities.Equipo[0].foto_equipo,imageReference(picture));
  assert.equal((await limited('/api/backup',{headers:{Cookie:'em_session=x'}})).status,403);
  assert.equal((await limited('/api/equipment-export',{method:'POST',headers:jsonHeaders,body:JSON.stringify({ids:['equipment-1']})})).status,403);
  const admin=await fixture(t,{...coordinator,role:'Administrador'},withImages);
  const backup=await (await admin('/api/backup',{headers:{Cookie:'em_session=x'}})).json();assert.equal(backup.entities.Equipo[0].foto_equipo,picture);
  const exported=await (await admin('/api/equipment-export',{method:'POST',headers:jsonHeaders,body:JSON.stringify({ids:['equipment-1']})})).json();
  assert.equal(exported.rows.length,1);assert.equal(exported.rows[0].foto_equipo,undefined);
  for(const field of equipmentImageFields) {assert.equal(db.entities.Equipo[0][field],imageReference(picture));assert.equal(backup.entities.Equipo[0][field],picture);assert.equal(exported.rows[0][field],undefined);}
});

test('image reads touch only the requested equipment and honor reassignment without a snapshot',async t=>{
  let equipment;let selected=0;
  const pool=poolFor(client,db=>{withImages(db);equipment=db.entities.Equipo[0];});
  pool.query=async()=>{throw new Error('Images must not read the entire database');};
  pool.getConnection=async()=>{throw new Error('Images must not open a snapshot');};
  const execute=pool.execute;
  pool.execute=async(sql,args)=>{if(sql.startsWith('SELECT payload')) {selected++;assert.deepEqual(args,['equipment-1']);}return execute(sql,args);};
  const request=await fixture(t,client,undefined,{pool});const headers={Cookie:'em_session=x'};
  const path=`/api/equipment-images/equipment-1/placa_datos/${imageHash}`;
  assert.equal((await request(path,{headers})).status,200);
  equipment.cliente_id='client-2';
  assert.equal((await request(path,{headers})).status,404);
  equipment.cliente_id='client-1';equipment.placa_datos='';
  assert.equal((await request(path,{headers})).status,404);
  assert.equal(selected,3);
});

test('editing works without serializing the complete image-bearing database and preserves originals',async t=>{
  const request=await fixture(t,{...coordinator,role:'Administrador'},withImages);
  const stringify=JSON.stringify;
  const mock=t.mock.method(JSON,'stringify',function(value,...args) {
    if(value?.entities?.Equipo?.some(row=>equipmentImageFields.some(field=>String(row[field]).startsWith('data:')))) throw new RangeError('Full photo snapshot cannot be serialized');
    return stringify(value,...args);
  });
  const before=await (await request('/api/database',{headers:{Cookie:'em_session=x'}})).json();
  const saved=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:stringify({action:'update',entity:'Equipo',id:'equipment-1',revision:before.revision,fields:{notas:'Revisión sintética',foto_equipo:before.entities.Equipo[0].foto_equipo}})});
  assert.equal(saved.status,200);const after=await saved.json();
  mock.mock.restore();
  assert.equal(after.database.revision,before.revision+1);
  const backup=await (await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  for(const field of equipmentImageFields) assert.equal(backup.entities.Equipo[0][field],picture);
  assert.equal(backup.entities.Equipo[0].notas,'Revisión sintética');
  assert.equal(JSON.stringify(backup.entities.Bitacora).includes('base64'),false);
});
test('image references resolve only to the same original equipment and field',()=>{
  const previous=createSeed();withImages(previous);
  const next=presentDatabase(previous);resolveEquipmentImages(next,previous);assert.equal(next.entities.Equipo[0].foto_equipo,picture);
  const crossed=presentDatabase(previous);crossed.entities.Equipo[1].foto_equipo=imageReference(picture);
  assert.throws(()=>resolveEquipmentImages(crossed,previous),/imagen/);
});

test('an administrator saves all six photos together above the former 8 MB limit',async t=>{
  const request=await fixture(t,{...coordinator,role:'Administrador'});
  const db=await (await request('/api/database',{headers:{Cookie:'em_session=x'}})).json();
  const original = await sharp({create:{width:700,height:600,channels:3,background:'#315d29'}}).png({compressionLevel:0}).toBuffer();
  const fields=Object.fromEntries(equipmentImageFields.map(field=>[field,'data:image/png;base64,'+original.toString('base64')]));
  const body=JSON.stringify({action:'update',entity:'Equipo',id:'equipment-1',revision:db.revision,fields});
  assert.ok(Buffer.byteLength(body)>8*1024*1024);
  const response=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body});
  const saved=await response.json();assert.equal(response.status,200,JSON.stringify(saved));
  assert.equal(JSON.stringify(saved).includes('base64'),false);
  const backup=await (await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  const row=backup.entities.Equipo.find(item=>item.id==='equipment-1');
  for(const field of equipmentImageFields) assert.equal(row[field],fields[field]);
  assert.equal(row.horometro,db.entities.Equipo[0].horometro);
  assert.equal(JSON.stringify(backup.entities.Bitacora).includes('base64'),false);
});

test('unchanged polls only read the revision and concurrent clients share a filtered snapshot',async t=>{
  const user={...coordinator,role:'Administrador'};const pool=poolFor(user);let fullReads=0;
  const original=pool.getConnection;
  pool.getConnection=async()=>{const conn=await original();const query=conn.query;conn.query=async sql=>{if(sql.includes('SELECT entity')) fullReads++;return query(sql);};return conn;};
  const request=await fixture(t,user,undefined,{pool});const headers={Cookie:'em_session=x'};
  const [a,b]=await Promise.all([request('/api/database',{headers}),request('/api/database',{headers})]);
  const db=await a.json();assert.equal(b.status,200);assert.equal(fullReads,1);
  const unchanged=await request(`/api/database?since=${db.syncToken}`,{headers});
  assert.equal(unchanged.status,204);assert.equal(await unchanged.text(),'');assert.equal(fullReads,1);
  assert.equal(unchanged.headers.get('cache-control'),'no-store');
  Object.assign(user,{role:'Cliente',client_id:'client-1'});
  const changed=await request(`/api/database?since=${db.syncToken}`,{headers});const limited=await changed.json();
  assert.equal(changed.status,200);assert.notEqual(limited.syncToken,db.syncToken);assert.equal(limited.access.rol,'Cliente');
  assert.equal(limited.entities.Bitacora.length,0);assert.ok(limited.entities.Equipo.every(row=>row.cliente_id==='client-1'));assert.equal(fullReads,1);
  user.client_id='client-2';
  const moved=await (await request(`/api/database?since=${limited.syncToken}`,{headers})).json();
  assert.deepEqual(moved.entities.Cliente.map(row=>row.id),['client-2']);assert.notEqual(moved.syncToken,limited.syncToken);
  user.role='Administrador';
  const again=await (await request('/api/database',{headers})).json();assert.equal(again.entities.Cliente.length,db.entities.Cliente.length);
});
test('a committed edit invalidates the previous sync token and stale edits still fail',async t=>{
  const request=await fixture(t,{...coordinator,role:'Administrador'});const headers={Cookie:'em_session=x'};
  const db=await (await request('/api/database',{headers})).json();
  const response=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'create',entity:'Catalogos',fields:{categoria:'Marcas',nombre:'Sincronización',activo:true},revision:db.revision})});
  assert.equal(response.status,200);const saved=await response.json();
  const fresh=await (await request(`/api/database?since=${db.syncToken}`,{headers})).json();
  assert.equal(fresh.revision,db.revision+1);assert.equal(fresh.syncToken,saved.database.syncToken);
  assert.equal((await request(`/api/database?since=${fresh.syncToken}`,{headers})).status,204);
  assert.equal((await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'create',entity:'Catalogos',fields:{},revision:db.revision})})).status,409);
});
test('a sync token never bypasses authentication',async t=>{
  const request=await fixture(t,null);assert.equal((await request('/api/database?since=anything')).status,401);
});
test('snapshot cache coalesces reads, protects newer commits, retries failures and bounds retained size',async()=>{
  let finish;let calls=0;const old={revision:1,entities:{}};const newer={revision:2,entities:{}};
  const cache=createSnapshotCache(null,{load:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  const a=cache.read(1);const b=cache.read(1);assert.equal(calls,1);cache.publish(newer);finish(old);
  assert.equal(await a,newer);assert.equal(await b,newer);assert.equal(await cache.read(2),newer);
  let tries=0;const failed=createSnapshotCache(null,{load:async()=>{if(++tries===1) throw new Error('failure');return old;}});
  await assert.rejects(failed.read(1));assert.equal(await failed.read(1),old);assert.equal(tries,2);
  let uncached=0;const bounded=createSnapshotCache(null,{maxBytes:1,load:async()=>{uncached++;return old;}});
  await bounded.read(1);await bounded.read(1);assert.equal(uncached,2);
});
test('a pending snapshot older than an observed external revision is reread',async()=>{
  let finish;let calls=0;
  const cache=createSnapshotCache(null,{load:()=>++calls===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve({revision:2})});
  const a=cache.read(1);const b=cache.read(2);finish({revision:1});await a;
  assert.equal((await b).revision,2);assert.equal(calls,2);
});

test('cache publication waits for commit acknowledgement and discards failed transactions',async()=>{
  const old={revision:1,entities:{}},next={revision:2,entities:{}};
  const cache=createSnapshotCache(null);cache.publish(old);
  let finish;
  const committed=cache.publishAfterCommit(next,()=>new Promise(resolve=>{finish=resolve;}));
  let resolved=false;const waiting=cache.peek(2).then(value=>{resolved=true;return value;});
  await Promise.resolve();assert.equal(resolved,false);assert.equal(await cache.peek(1),old);
  finish();await committed;assert.equal(await waiting,next);
  let reject;
  const failure=cache.publishAfterCommit({revision:3,entities:{}},()=>new Promise((_resolve,failed)=>{reject=failed;}));
  const rejected=assert.rejects(failure,/commit failed/),uncommitted=cache.peek(3);
  reject(new Error('commit failed'));await rejected;
  assert.equal(await uncommitted,undefined);assert.equal(await cache.peek(2),next);
});

test('cache sizing includes Unicode and JSON framing, stops early and never propagates a cache failure',async()=>{
  const db={schemaVersion:1,revision:2,entities:{Equipo:[{id:'equipo',nombre:'Grúa 🏗️',notas:'"\\\n'}],Bitacora:[]}};
  const size=Buffer.byteLength(JSON.stringify(db));
  assert.equal(snapshotByteSize(db),size);
  const large={revision:3,entities:{Equipo:[{foto:'x'.repeat(1000)},{get unexpected(){throw new Error('Do not measure rows after exceeding the cap');}}]}};
  assert.ok(snapshotByteSize(large,100)>100);
  let calls=0;let fail=false;
  const cache=createSnapshotCache(null,{maxBytes:size,load:async()=>{calls++;return db;},sizeOf:(value,limit)=>{if(fail) throw new RangeError('Cannot measure');return snapshotByteSize(value,limit);}});
  cache.publish(db);assert.equal(await cache.read(2),db);assert.equal(calls,0);
  fail=true;assert.doesNotThrow(()=>cache.publish(db));
  assert.equal(await cache.read(2),db);assert.equal(await cache.read(2),db);assert.equal(calls,2);
});

test('cleanup drains expired backlogs in bounded batches and stops at the configured cap',async()=>{
  const left={em_sessions:1205,em_login_limits:10500};const calls=[];
  const pool={execute:async(sql,args)=>{const table=sql.match(/DELETE FROM (\w+)/)[1];assert.match(sql,/expires_at<=\? LIMIT 500$/);assert.deepEqual(args,[1234]);calls.push(table);const affectedRows=Math.min(500,left[table]);left[table]-=affectedRows;return [{affectedRows}];}};
  assert.deepEqual(await cleanupExpired(pool,1234),{em_sessions:1205,em_login_limits:10000});
  assert.equal(calls.filter(name=>name==='em_sessions').length,3);
  assert.equal(calls.filter(name=>name==='em_login_limits').length,20);
  assert.deepEqual(await cleanupExpired(pool,1234,{maxPasses:1}),{em_sessions:0,em_login_limits:500});
  await assert.rejects(cleanupExpired(pool,1234,{maxPasses:Infinity}),RangeError);
});
test('database errors have a reference and logs omit SQL, messages, credentials and URL values',async t=>{
  const logs=[];const pool=poolFor(coordinator);const query=pool.query;
  pool.query=async sql=>{if(sql.includes('SELECT revision')) throw Object.assign(new Error('secret-client@email.test password=secret-value'),{code:'ER_ACCESS_DENIED_ERROR',errno:1045,sql:'SELECT secret-value'});return query(sql);};
  const request=await fixture(t,coordinator,undefined,{pool,logger:line=>logs.push(line)});
  const response=await request('/api/database?secret=secret-value',{headers:{Cookie:'em_session=secret-cookie'}});const body=await response.json();
  assert.equal(response.status,500);assert.ok(body.error.includes(body.reference));assert.equal(logs.length,1);
  const log=JSON.parse(logs[0]);assert.equal(log.reference,body.reference);assert.equal(log.error.code,'ER_ACCESS_DENIED_ERROR');assert.equal(log.route,'/api/database');
  assert.equal(JSON.stringify([logs,body]).includes('secret-'),false);assert.equal(JSON.stringify(log).includes('password'),false);
});
test('unexpected domain errors produce 500 while expected validation remains 400',async t=>{
  const logs=[];const request=await fixture(t,{...coordinator,role:'Administrador'},undefined,{logger:line=>logs.push(line)});
  const db=await (await request('/api/database',{headers:{Cookie:'em_session=x'}})).json();
  t.mock.method(LocalDataSource.prototype,'importClients',()=>{throw new TypeError('private error details');});
  const failure=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'importClients',rows:[],revision:db.revision})});
  assert.equal(failure.status,500);assert.equal((await failure.text()).includes('private'),false);assert.equal(logs.length,1);
  const invalid=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'create',entity:'Catalogos',fields:{},revision:db.revision})});
  assert.equal(invalid.status,400);assert.equal(logs.length,1);
});
test('health failures stay 503 and safe diagnostics also cover startup errors',async t=>{
  const logs=[];const request=await fixture(t,null,undefined,{pool:{query:async()=>{throw Object.assign(new Error('sensitive connection string'),{code:'ECONNREFUSED'});}},logger:line=>logs.push(line)});
  const response=await request('/api/health');assert.equal(response.status,503);assert.ok((await response.json()).reference);
  logFailure(Object.assign(new Error('sensitive startup'),{code:'CONFIG_DB_HOST'}),{event:'startup'},line=>logs.push(line));
  assert.equal(logs.length,2);assert.equal(logs.join('').includes('sensitive'),false);assert.equal(JSON.parse(logs[1]).error.code,'CONFIG_DB_HOST');
});
test('proxy configuration rejects blanket trust and accepts explicit verified ranges',()=>{
  assert.equal(parseTrustProxy(),1);assert.equal(parseTrustProxy('0'),0);assert.deepEqual(parseTrustProxy('loopback, 10.1.2.0/24'),['loopback','10.1.2.0/24']);
  for(const value of ['true','false','','6','-1','0.0.0.0/0','::/0','10.0.0.1/33','loopback,','invalid']) assert.throws(()=>parseTrustProxy(value));
});
test('network diagnostics are off by default, administrator-only and show the configured trusted hop',async t=>{
  const admin={...coordinator,role:'Administrador'};
  const disabled=await fixture(t,admin);assert.equal((await disabled('/api/diagnostico/red',{headers:{Cookie:'em_session=x'}})).status,404);
  const unauthenticated=await fixture(t,null,undefined,{networkDiagnostics:true});assert.equal((await unauthenticated('/api/diagnostico/red')).status,401);
  const clientRequest=await fixture(t,client,undefined,{networkDiagnostics:true});assert.equal((await clientRequest('/api/diagnostico/red',{headers:{Cookie:'em_session=x'}})).status,403);
  const enabled=await fixture(t,admin,undefined,{networkDiagnostics:true,trustProxy:'1'});
  const response=await enabled('/api/diagnostico/red',{headers:{Cookie:'em_session=x','X-Forwarded-For':'198.51.100.20, 203.0.113.10'}});
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.ip,'203.0.113.10');assert.equal(body.trustProxy,1);
  assert.equal(response.headers.get('cache-control'),'no-store');
});


test('public endpoints reject oversized JSON and protected routes authenticate before parsing it', async t=>{
  const request=await fixture(t,null);
  const body=JSON.stringify({padding:'x'.repeat(110*1024)});
  for(const path of ['/api/login','/api/setup']) {
    const response=await request(path,{method:'POST',headers:jsonHeaders,body});
    assert.equal(response.status,413); assert.match((await response.json()).error,/tamaño/);
  }
  for(const path of ['/api/logout','/api/password','/api/sessions/revoke','/api/mutate']) {
    assert.equal((await request(path,{method:'POST',headers:jsonHeaders,body})).status,401);
  }
});
test('account operations require CSRF even for a valid session',async t=>{
  const request=await fixture(t,coordinator);
  for(const path of ['/api/password','/api/sessions/revoke']) {
    assert.equal((await request(path,{method:'POST',headers:{...jsonHeaders,'X-CSRF-Token':'invalid'},body:'{}'})).status,403);
  }
});


test('maintenance plans keep immutable versions, reject stale changes and preserve operational data', async t => {
  const request=await fixture(t,{id:'test-admin',name:'Admin',role:'Administrador',csrf,token_hash:'hash'});
  const snapshot=async()=>await (await request('/api/backup',{headers:jsonHeaders})).json();
  const before=await snapshot();
  const fields={schema_plan:1,equipo_id:'equipment-1',tipo_plan:'Preventivo',criterio:'Días',intervalo:30,estado_plan:'Activo',base_origen:'Pendiente',base_fecha:'',base_horas:null,base_confirmada:false,motivo:'Configuración sintética',confirmado_por:'Falso',version:50};
  const mutate=body=>request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify(body)});
  const first=await mutate({action:'create',entity:'PlanPM',revision:before.revision,fields});assert.equal(first.status,200);const saved=await first.json();
  assert.equal(saved.result.version,1);assert.equal(saved.result.confirmado_por,'Admin');
  assert.equal((await mutate({action:'create',entity:'PlanPM',revision:before.revision,fields})).status,409);
  assert.equal((await mutate({action:'update',entity:'PlanPM',id:saved.result.id,revision:saved.database.revision,fields:{intervalo:60}})).status,400);
  assert.equal((await mutate({action:'create',entity:'PlanPM',revision:saved.database.revision,fields:{...fields,intervalo:60}})).status,200);
  const after=await snapshot();assert.equal(after.entities.PlanPM.length,2);assert.equal(after.entities.PlanPM.filter(row=>row.vigente).length,1);
  assert.deepEqual(after.entities.Equipo,before.entities.Equipo);assert.deepEqual(after.entities.LecturaHorometro,before.entities.LecturaHorometro);assert.deepEqual(after.entities.OrdenServicio,before.entities.OrdenServicio);
  assert.equal(after.entities.Bitacora.filter(row=>row.plan_id).length,2);
});
test('maintenance plan data and writes are restricted to administration',async t=>{
  for(const user of [coordinator,client,{...coordinator,role:'Técnico'}]) {
    const request=await fixture(t,user,db=>{db.entities.PlanPM.push({id:'internal-plan',codigo:'PM-TEST',equipo_id:'equipment-1',creado_por:'test-admin',actualizado_por:'test-admin',fecha_creacion:'2026-01-01T12:00:00Z',fecha_actualizacion:'2026-01-01T12:00:00Z',schema_plan:1,tipo_plan:'Preventivo',criterio:'Horas',intervalo:250,estado_plan:'Activo',base_origen:'Pendiente',base_confirmada:false,motivo:'Solo administración',version:1,vigente:true,confirmado_por:'Admin',confirmado_el:'2026-01-01T12:00:00Z',vigente_desde:'2026-01-01'});});
    const response=await request('/api/database',{headers:jsonHeaders});assert.equal(response.status,200);
    const db=await response.json();assert.deepEqual(db.entities.PlanPM,[]);
    assert.equal((await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'create',entity:'PlanPM',revision:0,fields:{},actor:{rol:'Administrador'}})})).status,403);
  }
});

test('client ticket creation is scoped, idempotent across stale retries and does not allow scheduling',async t=>{
  const request=await fixture(t,client);
  const fields={equipo_id:'equipment-1',cliente_id:'client-1',titulo:'Revisión frenos',descripcion:'Recorrido largo',prioridad:'Alta',solicitud_id:'ticket-http-request-001'};
  const mutate=body=>request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify(body)});
  const response=await mutate({action:'create',entity:'Ticket',revision:0,fields});assert.equal(response.status,200);
  const first=await response.json();assert.equal(first.result.estado,'Nuevo');assert.equal(first.database.entities.Ticket.length,1);
  const repeated=await mutate({action:'create',entity:'Ticket',revision:0,fields});assert.equal(repeated.status,200);
  const second=await repeated.json();assert.equal(first.result.id,second.result.id);assert.equal(first.database.revision,second.database.revision);
  assert.equal((await mutate({action:'create',entity:'Ticket',revision:second.database.revision,fields:{...fields,descripcion:'Cambio inadvertido'}})).status,400);
  assert.equal((await mutate({action:'create',entity:'Ticket',revision:second.database.revision,fields:{...fields,solicitud_id:'ticket-foreign-001',equipo_id:'equipment-2',cliente_id:''}})).status,403);
  assert.equal((await mutate({action:'create',entity:'Ticket',revision:second.database.revision,fields:{...fields,solicitud_id:'ticket-schedule-001',estado:'Programado',responsable_id:'tech-1',fecha_programada:'2026-10-10'}})).status,400);
});

test('coordinator schedules orders; only the assigned technician executes and completed orders preserve equipment',async t=>{
  const user={...coordinator};const request=await fixture(t,user);
  const mutate=body=>request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify(body)});
  const snapshot=async()=> (await request('/api/database',{headers:jsonHeaders})).json();
  const original=await snapshot();
  const fields={equipo_id:'equipment-1',cliente_id:'client-1',sintoma:'Revisar frenos',tipo:'Correctivo',prioridad:'Alta',estado:'Programada',fecha_programada:'2026-10-10',tecnico_id:'tech-1',visible_cliente:true};
  const create=await mutate({action:'create',entity:'OrdenServicio',revision:original.revision,fields});assert.equal(create.status,200);let saved=await create.json();
  Object.assign(user,{role:'Técnico',technician_id:'tech-2',id:'tech-user-2'});
  assert.equal((await mutate({action:'update',entity:'OrdenServicio',revision:saved.database.revision,id:saved.result.id,fields:{estado:'En proceso',expected_updated_at:saved.result.fecha_actualizacion}})).status,403);
  Object.assign(user,{technician_id:'tech-1',id:'tech-user-1'});
  assert.equal((await mutate({action:'update',entity:'OrdenServicio',revision:saved.database.revision,id:saved.result.id,fields:{tecnico_id:'tech-2',expected_updated_at:saved.result.fecha_actualizacion}})).status,400);
  const initialTimestamp=saved.result.fecha_actualizacion;
  const start=await mutate({action:'update',entity:'OrdenServicio',revision:saved.database.revision,id:saved.result.id,fields:{estado:'En proceso',expected_updated_at:initialTimestamp}});assert.equal(start.status,200);saved=await start.json();
  assert.equal((await mutate({action:'update',entity:'OrdenServicio',revision:saved.database.revision,id:saved.result.id,fields:{diagnostico:'Formulario viejo',expected_updated_at:initialTimestamp}})).status,409);
  const closeFields={estado:'Completada',diagnostico:'Ajuste insuficiente',trabajo_realizado:'Ajuste del freno',pruebas_realizadas:'Retención',resultado_pruebas:'Satisfactorio',horometro:900,expected_updated_at:saved.result.fecha_actualizacion};
  const close=await mutate({action:'update',entity:'OrdenServicio',revision:saved.database.revision,id:saved.result.id,fields:closeFields});assert.equal(close.status,200);saved=await close.json();
  assert.equal(saved.result.estado,'Completada');assert.equal(saved.database.entities.LecturaHorometro.at(-1).valor,900);
  Object.assign(user,{role:'Coordinador'});const after=await snapshot();assert.deepEqual(after.entities.Equipo,original.entities.Equipo);assert.deepEqual(after.entities.Hallazgo,original.entities.Hallazgo);
  Object.assign(user,{role:'Cliente',client_id:'client-1'});const visible=await snapshot();assert.deepEqual(visible.entities.OrdenServicio.map(row=>row.id),[saved.result.id]);assert.equal(JSON.stringify(visible).includes('solicitud_datos'),false);
});

test('técnico consulta fotos de equipos activos y conserva el aislamiento de equipos retirados',async t=>{
  const user={...coordinator,role:'Técnico',technician_id:'tech-1'};
  const request=await fixture(t,user,db=>{withImages(db);db.entities.Equipo[1].foto_equipo=picture;});
  assert.equal((await request(`/api/equipment-images/equipment-1/foto_equipo/${imageHash}`,{headers:jsonHeaders})).status,200);
  assert.equal((await request(`/api/equipment-images/equipment-2/foto_equipo/${imageHash}`,{headers:jsonHeaders})).status,200);
  const retired=await fixture(t,user,db=>{withImages(db);db.entities.Equipo[1].foto_equipo=picture;db.entities.Equipo[1].estado_administrativo='Baja';});
  assert.equal((await retired(`/api/equipment-images/equipment-2/foto_equipo/${imageHash}`,{headers:jsonHeaders})).status,404);
});

test('la muestra de operador no se sirve en producción',async t=>{const request=await fixture(t,null);assert.equal((await request('/revision/TCL-001')).status,404);});

test('late commit acknowledgements never replace a newer cache revision',async()=>{
  const cache=createSnapshotCache(null);let finish;
  const older=cache.publishAfterCommit({revision:10,entities:{}},()=>new Promise(resolve=>{finish=resolve;}));
  await cache.publishAfterCommit({revision:11,entities:{}},async()=>{});finish();await older;
  assert.equal(await cache.peek(10),undefined);assert.equal((await cache.peek(11)).revision,11);
});

test('historical reading reconciliation archives originals, checks revision and rejects other roles', async t => {
  const prepare = db => {
    const machine=db.entities.Equipo.find(row=>row.cliente_id);
    const base={id:'retained-901',codigo:'HOR-901',creado_por:'original-author',fecha_creacion:'2025-01-01T00:00:00Z',actualizado_por:'original-author',fecha_actualizacion:'2025-01-01T00:00:00Z',equipo_id:machine.id,cliente_id:machine.cliente_id,fecha:'2025-02-08T14:00:00-06:00',valor:100,es_estimado:false,importado:true,origen_id:'original-source',orden_id:''};
    db.entities.OrdenServicio.push({...base,id:'hist-order-901',codigo:'OS-H-901',fecha:'2025-02-08T20:00:00Z',horometro:100,orden_origen:'SOURCE-901'});
    db.entities.LecturaHorometro.push(base,{...base,id:'duplicate-901',codigo:'HOR-H-901',orden_id:'hist-order-901',registrado_por:'Importación histórica AppSheet'});
  };
  const request=await fixture(t,{...coordinator,role:'Administrador'},prepare);
  const before=await(await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  const body={action:'reconcileHistoricalReadings',revision:before.revision,pairs:[{conservar_id:'retained-901',duplicada_id:'duplicate-901'}]};
  const stale=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({...body,revision:before.revision+1})});assert.equal(stale.status,409);
  const response=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify(body)});assert.equal(response.status,200);assert.deepEqual((await response.json()).result,{conciliadas:1});
  const after=await(await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  assert.equal(after.entities.LecturaHorometro.length,before.entities.LecturaHorometro.length-1);
  assert.equal(after.entities.LecturaHorometro.find(row=>row.id==='retained-901').orden_id,'hist-order-901');
  const audit=after.entities.Bitacora.find(row=>row.accion==='Conciliación de lectura duplicada');
  assert.deepEqual(JSON.parse(audit.lectura_duplicada_json),before.entities.LecturaHorometro.find(row=>row.id==='duplicate-901'));
  assert.deepEqual(after.entities.OrdenServicio,before.entities.OrdenServicio);
  for(const user of [coordinator,{...coordinator,role:'Técnico',technician_id:'tech-1'},client]) {
    const denied=await fixture(t,user,prepare);
    assert.equal((await denied('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify(body)})).status,403);
  }
});

test('imported report correction removes or moves the report with its readings, audits it and rejects other roles', async t => {
  const prepare = db => {
    const owner=db.entities.Equipo.find(row=>row.cliente_id&&db.entities.Equipo.filter(other=>other.cliente_id===row.cliente_id).length>1);
    const [wrong]=db.entities.Equipo.filter(row=>row.cliente_id===owner.cliente_id);
    const base={creado_por:'import',fecha_creacion:'2026-10-16T13:30:00Z',actualizado_por:'import',fecha_actualizacion:'2026-10-16T13:30:00Z',equipo_id:wrong.id,cliente_id:wrong.cliente_id,fecha:'2026-05-14T18:49:00.000Z'};
    db.entities.OrdenServicio.push({...base,id:'hist-order-493',codigo:'OS-H-0493',importado:true,origen_id:'source-493',orden_origen:'493',estado:'Completado',horometro:8059});
    db.entities.LecturaHorometro.push({...base,id:'hist-reading-493',codigo:'HOR-H-0493',orden_id:'hist-order-493',valor:8059,es_estimado:false,registrado_por:'Importación histórica AppSheet'});
  };
  const request=await fixture(t,{...coordinator,role:'Administrador'},prepare);
  const before=await(await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  const target=before.entities.Equipo.find(row=>row.cliente_id===before.entities.OrdenServicio.find(order=>order.id==='hist-order-493').cliente_id&&row.id!==before.entities.OrdenServicio.find(order=>order.id==='hist-order-493').equipo_id);
  const report={orden_id:'hist-order-493',accion:'reasignar',equipo_id:target.id,motivo:'Las lecturas son del otro equipo'};
  for(const user of [coordinator,{...coordinator,role:'Técnico',technician_id:'tech-1'},client]) {
    const denied=await fixture(t,user,prepare);
    assert.equal((await denied('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'reviseImportedReport',revision:before.revision,report})})).status,403);
  }
  const moved=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'reviseImportedReport',revision:before.revision,report})});
  assert.equal(moved.status,200);assert.deepEqual((await moved.json()).result,{accion:'reasignar',orden:'OS-H-0493',lecturas:1});
  const middle=await(await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  assert.equal(middle.entities.OrdenServicio.find(row=>row.id==='hist-order-493').equipo_id,target.id);
  assert.equal(middle.entities.LecturaHorometro.find(row=>row.id==='hist-reading-493').equipo_id,target.id);
  const removed=await request('/api/mutate',{method:'POST',headers:jsonHeaders,body:JSON.stringify({action:'reviseImportedReport',revision:middle.revision,report:{orden_id:'hist-order-493',accion:'anular',motivo:'No corresponde a equipos del portal'}})});
  assert.equal(removed.status,200);
  const after=await(await request('/api/backup',{headers:{Cookie:'em_session=x'}})).json();
  assert.equal(after.entities.OrdenServicio.some(row=>row.id==='hist-order-493'),false);
  assert.equal(after.entities.LecturaHorometro.some(row=>row.id==='hist-reading-493'),false);
  const audit=after.entities.Bitacora.find(row=>row.accion==='Anulación de reporte importado');
  assert.equal(JSON.parse(audit.version_anterior).equipo_id,target.id);assert.equal(audit.motivo,'No corresponde a equipos del portal');
  assert.ok(after.entities.Bitacora.some(row=>row.accion==='Reasignación de reporte importado'&&row.equipo_anterior_id===before.entities.OrdenServicio.find(order=>order.id==='hist-order-493').equipo_id));
});
