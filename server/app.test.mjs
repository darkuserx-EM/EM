import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.mjs';
import { createSeed, LocalDataSource } from './generated/domain.mjs';
import { token } from './security.mjs';
const origin = 'http://localhost:3000';
const csrf = token();
const coordinator = {id:'test-coord',name:'Prueba',role:'Coordinador',csrf,token_hash:'hash'};
const client = {id:'test-client',name:'Prueba',role:'Cliente',client_id:'client-1',csrf,token_hash:'hash'};
function poolFor(user) {
  const db = createSeed();
  const fake = {
    async query(sql) {
      if(sql.includes('SELECT revision')) return [[{revision:db.revision}]];
      if(sql.includes('SELECT entity')) return [Object.entries(db.entities).flatMap(([entity,rows])=>rows.map(row=>({entity,payload:JSON.stringify(row)})))];
      if(sql.includes('COUNT(*)')) return [[{n:1}]];
      if(sql==='SELECT 1') return [[{1:1}]];
      throw new Error('Unexpected query');
    },
    async execute(sql) { if(sql.includes('em_sessions s')) return [user?[user]:[]]; throw new Error('Unexpected write'); },
    async getConnection() { return {...fake,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{}}; },
  };
  return fake;
}
async function fixture(t,user) {
  const app=createApp({pool:poolFor(user),origin,setupToken:token(),production:true});
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
