import { select, selectQuery, change } from './sql.mjs';
import { errorCode } from './errors.mjs';
import mysql from 'mysql2/promise';
import {ensureOperationIndex,migrateOperationIndex,indexOperations,operationalEntities} from './operation-index.mjs';
import {ensureAuditStorage, migrateAuditStorage, appendAudit} from './audit-storage.mjs';
import { createSeed, entityNames, validateDatabase, addClientSectors } from './generated/domain.mjs';
/** @param {NodeJS.ProcessEnv} env */
export function connectDatabase(env) {
  for (const key of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) if (!env[key]) throw Object.assign(new Error(`Falta ${key}.`), {code:`CONFIG_${key}`});
  return mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, connectionLimit: 5, charset: 'utf8mb4', timezone: 'Z', multipleStatements: false });
}
/** @param {import("mysql2/promise").Pool} pool */
export async function migrate(pool) {
  const sql = [
    `CREATE TABLE IF NOT EXISTS em_meta (id INT PRIMARY KEY, revision BIGINT NOT NULL, schema_version INT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_records (entity VARCHAR(40) NOT NULL, id VARCHAR(128) NOT NULL, payload LONGTEXT NOT NULL, PRIMARY KEY(entity,id)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_audit_index (id VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY, entity VARCHAR(40), equipment_id VARCHAR(128), finding_id VARCHAR(128), action VARCHAR(128), created_at VARCHAR(40) COLLATE utf8mb4_bin NOT NULL, INDEX(created_at,id), INDEX(equipment_id,created_at,id), INDEX(finding_id,created_at,id), INDEX(entity,created_at,id)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_users (id VARCHAR(128) PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE, name VARCHAR(160) NOT NULL, role VARCHAR(30) NOT NULL, password_hash VARCHAR(220) NOT NULL, client_id VARCHAR(128), technician_id VARCHAR(128), active BOOLEAN NOT NULL DEFAULT TRUE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_sessions (token_hash CHAR(64) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, csrf CHAR(43) NOT NULL, expires_at BIGINT NOT NULL, INDEX(user_id), FOREIGN KEY(user_id) REFERENCES em_users(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_login_limits (bucket CHAR(64) PRIMARY KEY, attempts INT NOT NULL, expires_at BIGINT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_security_events (id VARCHAR(128) PRIMARY KEY, actor_id VARCHAR(128) NOT NULL, target_id VARCHAR(128) NOT NULL, action VARCHAR(50) NOT NULL, created_at BIGINT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_attachments (id VARCHAR(128) PRIMARY KEY, order_id VARCHAR(128) NOT NULL, request_id CHAR(36) NOT NULL UNIQUE, category VARCHAR(30) NOT NULL, name VARCHAR(160) NOT NULL, mime VARCHAR(40) NOT NULL, size INT NOT NULL, sha256 CHAR(64) NOT NULL, uploaded_by VARCHAR(128) NOT NULL, created_at BIGINT NOT NULL, content MEDIUMBLOB NOT NULL, INDEX(order_id)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_media (equipment_id VARCHAR(128) NOT NULL, field VARCHAR(30) NOT NULL, hash CHAR(64) NOT NULL, mime VARCHAR(40) NOT NULL, size INT NOT NULL, sha256 CHAR(64) NOT NULL, uploaded_by VARCHAR(128) NOT NULL, created_at BIGINT NOT NULL, content MEDIUMBLOB NOT NULL, thumbnail MEDIUMBLOB, PRIMARY KEY(equipment_id,field,hash)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_media_uploads (id CHAR(36) PRIMARY KEY, equipment_id VARCHAR(128), field VARCHAR(30) NOT NULL, hash CHAR(64) NOT NULL, mime VARCHAR(40) NOT NULL, size INT NOT NULL, sha256 CHAR(64) NOT NULL, uploaded_by VARCHAR(128) NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, content MEDIUMBLOB NOT NULL, thumbnail MEDIUMBLOB, INDEX(uploaded_by), INDEX(expires_at)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_media_migration (equipment_id VARCHAR(128) PRIMARY KEY, payload LONGTEXT NOT NULL, created_at BIGINT NOT NULL) ENGINE=InnoDB`,
  ];
  for (const statement of sql) await pool.query(statement);
  await ensureAuditStorage(pool);
  await ensureOperationIndex(pool);
  await pool.query('CREATE TABLE IF NOT EXISTS em_mfa_challenges (token_hash CHAR(64) PRIMARY KEY,user_id VARCHAR(128) NOT NULL,password_version CHAR(64) NOT NULL,expires_at BIGINT NOT NULL,attempts INT NOT NULL,INDEX(user_id),INDEX(expires_at),FOREIGN KEY(user_id) REFERENCES em_users(id) ON DELETE CASCADE) ENGINE=InnoDB');
  await pool.query('CREATE TABLE IF NOT EXISTS em_recovery_codes (user_id VARCHAR(128) NOT NULL,code_hash CHAR(64) NOT NULL,used_at BIGINT NULL,PRIMARY KEY(user_id,code_hash),FOREIGN KEY(user_id) REFERENCES em_users(id) ON DELETE CASCADE) ENGINE=InnoDB');
  for(const [name,type] of Object.entries({totp_enabled:'BOOLEAN NOT NULL DEFAULT FALSE',totp_secret:'VARCHAR(220) NULL',totp_pending:'VARCHAR(220) NULL',totp_pending_expires:'BIGINT NULL',totp_last_step:'BIGINT NULL'})) {
    /** @type {{Field:string}[]} */
  const columns = await selectQuery(pool,'SHOW COLUMNS FROM em_users LIKE ?',[name]);
    if(!columns.length)try{await pool.query('ALTER TABLE em_users ADD COLUMN '+name+' '+type);}catch(error){if(errorCode(error)!=='ER_DUP_FIELDNAME')throw error;}
  }
  /** @type {{Field:string}[]} */
  const sessionColumns = await selectQuery(pool,"SHOW COLUMNS FROM em_sessions LIKE 'last_seen_at'");
  if (!sessionColumns.length) { try { await pool.query('ALTER TABLE em_sessions ADD COLUMN last_seen_at BIGINT NULL'); } catch(error) { if(errorCode(error)!=='ER_DUP_FIELDNAME')throw error; } }
  await pool.execute('UPDATE em_sessions SET last_seen_at=? WHERE last_seen_at IS NULL',[Date.now()]);
  /** @type {{Field:string}[]} */
  const passwordColumns = await selectQuery(pool,"SHOW COLUMNS FROM em_users LIKE 'must_change_password'");
  if (!passwordColumns.length) {
    try { await pool.query('ALTER TABLE em_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE'); }
    catch (error) { if (errorCode(error) !== 'ER_DUP_FIELDNAME') throw error; }
  }
  /** @type {{Field:string}[]} */
  const userColumns = await selectQuery(pool,"SHOW COLUMNS FROM em_users LIKE 'expires_at'");
  if (!userColumns.length) {
    try { await pool.query('ALTER TABLE em_users ADD COLUMN expires_at BIGINT NULL'); }
    catch (error) { if (errorCode(error) !== 'ER_DUP_FIELDNAME') throw error; }
  }
  /** @type {{Field:string}[]} */
  const requestColumns = await selectQuery(pool,"SHOW COLUMNS FROM em_users LIKE 'creation_request'");
  if (!requestColumns.length) {
    try { await pool.query('ALTER TABLE em_users ADD COLUMN creation_request CHAR(36) NULL UNIQUE'); }
    catch (error) { if (errorCode(error) !== 'ER_DUP_FIELDNAME') throw error; }
  }
  for (const table of ['em_sessions', 'em_login_limits']) {
    /** @type {{Key_name:string}[]} */
  const indexes = await selectQuery(pool,`SHOW INDEX FROM ${table} WHERE Column_name='expires_at' AND Seq_in_index=1`);
    if (!indexes.length) {
      try { await pool.query(`ALTER TABLE ${table} ADD INDEX idx_expires_at (expires_at)`); }
      catch (error) { if (errorCode(error) !== 'ER_DUP_KEYNAME') throw error; }
    }
  }
  /** @type {{Key_name:string}[]} */
  const eventIndexes = await selectQuery(pool,"SHOW INDEX FROM em_security_events WHERE Key_name='idx_created_id'");
  if (!eventIndexes.length) { try { await pool.query('ALTER TABLE em_security_events ADD INDEX idx_created_id (created_at,id)'); } catch(error) { if(errorCode(error)!=='ER_DUP_KEYNAME')throw error; } }
  for(const [name,columns] of [['idx_attachment_order_created','order_id,created_at,id'],['idx_attachment_created','created_at,id']]) {
    /** @type {{Key_name:string}[]} */
  const indexes = await selectQuery(pool,'SHOW INDEX FROM em_attachments WHERE Key_name=?',[name]);
    if(!indexes.length)try{await pool.query('ALTER TABLE em_attachments ADD INDEX '+name+' ('+columns+')');}catch(error){if(errorCode(error)!=='ER_DUP_KEYNAME')throw error;}
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT IGNORE INTO em_meta (id, revision, schema_version) VALUES (1,0,1)');
    /** @type {{revision:number,schema_version:number}[]} */
  const meta = await selectQuery(conn,'SELECT * FROM em_meta WHERE id=1 FOR UPDATE');
    /** @type {{n:number}[]} */
  const count = await selectQuery(conn,'SELECT COUNT(*) AS n FROM em_records');
    if (Number(count[0].n) === 0 && Number(meta[0].revision) === 0) {
      const db = createSeed();
      for (const name of entityNames) if (name !== 'Catalogos') db.entities[name] = [];
      db.revision = 1;
      await saveDatabase(conn, db);
    }
    if (Number(meta[0].schema_version) < 2) {
      const previous = await readDatabase(conn);
      const next = structuredClone(previous);
      if (addClientSectors(next)) { next.revision++; await saveDatabase(conn,next,previous); }
      await conn.execute('UPDATE em_meta SET schema_version=2 WHERE id=1');
    }
    if (Number(meta[0].schema_version) < 5) {
      await conn.query("INSERT INTO em_audit_index (id,entity,equipment_id,finding_id,action,created_at) SELECT id,JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entidad')),NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.equipo_id')),'null'),NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.hallazgo_id')),'null'),JSON_UNQUOTE(JSON_EXTRACT(payload,'$.accion')),JSON_UNQUOTE(JSON_EXTRACT(payload,'$.fecha_creacion')) FROM em_records WHERE entity='Bitacora' ON DUPLICATE KEY UPDATE entity=VALUES(entity),equipment_id=VALUES(equipment_id),finding_id=VALUES(finding_id),action=VALUES(action),created_at=VALUES(created_at)");
    }
    await conn.query('UPDATE em_meta SET schema_version=GREATEST(schema_version,8) WHERE id=1');
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  await migrateAuditStorage(pool);
  await migrateOperationIndex(pool);
}
/** @param {import("./contracts.js").SqlConnection} conn @param {boolean} [lock] @param {{includeAudit?:boolean}} [options] */
export async function readDatabase(conn, lock = false, {includeAudit=true}={}) {
  /** @type {{revision:number,schema_version:number}[]} */
  const meta = await selectQuery(conn,`SELECT revision FROM em_meta WHERE id=1${lock ? ' FOR UPDATE' : ''}`);
  /** @type {{entity:import("../src/domain/model.js").EntityName,payload:string}[]} */
  const rows = await selectQuery(conn,`SELECT entity, payload FROM em_records${includeAudit?'':" WHERE entity<>'Bitacora'"} ORDER BY entity,id`);
  /** @type {import("../src/domain/model.js").Database["entities"]} */
  const entities = {Cliente:[],Contacto:[],Sede:[],Contrato:[],ContratoEquipo:[],Equipo:[],LecturaHorometro:[],PlanPM:[],Hallazgo:[],Ticket:[],OrdenServicio:[],OTRepuesto:[],OTHoras:[],CheckList:[],CheckListItem:[],Tecnico:[],Gasto:[],Liquidacion:[],Usuario:[],Catalogos:[],Bitacora:[]};
  for (const row of rows) entities[row.entity]?.push(JSON.parse(row.payload));
  if(includeAudit) {
    /** @type {{payload:string}[]} */
  const audit = await selectQuery(conn,'SELECT payload FROM em_audit_log ORDER BY id');
    for(const row of audit)entities.Bitacora.push(JSON.parse(row.payload));
    entities.Bitacora.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  }
  const db = { schemaVersion: 1, revision: Number(meta[0].revision), entities };
  validateDatabase(db);
  return db;
}
// Plan and validate differences before taking a commit lock. Serialized payloads
// are captured so an asynchronous writer cannot observe later object mutations.
/** @param {import("../src/domain/model.js").Database} db @param {import("../src/domain/model.js").Database} [previous] @param {{validate?:(value:unknown)=>void}} [options] */
export function prepareDatabaseWrite(db,previous,{validate=validateDatabase}={}) {
  validate(db);
  /** @type {import("./contracts.js").WriteCommand[]} */
  const commands=[];
  /** @type {[import("../src/domain/model.js").EntityName,string,string][]} */
  let batch=[];let bytes=0;
  const flush=()=>{if(batch.length)commands.push({kind:'upsert',rows:batch});batch=[];bytes=0;};
  for(const entity of entityNames) {
    const old=new Map((previous?.entities[entity]||[]).map(row=>[row.id,JSON.stringify(row)]));
    if(entity==='Bitacora') {
      const entries=db.entities.Bitacora.filter(row=>old.get(row.id)!==JSON.stringify(row)).map(row=>({id:row.id,payload:JSON.stringify(row)}));
      if(entries.length)commands.push({kind:'audit',entries});continue;
    }
    for(const row of db.entities[entity]) {
      const payload=JSON.stringify(row);
      if(old.get(row.id)!==payload) {
        const size=Buffer.byteLength(payload)+Buffer.byteLength(row.id)+80;
        if(batch.length&&(batch.length>=200||bytes+size>512*1024))flush();
        batch.push([entity,row.id,payload]);bytes+=size;
      }
      old.delete(row.id);
    }
    flush();const removed=[...old.keys()];for(let i=0;i<removed.length;i+=200)commands.push({kind:'remove',entity,ids:removed.slice(i,i+200)});
  }
  const revision=db.revision;
  /** @param {import("mysql2/promise").PoolConnection} conn */
  return async conn=>{
    for(const command of commands) {
      if(command.kind==='audit')await appendAudit(conn,command.entries);
      else if(command.kind==='upsert') {
        await conn.execute('INSERT INTO em_records (entity,id,payload) VALUES '+command.rows.map(()=>'(?,?,?)').join(',')+' ON DUPLICATE KEY UPDATE payload=VALUES(payload)',command.rows.flat());
        await indexOperations(conn,command.rows.filter(([entity])=>operationalEntities.includes(entity)).map(([entity,,payload])=>({entity,row:JSON.parse(payload)})));
      } else {
        const args=[command.entity,...command.ids],where='entity=? AND id IN ('+command.ids.map(()=>'?').join(',')+')';
        await conn.execute('DELETE FROM em_records WHERE '+where,args);
        if(operationalEntities.includes(command.entity))await conn.execute('DELETE FROM em_operation_index WHERE '+where,args);
      }
    }
    await conn.execute('UPDATE em_meta SET revision=? WHERE id=1',[revision]);
  };
}
/** @param {import("mysql2/promise").PoolConnection} conn @param {import("../src/domain/model.js").Database} db @param {import("../src/domain/model.js").Database} [previous] @param {{validate?:(value:unknown)=>void}} [options] */
export async function saveDatabase(conn,db,previous,options) {await prepareDatabaseWrite(db,previous,options)(conn);}
/** @param {import("mysql2/promise").Pool} pool @param {{includeAudit?:boolean}} [options] */
export async function readSnapshot(pool, options) {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const db = await readDatabase(conn,false,options); await conn.commit(); return db; }
  catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
/** @param {import("./contracts.js").SqlConnection} pool @param {string} id */
export async function readEquipmentRecord(pool, id) {
  /** @type {{payload:string}[]} */
  const rows = await select(pool,"SELECT payload FROM em_records WHERE entity='Equipo' AND id=?", [id]);
  if (!rows.length) return undefined;
  /** @type {import("../src/domain/model.js").EntityRecord} */
  const row = JSON.parse(rows[0].payload);
  return row.id === id ? row : undefined;
}
/** @param {import("./contracts.js").SqlConnection} pool @param {string} key */
export async function consumeLoginAttempt(pool, key, now = Date.now()) {
  await pool.execute('INSERT INTO em_login_limits (bucket,attempts,expires_at) VALUES (?,1,?) ON DUPLICATE KEY UPDATE attempts=IF(expires_at<?,1,attempts+1), expires_at=IF(expires_at<?,VALUES(expires_at),expires_at)', [key,now+900000,now,now]);
  /** @type {{attempts:number}[]} */
  const rows = await select(pool,'SELECT attempts FROM em_login_limits WHERE bucket=?', [key]);
  return rows[0].attempts <= 8;
}

/** @param {import("mysql2/promise").Pool} pool @param {number} [now] @param {{maxPasses?:number}} [options] */
export async function cleanupExpired(pool, now = Date.now(), { maxPasses = 20 } = {}) {
  if (!Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > 20) throw new RangeError('Invalid cleanup pass limit');
  // At most 10,000 expired rows per table per run; every batch releases its lock.
  /** @type {Record<string,number>} */
  const removed = {};
  for (const table of ['em_sessions', 'em_login_limits']) {
    removed[table] = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
      const result = await change(pool,`DELETE FROM ${table} WHERE expires_at<=? LIMIT 500`, [now]);
      removed[table] += result.affectedRows;
      if (result.affectedRows < 500) break;
    }
  }
  return removed;
}
