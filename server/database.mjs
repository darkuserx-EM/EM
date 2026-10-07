import mysql from 'mysql2/promise';
import { createSeed, entityNames, validateDatabase, addClientSectors } from './generated/domain.mjs';
export function connectDatabase(env) {
  for (const key of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) if (!env[key]) throw new Error(`Falta ${key}.`);
  return mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, connectionLimit: 5, charset: 'utf8mb4', timezone: 'Z', multipleStatements: false });
}
export async function migrate(pool) {
  const sql = [
    `CREATE TABLE IF NOT EXISTS em_meta (id INT PRIMARY KEY, revision BIGINT NOT NULL, schema_version INT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_records (entity VARCHAR(40) NOT NULL, id VARCHAR(128) NOT NULL, payload LONGTEXT NOT NULL, PRIMARY KEY(entity,id)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_users (id VARCHAR(128) PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE, name VARCHAR(160) NOT NULL, role VARCHAR(30) NOT NULL, password_hash VARCHAR(220) NOT NULL, client_id VARCHAR(128), technician_id VARCHAR(128), active BOOLEAN NOT NULL DEFAULT TRUE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_sessions (token_hash CHAR(64) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, csrf CHAR(43) NOT NULL, expires_at BIGINT NOT NULL, INDEX(user_id), FOREIGN KEY(user_id) REFERENCES em_users(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS em_login_limits (bucket CHAR(64) PRIMARY KEY, attempts INT NOT NULL, expires_at BIGINT NOT NULL) ENGINE=InnoDB`,
  ];
  for (const statement of sql) await pool.query(statement);
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
  for (const entity of entityNames) {
    const old = new Map((previous?.entities[entity] || []).map(row => [row.id, JSON.stringify(row)]));
    for (const row of db.entities[entity]) {
      const payload = JSON.stringify(row);
      if (old.get(row.id) !== payload) await conn.execute('INSERT INTO em_records (entity,id,payload) VALUES (?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)', [entity,row.id,payload]);
      old.delete(row.id);
    }
    for (const id of old.keys()) await conn.execute('DELETE FROM em_records WHERE entity=? AND id=?', [entity,id]);
  }
  await conn.execute('UPDATE em_meta SET revision=? WHERE id=1', [db.revision]);
}
export async function readSnapshot(pool) {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const db = await readDatabase(conn); await conn.commit(); return db; }
  catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
export async function consumeLoginAttempt(pool, key, now = Date.now()) {
  await pool.execute('INSERT INTO em_login_limits (bucket,attempts,expires_at) VALUES (?,1,?) ON DUPLICATE KEY UPDATE attempts=IF(expires_at<?,1,attempts+1), expires_at=IF(expires_at<?,VALUES(expires_at),expires_at)', [key,now+900000,now,now]);
  const [rows] = await pool.execute('SELECT attempts FROM em_login_limits WHERE bucket=?', [key]);
  return rows[0].attempts <= 8;
}
