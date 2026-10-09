import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import { migrate, readSnapshot, readDatabase, readEquipmentRecord, saveDatabase, cleanupExpired, consumeLoginAttempt } from './database.mjs';
import { createApp } from './app.mjs';
import { token, digest, hashPassword } from './security.mjs';
import { validateDatabase } from './generated/domain.mjs';

// Destructive tests are restricted to a new, synthetic, loopback database.
test('MySQL real: persistencia, transacciones, acceso y mantenimiento', {skip:process.env.MYSQL_INTEGRATION !== '1', timeout:180000}, async t => {
  const host = process.env.TEST_DB_HOST || '127.0.0.1';
  assert.ok(['127.0.0.1','localhost','::1'].includes(host),'Integration tests only use loopback MySQL');
  const config = {host,port:Number(process.env.TEST_DB_PORT || 3306),user:process.env.TEST_DB_USER || 'root',password:process.env.TEST_DB_PASSWORD,multipleStatements:false};
  assert.ok(config.password,'TEST_DB_PASSWORD is required');
  const name = `em_ci_${randomUUID().replaceAll('-','')}`;
  const control = await mysql.createConnection(config);
  await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
  const pool = mysql.createPool({...config,database:name,connectionLimit:8});
  const canonical = db => ({...db,entities:Object.fromEntries(Object.entries(db.entities).map(([entity,rows])=>[entity,[...rows].sort((a,b)=>a.id.localeCompare(b.id))]))});
  let server;
  t.after(async () => {
    if(server) {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await pool.end();
    assert.match(name,/^em_ci_[a-f0-9]{32}$/);
    await control.query(`DROP DATABASE ${name}`); await control.end();
  });
  await t.test('migración repetible e índices para tablas nuevas y existentes',async()=>{
    await migrate(pool); const initial=await readSnapshot(pool);
    assert.ok(initial.entities.Catalogos.length);assert.equal(initial.entities.Cliente.length,0);
    for(const table of ['em_sessions','em_login_limits']) await pool.query(`ALTER TABLE ${table} DROP INDEX idx_expires_at`);
    await migrate(pool); await migrate(pool); assert.deepEqual(await readSnapshot(pool),initial);
    for(const table of ['em_sessions','em_login_limits']) {
      const [rows]=await pool.query(`SHOW INDEX FROM ${table} WHERE Column_name='expires_at' AND Seq_in_index=1`);assert.equal(rows.length,1);
    }
  });
  await t.test('2,000 filas: lotes, rollback, borrados y comparación con guardado individual',async()=>{
    const before=await readSnapshot(pool);const next=structuredClone(before); next.revision++;
    const template=before.entities.Catalogos[0];
    const rows=Array.from({length:2000},(_,i)=>({...template,id:`batch-${i}`,codigo:`CAT-${10000+i}`,categoria:'Marcas',nombre:`Prueba por lotes ${i}`,activo:true}));
    next.entities.Catalogos.push(...rows);
    validateDatabase(next);
    const conn=await pool.getConnection();
    try {
      // The former algorithm, inside a transaction that is always rolled back.
      await conn.beginTransaction();await readDatabase(conn,true);
      const oldStart=performance.now();
      for(const row of rows) await conn.execute('INSERT INTO em_records (entity,id,payload) VALUES (?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)',['Catalogos',row.id,JSON.stringify(row)]);
      const individualMs=performance.now()-oldStart;await conn.rollback();
      assert.deepEqual(await readSnapshot(pool),before);
      await conn.beginTransaction();await readDatabase(conn,true);let batches=0;
      const wrapped={execute:async(sql,args)=>{if(sql.startsWith('INSERT INTO em_records')) batches++;return conn.execute(sql,args);}};
      const batchStart=performance.now();await saveDatabase(wrapped,next,before);await conn.commit();const batchMs=performance.now()-batchStart;
      assert.ok(batches<=12);assert.deepEqual(canonical(await readSnapshot(pool)),canonical(next));
      t.diagnostic(JSON.stringify({benchmark:'synthetic 2000 rows; CI MySQL, not Hostinger',individualQueries:2000,batchQueries:batches,individualMs:Math.round(individualMs),batchMs:Math.round(batchMs)}));
      const invalid=structuredClone(next);invalid.revision++;invalid.entities.Catalogos.forEach(row=>{row.nombre+=' cambiado';});
      await conn.beginTransaction();await readDatabase(conn,true);let writes=0;
      await assert.rejects(saveDatabase({execute:async(sql,args)=>{if(sql.startsWith('INSERT INTO em_records') && ++writes===2) throw new Error('simulated failure after first batch');return conn.execute(sql,args);}},invalid,next));
      await conn.rollback(); assert.deepEqual(canonical(await readSnapshot(pool)),canonical(next));
      const trimmed=structuredClone(before);trimmed.revision=next.revision+1;
      await conn.beginTransaction();await readDatabase(conn,true);await saveDatabase(conn,trimmed,next);await conn.commit();
      assert.deepEqual(await readSnapshot(pool),trimmed);
    } finally {await conn.rollback();conn.release();}
  });
  const origin='http://localhost:3000'; const setupToken=token();
  server=createApp({pool,origin,setupToken,production:false}).listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  const oldPassword='Una frase de prueba inicial 2026';const newPassword='Otra frase de prueba renovada 2026';const email='synthetic@example.test';
  let serial=10;
  async function call(path,body,session,ip) {
    const response=await fetch(url+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),'X-Forwarded-For':ip || session?.ip || `203.0.113.${serial++}`},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();return {status:response.status,data:text?JSON.parse(text):undefined,headers:response.headers};
  }
  async function login(password=oldPassword,ip=`203.0.113.${serial++}`) {
    const result=await call('login',{email,password},undefined,ip);assert.equal(result.status,200,JSON.stringify(result.data));
    const session={cookie:result.headers.getSetCookie()[0].split(';')[0],csrf:'',ip};
    session.csrf=(await call('session',undefined,session)).data.csrf;return session;
  }
  assert.equal((await call('setup',{setupToken,email,name:'Cuenta sintética',password:oldPassword})).status,201);
  let current;
  await t.test('los intentos fallidos de una IP no bloquean la misma cuenta en otra',async()=>{
    for(let i=0;i<8;i++) assert.equal((await call('login',{email,password:'incorrecta'},undefined,'198.51.100.10')).status,401);
    assert.equal((await call('login',{email,password:oldPassword},undefined,'198.51.100.10')).status,429);
    current=await login(oldPassword,'198.51.100.11');
    assert.equal((await call('session',undefined,current)).status,200);
    const missing=await call('login',{email:'missing@example.test',password:'incorrecta'},undefined,'198.51.100.12');assert.equal(missing.status,401);assert.equal(missing.data.error,'Correo o contraseña incorrectos.');
    const bucket=digest('expired synthetic bucket');assert.equal(await consumeLoginAttempt(pool,bucket,1000),true);
    for(let i=0;i<7;i++) await consumeLoginAttempt(pool,bucket,1000);
    assert.equal(await consumeLoginAttempt(pool,bucket,1000),false);assert.equal(await consumeLoginAttempt(pool,bucket,901001),true);
  });
  await t.test('concurrencia 409, importación atómica y restauración conserva auditoría',async()=>{
    const initial=(await call('backup',undefined,current)).data;
    const body={action:'create',entity:'Catalogos',revision:initial.revision,fields:{categoria:'Marcas',nombre:'Concurrente A',activo:true}};
    const responses=await Promise.all([call('mutate',body,current),call('mutate',{...body,fields:{...body.fields,nombre:'Concurrente B'}},current)]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const before=(await call('backup',undefined,current)).data;
    const invalid=await call('mutate',{action:'import',entity:'Catalogos',revision:before.revision,rows:[{fields:{categoria:'Marcas',nombre:'Válido sin persistir',activo:true}},{fields:{categoria:'No existe',nombre:'Inválido',activo:true}}]},current);
    assert.equal(invalid.status,400);assert.deepEqual((await call('backup',undefined,current)).data,before);
    const editedBackup=structuredClone(initial);editedBackup.entities.Bitacora=[];
    const restored=await call('mutate',{action:'restore',database:editedBackup,revision:before.revision,exportedAt:'2026-10-08T12:00:00.000Z'},current);assert.equal(restored.status,200);
    const after=(await call('backup',undefined,current)).data;assert.equal(after.entities.Bitacora.length,before.entities.Bitacora.length+1);
    for(const row of before.entities.Bitacora) assert.deepEqual(after.entities.Bitacora.find(saved=>saved.id===row.id),row);
    const restoredLog=after.entities.Bitacora.find(row=>!before.entities.Bitacora.some(old=>old.id===row.id));assert.match(restoredLog.detalle,/2026-10-08T12:00/);
  });
  await t.test('hallazgos: persistencia, concurrencia y descarte conservan evidencia',async()=>{
    const before=(await call('backup',undefined,current)).data;
    const createdEquipment=await call('mutate',{action:'create',entity:'Equipo',revision:before.revision,fields:{marca:'Prueba',modelo:'HAL-Test',serie:'HAL-SYNTHETIC',tipo:'Prueba',propiedad:'Propio',estado:'Disponible'}},current);
    assert.equal(createdEquipment.status,200);
    const created=await call('mutate',{action:'create',entity:'Hallazgo',revision:createdEquipment.data.database.revision,fields:{equipo_id:createdEquipment.data.result.id,descripcion:'Inspección sintética',componente:'Otro',prioridad:'Media',estado:'Abierto'}},current);
    assert.equal(created.status,200);const id=created.data.result.id;
    const revision=created.data.database.revision;
    const edits=await Promise.all([
      call('mutate',{action:'update',entity:'Hallazgo',id,revision,fields:{estado:'Programado',responsable:'Responsable sintético',fecha_programada:'2026-10-15',nota_cambio:'Visita acordada'}},current),
      call('mutate',{action:'update',entity:'Hallazgo',id,revision,fields:{estado:'Cotizado',nota_cambio:'Cotización de prueba'}},current),
    ]);
    assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
    const snapshot=(await call('backup',undefined,current)).data;
    const invalid=await call('mutate',{action:'update',entity:'Hallazgo',id,revision:snapshot.revision,fields:{estado:'Resuelto',detalle_resolucion:'Sin evidencia',nota_cambio:'Intento inválido'}},current);
    assert.equal(invalid.status,400);assert.deepEqual((await call('backup',undefined,current)).data,snapshot);
    const discarded=await call('mutate',{action:'update',entity:'Hallazgo',id,revision:snapshot.revision,fields:{estado:'Descartado',detalle_resolucion:'Registro sintético revisado',nota_cambio:'Revisión completada'}},current);
    assert.equal(discarded.status,200);
    const saved=await readSnapshot(pool);assert.equal(saved.entities.Hallazgo.find(row=>row.id===id).estado,'Descartado');
    assert.equal(saved.entities.Bitacora.filter(row=>row.hallazgo_id===id).length,3);
    assert.deepEqual(saved.entities.OrdenServicio,before.entities.OrdenServicio);
    assert.equal((await call('mutate',{action:'restore',database:before,revision:saved.revision},current)).status,200);
  });
  await t.test('planes: versiones atómicas y conflicto de cambios simultáneos',async()=>{
    const before=(await call('backup',undefined,current)).data;
    const equipment=await call('mutate',{action:'create',entity:'Equipo',revision:before.revision,fields:{marca:'Prueba',modelo:'PM-Test',serie:'PM-SYNTHETIC',tipo:'Prueba',propiedad:'Propio',estado:'Disponible'}},current);assert.equal(equipment.status,200);
    const fields={schema_plan:1,equipo_id:equipment.data.result.id,tipo_plan:'Preventivo',criterio:'Días',intervalo:30,estado_plan:'Activo',base_origen:'Pendiente',base_fecha:'',base_horas:null,base_confirmada:false,motivo:'Base sintética pendiente'};
    const first=await call('mutate',{action:'create',entity:'PlanPM',revision:equipment.data.database.revision,fields},current);assert.equal(first.status,200);
    const revision=first.data.database.revision;
    const results=await Promise.all([60,90].map(intervalo=>call('mutate',{action:'create',entity:'PlanPM',revision,fields:{...fields,intervalo}},current)));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const saved=await readSnapshot(pool);const plans=saved.entities.PlanPM.filter(row=>row.equipo_id===equipment.data.result.id);assert.equal(plans.length,2);assert.equal(plans.filter(row=>row.vigente).length,1);assert.equal(plans.find(row=>row.vigente).version,2);
    const invalid=await call('mutate',{action:'create',entity:'PlanPM',revision:saved.revision,fields:{...fields,base_origen:'Base inicial',base_fecha:'2099-01-01',base_confirmada:true,base_calidad:'Registrada'}},current);assert.equal(invalid.status,400);assert.deepEqual(await readSnapshot(pool),saved);
    assert.equal((await call('mutate',{action:'restore',database:before,revision:saved.revision},current)).status,200);
  });
  await t.test('contraseña exige la actual, invalida otras sesiones y rechaza la antigua',async()=>{
    const other=await login();
    const wrong=await call('password',{currentPassword:'incorrecta',newPassword},current);assert.equal(wrong.status,400);assert.equal((await call('session',undefined,other)).status,200);
    assert.equal((await call('password',{currentPassword:oldPassword,newPassword:'short'},current)).status,400);
    let resume; let observed;
    const paused=new Promise(resolve=>{resume=resolve;});const captured=new Promise(resolve=>{observed=resolve;});
    const racePool={query:(...args)=>pool.query(...args),getConnection:()=>pool.getConnection(),execute:async(sql,args)=>{
      const result=await pool.execute(sql,args);
      if(sql.startsWith('SELECT * FROM em_users WHERE email=')) {observed();await paused;}
      return result;
    }};
    const raceServer=createApp({pool:racePool,origin,production:false}).listen(0,'127.0.0.1');await once(raceServer,'listening');
    try {
      const delayed=fetch(`http://127.0.0.1:${raceServer.address().port}/api/login`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password:oldPassword})});
      await captured;
      assert.equal((await call('password',{currentPassword:oldPassword,newPassword},current)).status,200);
      resume();assert.equal((await delayed).status,401,'an in-flight old-password login must not recreate a session');
    } finally {resume();raceServer.closeAllConnections();await new Promise(resolve=>raceServer.close(resolve));}
    assert.equal((await call('session',undefined,current)).status,200);assert.equal((await call('session',undefined,other)).status,401);
    assert.equal((await call('login',{email,password:oldPassword})).status,401);
    assert.equal((await call('session',undefined,await login(newPassword))).status,200);
  });
  await t.test('cerrar otras o todas las sesiones respeta el alcance y otras cuentas',async()=>{
    const other=await login(newPassword);
    const outsiderId=randomUUID();const outsiderToken=token();
    await pool.execute('INSERT INTO em_users (id,email,name,role,password_hash) VALUES (?,?,?,?,?)',[outsiderId,'other@example.test','Otra cuenta','Cliente',await hashPassword(newPassword)]);
    await pool.execute('INSERT INTO em_sessions (token_hash,user_id,csrf,expires_at) VALUES (?,?,?,?)',[digest(outsiderToken),outsiderId,token(),Date.now()+60000]);
    const outside={cookie:`em_session=${outsiderToken}`,csrf:'',ip:'203.0.113.200'};
    assert.equal((await call('sessions/revoke',{scope:'others',currentPassword:newPassword},current)).status,200);
    assert.equal((await call('session',undefined,other)).status,401);assert.equal((await call('session',undefined,current)).status,200);assert.equal((await call('session',undefined,outside)).status,200);
    const all=await call('sessions/revoke',{scope:'all',currentPassword:newPassword},current);assert.equal(all.status,200);assert.equal(all.data.signedOut,true);assert.match(all.headers.get('set-cookie'),/em_session=;/);
    assert.equal((await call('session',undefined,current)).status,401);assert.equal((await call('session',undefined,outside)).status,200);
    current=await login(newPassword);
  });
  await t.test('limpieza elimina vencidos y conserva sesiones y límites activos',async()=>{
    const [users]=await pool.execute('SELECT id FROM em_users WHERE email=?',[email]);const id=users[0].id;const now=Date.now();
    const expired=digest('expired-session');const active=digest('active-session');
    for(const [key,expires] of [[expired,now-1],[active,now+60000]]) await pool.execute('INSERT INTO em_sessions (token_hash,user_id,csrf,expires_at) VALUES (?,?,?,?)',[key,id,token(),expires]);
    const deadBucket=digest('dead-bucket');const liveBucket=digest('live-bucket');
    for(const [key,expires] of [[deadBucket,now-1],[liveBucket,now+60000]]) await pool.execute('INSERT INTO em_login_limits (bucket,attempts,expires_at) VALUES (?,?,?)',[key,1,expires]);
    const backlog=Array.from({length:1200},(_,i)=>[digest(`expired-bucket-${i}`),1,now-1]);
    await pool.query('INSERT INTO em_login_limits (bucket,attempts,expires_at) VALUES ?', [backlog]);
    const removed=await cleanupExpired(pool,now);
    assert.ok(removed.em_login_limits>=1201);
    assert.equal((await pool.execute('SELECT COUNT(*) AS n FROM em_login_limits WHERE expires_at<=?',[now]))[0][0].n,0);
    assert.equal((await pool.execute('SELECT token_hash FROM em_sessions WHERE token_hash=?',[expired]))[0].length,0);
    assert.equal((await pool.execute('SELECT token_hash FROM em_sessions WHERE token_hash=?',[active]))[0].length,1);
    assert.equal((await pool.execute('SELECT bucket FROM em_login_limits WHERE bucket=?',[deadBucket]))[0].length,0);
    assert.equal((await pool.execute('SELECT bucket FROM em_login_limits WHERE bucket=?',[liveBucket]))[0].length,1);
    assert.equal((await call('session',undefined,current)).status,200);
  });
  await t.test('lectura puntual de un equipo no depende de filas ajenas ni altera sus fotos',async()=>{
    const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp9sAAAAASUVORK5CYII=';
    const row={id:'synthetic-photo-equipment',cliente_id:'synthetic-client',placa_datos:image};
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('INSERT INTO em_records (entity,id,payload) VALUES (?,?,?),(?,?,?)',['Equipo',row.id,JSON.stringify(row),'Equipo','unrelated-corrupt-row','not JSON']);
      assert.deepEqual(await readEquipmentRecord(conn,row.id),row);
      assert.equal(await readEquipmentRecord(conn,'unknown-equipment'),undefined);
      assert.equal(await readEquipmentRecord(conn,"' OR 1=1 --"),undefined);
      // Synthetic incomplete records never leave this transaction.
    } finally {await conn.rollback();conn.release();}
  });
});
