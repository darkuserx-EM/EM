import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.mjs';
import { createSeed, LocalDataSource, equipmentImageFields } from './generated/domain.mjs';
import { token } from './security.mjs';
import { imageReference, presentDatabase, resolveEquipmentImages } from './equipment-images.mjs';
import { logFailure, parseTrustProxy } from './diagnostics.mjs';
import { createSnapshotCache } from './snapshot-cache.mjs';
const origin = 'http://localhost:3000';
const csrf = token();
const coordinator = {id:'test-coord',name:'Prueba',role:'Coordinador',csrf,token_hash:'hash'};
const client = {id:'test-client',name:'Prueba',role:'Cliente',client_id:'client-1',csrf,token_hash:'hash'};
function poolFor(user, prepare = () => {}) {
  const db = createSeed();
  prepare(db);
  const fake = {
    async query(sql) {
      if(sql.includes('SELECT revision')) return [[{revision:db.revision}]];
      if(sql.includes('SELECT entity')) return [Object.entries(db.entities).flatMap(([entity,rows])=>rows.map(row=>({entity,payload:JSON.stringify(row)})))];
      if(sql.includes('COUNT(*)')) return [[{n:1}]];
      if(sql==='SELECT 1') return [[{1:1}]];
      throw new Error('Unexpected query');
    },
    async execute(sql, args) {
      if(sql.includes('em_sessions s')) return [user?[user]:[]];
      if(sql.startsWith('INSERT INTO em_records')) {
        const [entity,id,payload]=args; const row=JSON.parse(payload); const index=db.entities[entity].findIndex(item=>item.id===id);
        if(index < 0) db.entities[entity].push(row); else db.entities[entity][index]=row;
        return [{}];
      }
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
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('cache-control'),'no-store');
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
  assert.equal(exported.rows.length,1);assert.equal(exported.rows[0].foto_equipo,picture);
  for(const field of equipmentImageFields) {assert.equal(db.entities.Equipo[0][field],imageReference(picture));assert.equal(backup.entities.Equipo[0][field],picture);assert.equal(exported.rows[0][field],picture);}
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
  const fields=Object.fromEntries(equipmentImageFields.map((field,index)=>[field,'data:image/png;base64,'+Buffer.concat([Buffer.from(picture.split(',')[1],'base64'),Buffer.alloc(1100000,65+index)]).toString('base64')]));
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
