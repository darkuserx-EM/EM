import mysql from 'mysql2/promise';
import { createSeed, entityNames, validateDatabase, addClientSectors } from './generated/domain.mjs';
export function connectDatabase(env) {
  for (const key of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) if (!env[key]) throw Object.assign(new Error(`Falta ${key}.`), {code:`CONFIG_${key}`});
  return mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, connectionLimit: 5, charset: 'utf8mb4', timezone: 'Z', multipleStatements: false });
}
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
  await pool.query('CREATE TABLE IF NOT EXISTS em_mfa_challenges (token_hash CHAR(64) PRIMARY KEY,user_id VARCHAR(128) NOT NULL,password_version CHAR(64) NOT NULL,expires_at BIGINT NOT NULL,attempts INT NOT NULL,INDEX(user_id),INDEX(expires_at),FOREIGN KEY(user_id) REFERENCES em_users(id) ON DELETE CASCADE) ENGINE=InnoDB');
  await pool.query('CREATE TABLE IF NOT EXISTS em_recovery_codes (user_id VARCHAR(128) NOT NULL,code_hash CHAR(64) NOT NULL,used_at BIGINT NULL,PRIMARY KEY(user_id,code_hash),FOREIGN KEY(user_id) REFERENCES em_users(id) ON DELETE CASCADE) ENGINE=InnoDB');
  for(const [name,type] of Object.entries({totp_enabled:'BOOLEAN NOT NULL DEFAULT FALSE',totp_secret:'VARCHAR(220) NULL',totp_pending:'VARCHAR(220) NULL',totp_pending_expires:'BIGINT NULL',totp_last_step:'BIGINT NULL'})) {
    const [columns]=await pool.query('SHOW COLUMNS FROM em_users LIKE ?',[name]);
    if(!columns.length)try{await pool.query('ALTER TABLE em_users ADD COLUMN '+name+' '+type);}catch(error){if(error.code!=='ER_DUP_FIELDNAME')throw error;}
  }
  const [sessionColumns] = await pool.query("SHOW COLUMNS FROM em_sessions LIKE 'last_seen_at'");
  if (!sessionColumns.length) { try { await pool.query('ALTER TABLE em_sessions ADD COLUMN last_seen_at BIGINT NULL'); } catch(error) { if(error.code!=='ER_DUP_FIELDNAME')throw error; } }
  await pool.execute('UPDATE em_sessions SET last_seen_at=? WHERE last_seen_at IS NULL',[Date.now()]);
  const [passwordColumns] = await pool.query("SHOW COLUMNS FROM em_users LIKE 'must_change_password'");
  if (!passwordColumns.length) {
    try { await pool.query('ALTER TABLE em_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE'); }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
  }
  const [userColumns] = await pool.query("SHOW COLUMNS FROM em_users LIKE 'expires_at'");
  if (!userColumns.length) {
    try { await pool.query('ALTER TABLE em_users ADD COLUMN expires_at BIGINT NULL'); }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
  }
  const [requestColumns] = await pool.query("SHOW COLUMNS FROM em_users LIKE 'creation_request'");
  if (!requestColumns.length) {
    try { await pool.query('ALTER TABLE em_users ADD COLUMN creation_request CHAR(36) NULL UNIQUE'); }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
  }
  for (const table of ['em_sessions', 'em_login_limits']) {
    const [indexes] = await pool.query(`SHOW INDEX FROM ${table} WHERE Column_name='expires_at' AND Seq_in_index=1`);
    if (!indexes.length) {
      try { await pool.query(`ALTER TABLE ${table} ADD INDEX idx_expires_at (expires_at)`); }
      catch (error) { if (error.code !== 'ER_DUP_KEYNAME') throw error; }
    }
  }
  const [eventIndexes] = await pool.query("SHOW INDEX FROM em_security_events WHERE Key_name='idx_created_id'");
  if (!eventIndexes.length) { try { await pool.query('ALTER TABLE em_security_events ADD INDEX idx_created_id (created_at,id)'); } catch(error) { if(error.code!=='ER_DUP_KEYNAME')throw error; } }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT IGNORE INTO em_meta (id, revision, schema_version) VALUES (1,0,1)');
    const [meta] = await conn.query('SELECT * FROM em_meta WHERE id=1 FOR UPDATE');
    const [count] = await conn.query('SELECT COUNT(*) AS n FROM em_records');
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
    await conn.query('UPDATE em_meta SET schema_version=GREATEST(schema_version,7) WHERE id=1');
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
export async function readDatabase(conn, lock = false) {
  const [meta] = await conn.query(`SELECT revision FROM em_meta WHERE id=1${lock ? ' FOR UPDATE' : ''}`);
  const [rows] = await conn.query('SELECT entity, payload FROM em_records ORDER BY entity,id');
  const entities = Object.fromEntries(entityNames.map(name => [name, []]));
  for (const row of rows) entities[row.entity]?.push(JSON.parse(row.payload));
  const db = { schemaVersion: 1, revision: Number(meta[0].revision), entities };
  validateDatabase(db);
  return db;
}
export async function saveDatabase(conn, db, previous) {
  validateDatabase(db);
  let batch = []; let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await conn.execute(`INSERT INTO em_records (entity,id,payload) VALUES ${batch.map(() => '(?,?,?)').join(',')} ON DUPLICATE KEY UPDATE payload=VALUES(payload)`, batch.flat());
    batch = []; bytes = 0;
  };
  for (const entity of entityNames) {
    const old = new Map((previous?.entities[entity] || []).map(row => [row.id, JSON.stringify(row)]));
    for (const row of db.entities[entity]) {
      const payload = JSON.stringify(row);
      if (old.get(row.id) !== payload) {
        if (entity === 'Bitacora') await conn.execute('INSERT INTO em_audit_index (id,entity,equipment_id,finding_id,action,created_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE entity=VALUES(entity),equipment_id=VALUES(equipment_id),finding_id=VALUES(finding_id),action=VALUES(action),created_at=VALUES(created_at)',[row.id,row.entidad||null,row.equipo_id||null,row.hallazgo_id||null,row.accion||null,row.fecha_creacion]);
        const size = Buffer.byteLength(payload) + Buffer.byteLength(row.id) + 80;
        if (batch.length && (batch.length >= 200 || bytes + size > 512 * 1024)) await flush();
        batch.push([entity, row.id, payload]); bytes += size;
      }
      old.delete(row.id);
    }
    await flush();
    const removed = [...old.keys()];
    for (let i = 0; i < removed.length; i += 200) {
      const ids = removed.slice(i, i + 200);
      if (entity === 'Bitacora') await conn.execute(`DELETE FROM em_audit_index WHERE id IN (${ids.map(() => '?').join(',')})`,ids);
      await conn.execute(`DELETE FROM em_records WHERE entity=? AND id IN (${ids.map(() => '?').join(',')})`, [entity, ...ids]);
    }
  }
  await conn.execute('UPDATE em_meta SET revision=? WHERE id=1', [db.revision]);
}
export async function readSnapshot(pool) {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const db = await readDatabase(conn); await conn.commit(); return db; }
  catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
export async function readEquipmentRecord(pool, id) {
  const [rows] = await pool.execute("SELECT payload FROM em_records WHERE entity='Equipo' AND id=?", [id]);
  if (!rows.length) return undefined;
  const row = JSON.parse(rows[0].payload);
  return row.id === id ? row : undefined;
}
export async function consumeLoginAttempt(pool, key, now = Date.now()) {
  await pool.execute('INSERT INTO em_login_limits (bucket,attempts,expires_at) VALUES (?,1,?) ON DUPLICATE KEY UPDATE attempts=IF(expires_at<?,1,attempts+1), expires_at=IF(expires_at<?,VALUES(expires_at),expires_at)', [key,now+900000,now,now]);
  const [rows] = await pool.execute('SELECT attempts FROM em_login_limits WHERE bucket=?', [key]);
  return rows[0].attempts <= 8;
}

export async function cleanupExpired(pool, now = Date.now(), { maxPasses = 20 } = {}) {
  if (!Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > 20) throw new RangeError('Invalid cleanup pass limit');
  // At most 10,000 expired rows per table per run; every batch releases its lock.
  const removed = {};
  for (const table of ['em_sessions', 'em_login_limits']) {
    removed[table] = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
      const [result] = await pool.execute(`DELETE FROM ${table} WHERE expires_at<=? LIMIT 500`, [now]);
      removed[table] += result.affectedRows;
      if (result.affectedRows < 500) break;
    }
  }
  return removed;
}
