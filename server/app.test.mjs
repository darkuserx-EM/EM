import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.mjs';
import { createSeed, LocalDataSource, equipmentImageFields } from './generated/domain.mjs';
import { token } from './security.mjs';
import { imageReference, presentDatabase, resolveEquipmentImages } from './equipment-images.mjs';
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
async function fixture(t,user,prepare) {
  const app=createApp({pool:poolFor(user,prepare),origin,setupToken:token(),production:true});
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
