import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrate,readDatabase,readSnapshot,saveDatabase} from './database.mjs';
import {migrateAuditStorage,auditSequence,appendAudit} from './audit-storage.mjs';
import {fullBackupEntries} from './full-backup.mjs';
import {LocalDataSource,STORAGE_KEY} from './generated/domain.mjs';

test('Bitácora independiente: migración reanudable, 25,000 movimientos y recuperación',{skip:process.env.MYSQL_INTEGRATION!=='1',timeout:180000},async t=>{
  const host=process.env.TEST_DB_HOST||'127.0.0.1';assert.ok(['127.0.0.1','localhost','::1'].includes(host));
  const config={host,port:Number(process.env.TEST_DB_PORT||3306),user:process.env.TEST_DB_USER||'root',password:process.env.TEST_DB_PASSWORD};assert.ok(config.password);
  const name='em_ci_'+randomUUID().replaceAll('-',''),control=await mysql.createConnection(config);await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
  const pool=mysql.createPool({...config,database:name});
  t.after(async()=>{await pool.end();assert.match(name,/^em_ci_[a-f0-9]{32}$/);await control.query(`DROP DATABASE ${name}`);await control.end();});
  await migrate(pool);
  const actor={id:'qa',nombre:'QA sintético',rol:'Administrador'},at='2026-10-01T12:00:00.000Z';
  const entries=Array.from({length:25000},(_,i)=>{const id='audit-'+String(i).padStart(6,'0');return {id,payload:JSON.stringify({id,codigo:'LOG-'+(i+1),creado_por:actor.id,actualizado_por:actor.id,fecha_creacion:at,fecha_actualizacion:at,entidad:'Equipo',accion:'Prueba',detalle:'Historial sintético '+i,equipo_id:'equipo-'+i%100})};});
  for(let i=0;i<entries.length;i+=500)await pool.query('INSERT INTO em_records (entity,id,payload) VALUES ?',[entries.slice(i,i+500).map(row=>['Bitacora',row.id,row.payload])]);
  const fingerprint=rows=>createHash('sha256').update(rows.map(row=>row.payload).join('\n')).digest('hex');
  await t.test('interrupción conserva lotes completos; reanudar compara payloads byte a byte',async()=>{
    await assert.rejects(migrateAuditStorage(pool,{batchSize:200,afterBatch:()=>{throw Error('interrupción sintética');}}),/interrupción/);
    const [count]=await pool.query('SELECT COUNT(*) AS n FROM em_audit_log');assert.equal(Number(count[0].n),200);
    const [remaining]=await pool.query("SELECT COUNT(*) AS n FROM em_records WHERE entity='Bitacora'");assert.equal(Number(remaining[0].n),24800);
    assert.equal((await migrateAuditStorage(pool)).moved,24800);assert.equal((await migrateAuditStorage(pool)).moved,0);
    const [moved]=await pool.query('SELECT id,payload FROM em_audit_log ORDER BY id');assert.equal(fingerprint(moved),fingerprint(entries));
    assert.equal(await auditSequence(pool),25000);
    const [plan]=await pool.execute('EXPLAIN SELECT payload FROM em_audit_log WHERE equipment_id=? ORDER BY created_at DESC,id DESC LIMIT 51',['equipo-1']);
    assert.ok(plan.some(row=>row.key==='equipment_id'));assert.ok(plan.every(row=>!/filesort/i.test(row.Extra||'')));
  });
  await t.test('identidad existente diferente detiene la migración sin borrar el original',async()=>{
    const entry={...entries[0],payload:entries[0].payload.replace('Historial sintético 0','Intento de sustituir')};
    await pool.execute("INSERT INTO em_records (entity,id,payload) VALUES ('Bitacora',?,?)",[entry.id,entry.payload]);
    await assert.rejects(migrateAuditStorage(pool),{code:'AUDIT_IDENTITY_CONFLICT'});
    const [left]=await pool.execute("SELECT payload FROM em_records WHERE entity='Bitacora' AND id=?",[entry.id]);assert.equal(left[0].payload,entry.payload);
    await pool.execute("DELETE FROM em_records WHERE entity='Bitacora' AND id=?",[entry.id]);
  });
  await t.test('escritura normal no consulta ni valida los 25,000 movimientos',async()=>{
    const conn=await pool.getConnection(),statements=[];
    const instrumented=new Proxy(conn,{get(target,key){const value=target[key];return ['query','execute'].includes(key)?(...args)=>{statements.push(args[0]);return value.apply(target,args);}:typeof value==='function'?value.bind(target):value;}});
    try{
      await conn.beginTransaction();const before=await readDatabase(instrumented,true,{includeAudit:false});assert.equal(before.entities.Bitacora.length,0);
      let saved=JSON.stringify(before);const source=new LocalDataSource({getItem:key=>key===STORAGE_KEY?saved:null,setItem:(_k,value)=>{saved=value;}},{demoHistory:false,maxRows:Infinity,auditSequence:await auditSequence(conn)});
      await source.repository('Cliente',actor).create({nombre:'Cliente sintético',estado:'Activo'});
      const next=JSON.parse(saved);assert.equal(next.entities.Bitacora[0].codigo,'LOG-25001');await saveDatabase(instrumented,next,before);await conn.commit();
      assert.ok(statements.every(sql=>!sql.includes('SELECT payload FROM em_audit_log')));
      assert.ok(statements.some(sql=>sql.includes("WHERE entity<>'Bitacora'")));
    }finally{conn.release();}
    assert.equal((await readSnapshot(pool)).entities.Bitacora.length,25001);
  });
  await t.test('respaldo completo incluye el historial y restaurar conserva auditoría viva',async()=>{
    const conn=await pool.getConnection();const archive=[];
    try{await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await conn.beginTransaction();for await(const entry of fullBackupEntries(conn))if(entry.type==='record'&&entry.entity==='Bitacora')archive.push(entry.record);await conn.commit();}finally{conn.release();}
    assert.equal(archive.length,25001);
    const before=await readSnapshot(pool);let saved=JSON.stringify(before);
    const source=new LocalDataSource({getItem:()=>saved,setItem:(_k,value)=>{saved=value;}},{demoHistory:false,maxRows:Infinity});
    const candidate=structuredClone(before);candidate.entities.Bitacora=[];
    source.restore(actor,candidate,before.revision,at);
    const conn2=await pool.getConnection();try{await conn2.beginTransaction();await saveDatabase(conn2,JSON.parse(saved),before);await conn2.commit();}finally{conn2.release();}
    const after=await readSnapshot(pool);assert.equal(after.entities.Bitacora.length,25002);const byId=new Map(after.entities.Bitacora.map(row=>[row.id,row]));for(const row of before.entities.Bitacora)assert.deepEqual(byId.get(row.id),row);
    const conn3=await pool.getConnection();try{await conn3.beginTransaction();await assert.rejects(appendAudit(conn3,[{id:archive[0].id,payload:JSON.stringify({...archive[0],detalle:'Alterado'})}]),{code:'AUDIT_IDENTITY_CONFLICT'});await conn3.rollback();}finally{conn3.release();}
  });
});
