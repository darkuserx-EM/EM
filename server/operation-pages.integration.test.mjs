import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import {migrate,readSnapshot,saveDatabase} from './database.mjs';
import {migrateOperationIndex,indexOperations} from './operation-index.mjs';
import {operationPage} from './operation-pages.mjs';
import {createSeed,filterVisible} from './generated/domain.mjs';
import {createApp} from './app.mjs';
import {digest,token} from './security.mjs';

test('Páginas operativas: índices, roles, migración y revisión consistente',{skip:process.env.MYSQL_INTEGRATION!=='1',timeout:180000},async t=>{
  const host=process.env.TEST_DB_HOST||'127.0.0.1';assert.ok(['127.0.0.1','localhost','::1'].includes(host));
  const config={host,port:Number(process.env.TEST_DB_PORT||3306),user:process.env.TEST_DB_USER||'root',password:process.env.TEST_DB_PASSWORD};assert.ok(config.password);
  const name='em_ci_'+randomUUID().replaceAll('-',''),control=await mysql.createConnection(config);await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
  const pool=mysql.createPool({...config,database:name,connectionLimit:5});let server;
  t.after(async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await pool.end();assert.match(name,/^em_ci_[a-f0-9]{32}$/);await control.query(`DROP DATABASE ${name}`);await control.end();});
  await migrate(pool);const seed=createSeed();seed.revision=3;
  const admin={id:'qa',nombre:'QA',rol:'Administrador'},client={...admin,id:'client-qa',rol:'Cliente',cliente_id:'client-1'},tech={...admin,id:'tech-qa',rol:'Técnico',tecnico_id:'tech-1'};
  const template=seed.entities.OrdenServicio[0];
  // Legacy services have no operational state constraints; their full original payload remains intact.
  seed.entities.OrdenServicio.push(...Array.from({length:10001},(_,i)=>({...template,id:'paged-'+String(i).padStart(6,'0'),codigo:'OS-P'+i,fecha:'2026-10-01T12:00:00.000Z',orden_origen:'PRIVATE-ORIGIN-'+i,diagnostico:'Revisión hidráulica '+i,costo_mano_obra:i,visible_cliente:i%2===0})));
  seed.entities.Ticket.push({...template,id:'ticket-paged',codigo:'TKT-1',titulo:'Solicitud sintética',descripcion:'No funciona',estado:'Nuevo',prioridad:'Media',fecha:'2026-10-01',schema_operacion:1,solicitud_id:randomUUID(),solicitud_datos:'qa'});
  const conn=await pool.getConnection();try{await conn.beginTransaction();const before=await readSnapshot(pool);await saveDatabase(conn,seed,before);await conn.commit();}finally{conn.release();}
  await t.test('migración interrumpida y reanudada no cambia ningún registro original',async()=>{
    const fingerprint=async()=>{const [rows]=await pool.query('SELECT entity,id,payload FROM em_records ORDER BY entity,id');return createHash('sha256').update(JSON.stringify(rows)).digest('hex');};
    const before=await fingerprint();await pool.query('DELETE FROM em_operation_index');await pool.query('UPDATE em_meta SET schema_version=9 WHERE id=1');
    await assert.rejects(migrateOperationIndex(pool,{afterBatch:()=>{throw Error('interrupt synthetic');}}),/interrupt/);
    await migrateOperationIndex(pool);await migrateOperationIndex(pool);assert.equal(await fingerprint(),before);
    const [missing]=await pool.query("SELECT COUNT(*) n FROM em_records r LEFT JOIN em_operation_index o ON o.entity=r.entity AND o.id=r.id WHERE r.entity IN ('Ticket','OrdenServicio','LecturaHorometro') AND o.id IS NULL");assert.equal(Number(missing[0].n),0);
  });
  await t.test('10,001 fechas empatadas recorren páginas sin repeticiones ni omisiones',async()=>{
    const ids=[];let total;
    for(let page=1;page<=51;page++){const result=await operationPage(pool,admin,'OrdenServicio',{search:'Revisión hidráulica',page,pageSize:200},3);total=result.total;assert.ok(result.rows.length<=200);ids.push(...result.rows.map(row=>row.id));}
    assert.equal(total,10001);assert.equal(ids.length,10001);assert.equal(new Set(ids).size,10001);assert.deepEqual(ids,[...ids].sort().reverse());
    const [plan]=await pool.execute("EXPLAIN SELECT id FROM em_operation_index WHERE entity='OrdenServicio' AND equipment_id=? ORDER BY sort_value DESC,id DESC LIMIT 25",['equipment-2']);t.diagnostic(JSON.stringify({operationPlan:plan.map(({type,key,rows,Extra})=>({type,key,rows,Extra}))}));assert.ok(plan.some(row=>row.key==='idx_operation_equipment'));assert.ok(plan.every(row=>!/filesort/i.test(row.Extra||'')));
  });
  await t.test('páginas, contadores y detalle respetan los mismos permisos que la base completa',async()=>{
    for(const actor of [admin,{...admin,rol:'Coordinador'},client,tech,{...client,cliente_id:'absent'},{...tech,tecnico_id:'absent'}])for(const entity of ['Ticket','OrdenServicio','LecturaHorometro']){
      const expected=filterVisible(actor,entity,seed.entities[entity],seed.entities),result=await operationPage(pool,actor,entity,{pageSize:7},3);
      assert.equal(result.total,expected.length);assert.equal(result.counts.total,expected.length);assert.ok(result.rows.length<=7);
      const expectedById=new Map(expected.map(row=>[row.id,row]));for(const row of result.rows)assert.deepEqual(row,expectedById.get(row.id));
      const hidden=seed.entities[entity].find(row=>!expectedById.has(row.id));if(hidden)assert.equal((await operationPage(pool,actor,entity,{id:hidden.id},3)).total,0);
    }
    assert.equal((await operationPage(pool,client,'OrdenServicio',{search:'PRIVATE-ORIGIN'},3)).total,0);
    assert.equal((await operationPage(pool,tech,'OrdenServicio',{search:'PRIVATE-ORIGIN'},3)).total,0);
    const searched=await operationPage(pool,client,'OrdenServicio',{search:'HIDRÁULICA',from:'2026-10-01',to:'2026-10-01'},3);assert.equal(searched.total,5001);
    assert.equal((await operationPage(pool,admin,'OrdenServicio',{search:"%' OR 1=1 --"},3)).total,0);
    await assert.rejects(operationPage(pool,admin,'OrdenServicio',{pageSize:201},3),{status:400});await assert.rejects(operationPage(pool,admin,'OrdenServicio',{from:'2026-02-30'},3),{status:400});
  });
  await t.test('la proyección se revierte junto con los datos si falla el guardado',async()=>{
    const connection=await pool.getConnection();try{await connection.beginTransaction();await indexOperations(connection,[{entity:'OrdenServicio',row:{...seed.entities.OrdenServicio.find(row=>row.id==='paged-000000'),visible_cliente:false}}]);await connection.rollback();}finally{connection.release();}
    const result=await operationPage(pool,client,'OrdenServicio',{id:'paged-000000'},3);assert.equal(result.total,1);
  });
  await t.test('API ligera compatible, autenticación y cambio de revisión entre páginas',async()=>{
    const session=token(),csrf=token();await pool.execute('INSERT INTO em_users (id,email,name,role,password_hash,active) VALUES (?,?,?,?,?,TRUE)',[admin.id,'qa@example.invalid',admin.nombre,admin.rol,'synthetic-unusable']);await pool.execute('INSERT INTO em_sessions (token_hash,user_id,csrf,expires_at,last_seen_at) VALUES (?,?,?,?,?)',[digest(session),admin.id,csrf,Date.now()+60000,Date.now()]);
    server=createApp({pool,origin:'http://localhost:3000',setupToken:token(),production:false}).listen(0,'127.0.0.1');await once(server,'listening');const root=`http://127.0.0.1:${server.address().port}/api/`;
    const get=path=>fetch(root+path,{headers:{Cookie:'em_session='+session}});
    assert.equal((await fetch(root+'operations/OrdenServicio')).status,401);
    const response=await get('database?paged=1');assert.equal(response.status,200);const compact=await response.json();assert.equal(compact.entities.OrdenServicio.length,0);assert.equal(compact.counts.OrdenServicio,seed.entities.OrdenServicio.length);
    assert.equal((await (await get('database')).json()).entities.OrdenServicio.length,seed.entities.OrdenServicio.length);
    let result=await get('operations/OrdenServicio?page=1&token='+compact.syncToken);assert.equal(result.status,200);assert.equal((await result.json()).rows.length,25);
    await pool.query('UPDATE em_meta SET revision=revision+1 WHERE id=1');result=await get('operations/OrdenServicio?page=2&token='+compact.syncToken);assert.equal(result.status,409);
  });
});

