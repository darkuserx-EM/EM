import { select, selectQuery } from './sql.mjs';
// The audit is append-only. Call writers inside the same transaction and lock
// order as the business write; never replace a live event during restoration.
const columns = 'id,entity,equipment_id,finding_id,action,created_at,payload';
const conflict = () => Object.assign(new Error('An existing audit event differs'), {code:'AUDIT_IDENTITY_CONFLICT'});
/** @param {import('mysql2/promise').Pool} pool */
export async function ensureAuditStorage(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS em_audit_log (
    id VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY, entity VARCHAR(40),
    equipment_id VARCHAR(128), finding_id VARCHAR(128), action VARCHAR(128),
    created_at VARCHAR(40) COLLATE utf8mb4_bin NOT NULL, payload LONGTEXT NOT NULL,
    INDEX(created_at,id), INDEX(entity,created_at,id),
    INDEX(equipment_id,created_at,id), INDEX(finding_id,created_at,id)
  ) ENGINE=InnoDB`);
  await pool.query('CREATE TABLE IF NOT EXISTS em_audit_state (id INT PRIMARY KEY,last_sequence BIGINT NOT NULL) ENGINE=InnoDB');
  await pool.query('INSERT IGNORE INTO em_audit_state (id,last_sequence) VALUES (1,0)');
}
/** @param {import('mysql2/promise').PoolConnection} conn @param {import('./contracts.js').StoredPayload[]} entries */
export async function appendAudit(conn, entries) {
  // Small batches also bound the parameter packet when a backup is restored.
  for (let offset=0; offset<entries.length; offset+=100) {
    const batch=entries.slice(offset,offset+100);
    /** @type {import('./contracts.js').StoredPayload[]} */
    const existing=await select(conn,`SELECT id,payload FROM em_audit_log WHERE id IN (${batch.map(()=>'?').join(',')})`,batch.map(row=>row.id));
    const known=new Map(existing.map(row=>[row.id,row.payload]));
    const fresh=[]; let sequence=0;
    for(const entry of batch) {
      /** @type {import('./contracts.js').AuditPayload} */
      const row=JSON.parse(entry.payload);
      if(row.id!==entry.id)throw conflict();
      if(known.has(entry.id)) { if(known.get(entry.id)!==entry.payload)throw conflict(); }
      else { fresh.push([row.id,row.entidad||null,row.equipo_id||null,row.hallazgo_id||null,row.accion||null,row.fecha_creacion,entry.payload]); known.set(entry.id,entry.payload); }
      const serial=Number(row.codigo.startsWith('LOG-') ? /-(\d+)$/.exec(row.codigo)?.[1]||0 : 0);
      if(!Number.isSafeInteger(serial))throw conflict();
      sequence=Math.max(sequence,serial);
    }
    if(fresh.length)await conn.execute(`INSERT INTO em_audit_log (${columns}) VALUES ${fresh.map(()=>'(?,?,?,?,?,?,?)').join(',')}`,fresh.flat());
    await conn.execute('UPDATE em_audit_state SET last_sequence=GREATEST(last_sequence,?) WHERE id=1',[sequence]);
  }
}
/** @param {import('./contracts.js').SqlConnection} conn */
export async function auditSequence(conn) {
  /** @type {{last_sequence: number | string}[]} */
  const rows=await selectQuery(conn,'SELECT last_sequence FROM em_audit_state WHERE id=1');
  const sequence=Number(rows[0].last_sequence);
  if(!Number.isSafeInteger(sequence)||sequence<0)throw conflict();
  return sequence;
}
/** @param {import('mysql2/promise').Pool} pool @param {{batchSize?:number,afterBatch?:(progress:{moved:number})=>void|Promise<void>}} [options] */
export async function migrateAuditStorage(pool,{batchSize=200,afterBatch}={}) {
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>500)throw new RangeError('Invalid audit migration batch');
  let moved=0;
  for(;;) {
    const conn=await pool.getConnection(); let count=0;
    try {
      await conn.beginTransaction();
      await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE');
      /** @type {import('./contracts.js').StoredPayload[]} */
      const rows=await selectQuery(conn,`SELECT id,payload FROM em_records WHERE entity='Bitacora' ORDER BY id LIMIT ${batchSize}`);
      count=rows.length;
      if(count) {
        await appendAudit(conn,rows);
        // Compare exact original payloads before removing their old location.
        /** @type {import('./contracts.js').StoredPayload[]} */
        const copies=await select(conn,`SELECT id,payload FROM em_audit_log WHERE id IN (${rows.map(()=>'?').join(',')})`,rows.map(row=>row.id));
        const copied=new Map(copies.map(row=>[row.id,row.payload]));
        if(rows.some(row=>copied.get(row.id)!==row.payload))throw conflict();
        await conn.execute(`DELETE FROM em_records WHERE entity='Bitacora' AND id IN (${rows.map(()=>'?').join(',')})`,rows.map(row=>row.id));
      }
      await conn.commit();
    } catch(error) { await conn.rollback(); throw error; } finally { conn.release(); }
    moved+=count;
    if(!count)break;
    if(afterBatch)await afterBatch({moved});
  }
  await pool.query('UPDATE em_meta SET schema_version=GREATEST(schema_version,9) WHERE id=1');
  return {moved};
}
