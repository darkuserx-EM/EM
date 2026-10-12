import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import {migrate} from './database.mjs';
import {createApp} from './app.mjs';
import {token,digest,hashPassword} from './security.mjs';
import {totp,encryptionKey} from './totp.mjs';
import {verifyMfaConfiguration} from './mfa.mjs';
test('segundo factor: alta, acceso y recuperación',{skip:process.env.MYSQL_INTEGRATION!=='1',timeout:120000},async t=>{
 const host=process.env.TEST_DB_HOST||'127.0.0.1';assert.ok(['127.0.0.1','localhost','::1'].includes(host));
 const config={host,port:Number(process.env.TEST_DB_PORT||3306),user:process.env.TEST_DB_USER||'root',password:process.env.TEST_DB_PASSWORD};assert.ok(config.password);
 const name='em_ci_'+randomUUID().replaceAll('-',''),control=await mysql.createConnection(config);await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
 const pool=mysql.createPool({...config,database:name});const servers=[];
 t.after(async()=>{for(const server of servers){server.closeAllConnections();await new Promise(r=>server.close(r));}await pool.end();assert.match(name,/^em_ci_[a-f0-9]{32}$/);await control.query(`DROP DATABASE ${name}`);await control.end();});
 await migrate(pool);await migrate(pool);const origin='https://synthetic.invalid',setupToken=token(),key=randomBytes(32).toString('base64');
 async function start(totpEncryptionKey){const server=createApp({pool,origin,setupToken,production:true,totpEncryptionKey}).listen(0,'127.0.0.1');servers.push(server);await once(server,'listening');return `http://127.0.0.1:${server.address().port}/api/`;}
 const url=await start(key);let serial=1;
 async function call(path,body,s,base=url){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Forwarded-For':`198.51.100.${serial++}`,...(s?{Cookie:s.cookie,'X-CSRF-Token':s.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,headers:r.headers,data:await r.json()};}
 const email='admin@example.invalid';let password='Clave sintética extensa 2026!';assert.equal((await call('setup',{setupToken,email,name:'QA',password})).status,201);
 async function session(r){assert.equal(r.status,200);const raw=r.headers.getSetCookie()[0];assert.ok(raw);const s={cookie:raw.split(';')[0],csrf:''};s.csrf=(await call('session',undefined,s)).data.csrf;return s;}
 const admin=await session(await call('login',{email,password})),other=await session(await call('login',{email,password}));let secret,codes;
 const [users]=await pool.query('SELECT id FROM em_users');const id=users[0].id;
 const resetCounter=()=>pool.execute('UPDATE em_users SET totp_last_step=-1 WHERE id=?',[id]);
 const challenge=async()=>{const r=await call('login',{email,password});assert.equal(r.status,200);assert.equal(r.data.needsTotp,true);assert.equal(r.headers.getSetCookie().length,0);return r.data.challenge;};
 await t.test('sin clave no ofrece alta; exige sesión, CSRF y contraseña para prepararla',async()=>{
  const noKey=await start();assert.equal((await call('2fa/status',undefined,admin,noKey)).data.configured,false);assert.equal((await call('2fa/setup',{currentPassword:password},admin,noKey)).status,409);
  assert.equal((await call('2fa/setup',{currentPassword:password})).status,401);assert.equal((await call('2fa/setup',{currentPassword:password},{...admin,csrf:'bad'})).status,403);
  assert.equal((await call('2fa/setup',{currentPassword:'wrong'},admin)).status,400);
  const setup=await call('2fa/setup',{currentPassword:password},admin);assert.equal(setup.status,200);secret=setup.data.secret;assert.match(secret,/^[A-Z2-7]{32}$/);
  const [[row]]=await pool.query('SELECT totp_pending,totp_enabled FROM em_users');assert.ok(!row.totp_pending.includes(secret));assert.equal(row.totp_enabled,0);
 });
 await t.test('verifica antes de activar, devuelve diez códigos una vez y revoca otras sesiones',async()=>{
  assert.equal((await call('2fa/enable',{currentPassword:password,code:'bad'},admin)).status,400);
  const r=await call('2fa/enable',{currentPassword:password,code:totp(secret)},admin);assert.equal(r.status,200);codes=r.data.recoveryCodes;assert.equal(new Set(codes).size,10);
  assert.equal((await call('session',undefined,other)).status,401);assert.equal((await call('session',undefined,admin)).status,200);
  await verifyMfaConfiguration(pool,encryptionKey(key));await assert.rejects(verifyMfaConfiguration(pool,null));await assert.rejects(verifyMfaConfiguration(pool,randomBytes(32)));
  const [stored]=await pool.query('SELECT code_hash FROM em_recovery_codes');assert.equal(stored.length,10);assert.ok(stored.every(row=>!codes.includes(row.code_hash)));
 });
 await t.test('contraseña sola no da sesión; TOTP de un solo uso y desafío consumido',async()=>{
  // Replay the exact accepted code, even if the wall clock crosses a TOTP step.
  await resetCounter();const c=await challenge(),code=totp(secret),r=await call('login/totp',{challenge:c,code});const s=await session(r);assert.equal((await call('session',undefined,s)).status,200);
  assert.equal((await call('login/totp',{challenge:c,code})).status,401);
  const next=await challenge();assert.equal((await call('login/totp',{challenge:next,code})).status,401);
 });
 await t.test('recuperación se usa una vez y no elimina segundo factor',async()=>{
  const c=await challenge();await session(await call('login/totp',{challenge:c,code:codes[0]}));
  assert.equal((await call('login/totp',{challenge:await challenge(),code:codes[0]})).status,401);
  assert.equal((await call('2fa/status',undefined,admin)).data.enabled,true);
 });
 await t.test('cinco fallos agotan el desafío; contador persiste entre desafíos e IP',async()=>{
  await pool.execute('DELETE FROM em_login_limits WHERE bucket=?',[digest('mfa:'+id)]);const c=await challenge();
  for(let i=0;i<5;i++)assert.equal((await call('login/totp',{challenge:c,code:'wrong'})).status,401);
  assert.equal((await call('login/totp',{challenge:c,code:codes[1]})).status,401);
  for(let i=0;i<2;i++)assert.equal((await call('login/totp',{challenge:await challenge(),code:'wrong'})).status,401);
  assert.equal((await call('login/totp',{challenge:await challenge(),code:codes[1]})).status,429);
  await pool.execute('DELETE FROM em_login_limits WHERE bucket=?',[digest('mfa:'+id)]);
 });
 await t.test('desafío vencido o emitido antes de cambiar contraseña no sirve',async()=>{
  let c=await challenge();await pool.execute('UPDATE em_mfa_challenges SET expires_at=? WHERE token_hash=?',[Date.now()-1,digest(c)]);assert.equal((await call('login/totp',{challenge:c,code:codes[1]})).status,401);
  c=await challenge();password='Otra clave sintética larga 2026!';await pool.execute('UPDATE em_users SET password_hash=? WHERE id=?',[await hashPassword(password),id]);assert.equal((await call('login/totp',{challenge:c,code:codes[1]})).status,401);
 });
 await t.test('desactivar exige contraseña y factor; cliente no puede configurar',async()=>{
  const clientId=randomUUID(),clientToken=token(),csrf=token();await pool.execute('INSERT INTO em_users (id,email,name,role,password_hash) VALUES (?,?,?,?,?)',[clientId,'client@example.invalid','Cliente','Cliente',await hashPassword(password)]);await pool.execute('INSERT INTO em_sessions (token_hash,user_id,csrf,expires_at,last_seen_at) VALUES (?,?,?,?,?)',[digest(clientToken),clientId,csrf,Date.now()+3600000,Date.now()]);
  assert.equal((await call('2fa/status',undefined,{cookie:'__Host-em_session='+clientToken,csrf})).status,403);
  assert.equal((await call('2fa/disable',{currentPassword:password,code:'bad'},admin)).status,400);
  assert.equal((await call('2fa/disable',{currentPassword:password,code:codes[1]},admin)).status,200);
  await session(await call('login',{email,password}));await verifyMfaConfiguration(pool,null);
  const [[events]]=await pool.query("SELECT COUNT(*) n FROM em_security_events WHERE action IN ('account.mfa-enabled','account.mfa-disabled')");assert.equal(events.n,2);
 });
});
