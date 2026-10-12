import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import {migrate} from './database.mjs';
import {createApp} from './app.mjs';
import {token,digest} from './security.mjs';
import {idleTimeout} from './session-policy.mjs';

test('sesiones: actividad real, límites y transición de cookies',{skip:process.env.MYSQL_INTEGRATION!=='1',timeout:120000},async t=>{
 const host=process.env.TEST_DB_HOST||'127.0.0.1';assert.ok(['127.0.0.1','localhost','::1'].includes(host));
 const config={host,port:Number(process.env.TEST_DB_PORT||3306),user:process.env.TEST_DB_USER||'root',password:process.env.TEST_DB_PASSWORD};assert.ok(config.password);
 const name='em_ci_'+randomUUID().replaceAll('-',''),control=await mysql.createConnection(config);await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
 const pool=mysql.createPool({...config,database:name});let server;
 t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await pool.end();assert.match(name,/^em_ci_[a-f0-9]{32}$/);await control.query(`DROP DATABASE ${name}`);await control.end();});
 await migrate(pool);await migrate(pool);
 const origin='https://synthetic.invalid',setupToken=token();server=createApp({pool,origin,setupToken,production:true}).listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}/api/`;let serial=1;
 async function call(path,body,s,headers={}){const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Forwarded-For':`198.51.100.${serial++}`,...(s?{Cookie:s.cookie,'X-CSRF-Token':s.csrf}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,headers:r.headers,data:r.status===204?null:await r.json()};}
 const password='Clave sintética extensa 2026!';assert.equal((await call('setup',{setupToken,email:'admin@example.invalid',name:'QA',password})).status,201);
 async function login(){const r=await call('login',{email:'admin@example.invalid',password});assert.equal(r.status,200);const raw=r.headers.getSetCookie()[0];assert.match(raw,/^__Host-em_session=/);assert.match(raw,/Secure/);assert.match(raw,/Path=\//);assert.ok(!raw.includes('Domain='));const s={cookie:raw.split(';')[0],csrf:'',hash:digest(raw.split(';')[0].split('=')[1])};s.csrf=(await call('session',undefined,s)).data.csrf;return s;}
 const seen=async s=>Number((await pool.execute('SELECT last_seen_at FROM em_sessions WHERE token_hash=?',[s.hash]))[0][0]?.last_seen_at);
 await t.test('sondeo no extiende actividad; interacción válida sí, y no escribe cada petición',async()=>{
  const s=await login(),old=Date.now()-59*60000;await pool.execute('UPDATE em_sessions SET last_seen_at=? WHERE token_hash=?',[old,s.hash]);
  assert.equal((await call('database',undefined,s,{'X-Portal-Poll':'1'})).status,200);assert.equal(await seen(s),old);
  assert.equal((await call('session/activity',{},s,{'X-CSRF-Token':'wrong'})).status,403);assert.equal(await seen(s),old);
  assert.equal((await call('session/activity',{},s)).status,200);const recent=await seen(s);assert.ok(recent>old);await call('session/activity',{},s);assert.equal(await seen(s),recent);
 });
 await t.test('61 minutos inactivos y ocho horas absolutas rechazan incluso con cookie válida',async()=>{
  const s=await login();await pool.execute('UPDATE em_sessions SET last_seen_at=? WHERE token_hash=?',[Date.now()-61*60000,s.hash]);
  const r=await call('database',undefined,s);assert.equal(r.status,401);assert.equal(r.data.code,'SESSION_IDLE');assert.equal((await call('session/activity',{},s)).status,401);
  const another=await login();await pool.execute('UPDATE em_sessions SET expires_at=? WHERE token_hash=?',[Date.now()-1,another.hash]);assert.equal((await call('session',undefined,another)).status,401);
 });
 await t.test('cookie antigua migra sin extender vencimiento y salir limpia ambas',async()=>{
  const s=await login();s.cookie=s.cookie.replace('__Host-em_session','em_session');const r=await call('session',undefined,s);assert.equal(r.status,200);const cookies=r.headers.getSetCookie();assert.ok(cookies.some(c=>c.startsWith('__Host-em_session=')));assert.ok(cookies.some(c=>c.startsWith('em_session=;')));
  const out=await call('logout',{},s);assert.equal(out.status,200);assert.ok(out.headers.getSetCookie().filter(c=>c.includes('Expires=Thu, 01 Jan 1970')).length>=2);
 });
 await t.test('migrar no renueva sesiones conocidas y valida configuración',async()=>{
  const s=await login(),old=Date.now()-20*60000;await pool.execute('UPDATE em_sessions SET last_seen_at=? WHERE token_hash=?',[old,s.hash]);await migrate(pool);assert.equal(await seen(s),old);
  assert.equal(idleTimeout(),3600000);for(const v of ['0','241','bad','15.5'])assert.throws(()=>idleTimeout(v),{code:'CONFIG_SESSION_IDLE_MINUTES'});
 });
});
