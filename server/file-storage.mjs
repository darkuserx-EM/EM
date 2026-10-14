import { createHash } from 'node:crypto';
import { select, selectQuery } from './sql.mjs';
import { createDriveStorage, DriveStorageError } from './drive-storage.mjs';
import {createFolderOrganizer} from './drive-folders.mjs';

/** @typedef {{content:Buffer,storage_key?:string|null,sha256?:string,size?:number}} StoredBytes */
/** @typedef {{sha256:string,file_id:string,mime:string,size:number,ready:number}} BlobRow */
/** @typedef {{enabled:boolean,video?:{start:(sha:string,size:number)=>Promise<{fileId:string,location:string,offset:number}>,progress:(id:string,location:string,size:number,sha:string)=>Promise<number>,chunk:(location:string,offset:number,size:number,bytes:Buffer)=>Promise<number>,get:(id:string,size:number,sha:string)=>Promise<Buffer>},range?:(conn:import('./contracts.js').SqlConnection,file:StoredBytes,start:number,end:number)=>Promise<Buffer>,organize?:()=>Promise<number>,prepare:(bytes:Buffer,mime:string)=>Promise<{content:Buffer,storage_key:string|null}>,read:(conn:import('./contracts.js').SqlConnection,file:StoredBytes)=>Promise<Buffer>}} FileStore */
/** @type {FileStore} */
export const localFiles = {
  enabled:false,
  prepare:async content => ({content,storage_key:null}),
  read:async (_conn,file) => {
    if (file.storage_key) throw new DriveStorageError('DRIVE_NOT_CONFIGURED','Vuelve a conectar Google Drive para abrir este archivo.');
    return file.content;
  },
};
/** @param {import('mysql2/promise').Pool} pool */
export async function ensureFileStorage(pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS em_video_uploads (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,actor_id VARCHAR(128) NOT NULL,target_kind VARCHAR(20) NOT NULL,target_id VARCHAR(128) NOT NULL,category VARCHAR(20) NOT NULL,name VARCHAR(160) NOT NULL,size INT NOT NULL,sha256 CHAR(64) NOT NULL,file_id VARCHAR(200) NULL,location TEXT NULL,lease_until BIGINT NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,KEY video_actor (actor_id,created_at)) ENGINE=InnoDB');
  await pool.query('CREATE TABLE IF NOT EXISTS em_drive_blobs (sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,file_id VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,mime VARCHAR(40) NOT NULL,size INT NOT NULL,ready BOOLEAN NOT NULL DEFAULT FALSE,created_at BIGINT NOT NULL) ENGINE=InnoDB');
  await pool.query('CREATE TABLE IF NOT EXISTS em_drive_folders (path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,file_id VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,parent_id VARCHAR(200) NOT NULL,name VARCHAR(100) NOT NULL) ENGINE=InnoDB');
  const folderColumns=await selectQuery(pool,"SHOW COLUMNS FROM em_drive_blobs LIKE 'folder_id'");
  if(!folderColumns.length)try{await pool.query('ALTER TABLE em_drive_blobs ADD COLUMN folder_id VARCHAR(200) NULL');}catch(error){if(!(error instanceof Error)||!('code' in error)||error.code!=='ER_DUP_FIELDNAME')throw error;}
  for (const table of ['em_media','em_media_uploads','em_attachments']) {
    for (const column of table === 'em_attachments' ? ['storage_key'] : ['storage_key','thumbnail_key']) {
      const columns = await selectQuery(pool,`SHOW COLUMNS FROM ${table} LIKE ?`,[column]);
      if (!columns.length) {
        try { await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL`); }
        catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ER_DUP_FIELDNAME') throw error; }
      }
    }
  }
}
/** @param {import('mysql2/promise').Pool} pool @param {ReturnType<typeof createDriveStorage>} drive @param {boolean} [enabled] @returns {FileStore} */
export function createFileStore(pool, drive, enabled=true) {
  /** @param {string} sha256 @param {string} mime @param {number} size */
  async function reserve(sha256,mime,size) {
    /** @type {BlobRow[]} */ let rows=await select(pool,'SELECT * FROM em_drive_blobs WHERE sha256=?',[sha256]);
    if(!rows.length){const id=await drive.reserve();await pool.execute('INSERT IGNORE INTO em_drive_blobs (sha256,file_id,mime,size,ready,created_at) VALUES (?,?,?,?,FALSE,?)',[sha256,id,mime,size,Date.now()]);rows=await select(pool,'SELECT * FROM em_drive_blobs WHERE sha256=?',[sha256]);}
    const row=rows[0];if(!row||row.mime!==mime||Number(row.size)!==size)throw Object.assign(new Error('Conflicting file identity'),{code:'FILE_INTEGRITY'});return row;
  }
  return {
    enabled,
    video:enabled&&drive.video?{
      async start(sha,size){const row=await reserve(sha,'video/mp4',size);return {fileId:row.file_id,...await drive.video.start(row.file_id,size,sha)};},
      progress:(...args)=>drive.video.progress(...args),chunk:(...args)=>drive.video.chunk(...args),get:(...args)=>drive.get(...args),
    }:undefined,
    async range(conn,file,start,end){
      if(!file.storage_key)return file.content.subarray(start,end+1);
      /** @type {BlobRow[]} */const rows=await select(conn,'SELECT * FROM em_drive_blobs WHERE sha256=?',[file.storage_key]);const row=rows[0];
      if(!row?.ready||row.sha256!==file.sha256||Number(row.size)!==Number(file.size))throw new DriveStorageError('DRIVE_INTEGRITY','El video no coincide con su registro.');
      return drive.range(row.file_id,Number(row.size),row.sha256,start,end);
    },
    organize:enabled ? createFolderOrganizer(pool,drive) : undefined,
    async prepare(bytes,mime) {
      if (!enabled) return localFiles.prepare(bytes,mime);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const row=await reserve(sha256,mime,bytes.length);
      // No operational transaction/lock spans a Google request. The reserved ID is
      // durable before upload: retries after a crash reuse it, never create a copy.
      // Verify even a ready object before binding it to another record (owner may trash it).
      await drive.put(row.file_id,bytes,mime);
      if (!row.ready) await pool.execute('UPDATE em_drive_blobs SET ready=TRUE WHERE sha256=? AND file_id=?',[sha256,row.file_id]);
      return {content:Buffer.alloc(0),storage_key:sha256};
    },
    async read(conn,file) {
      if (!file.storage_key) return localFiles.read(conn,file);
      /** @type {BlobRow[]} */ const rows = await select(conn,'SELECT * FROM em_drive_blobs WHERE sha256=?',[file.storage_key]);
      const row = rows[0];
      if (!row?.ready || (file.sha256 && row.sha256 !== file.sha256) || (file.size !== undefined && Number(row.size) !== Number(file.size))) throw Object.assign(new Error('Missing or inconsistent external file'),{code:'FILE_INTEGRITY',status:503,expose:false});
      return drive.get(row.file_id,Number(row.size),row.sha256);
    },
  };
}
/** @param {import('mysql2/promise').Pool} pool @param {NodeJS.ProcessEnv} env */
export function fileStoreFromEnv(pool,env) {
  const enabled = env.FILE_STORAGE === 'google-drive';
  if (env.FILE_STORAGE && !['mysql','google-drive'].includes(env.FILE_STORAGE)) throw Error('Invalid FILE_STORAGE');
  if (!enabled && !env.GOOGLE_DRIVE_REFRESH_TOKEN) return localFiles;
  return createFileStore(pool,createDriveStorage({clientId:env.GOOGLE_DRIVE_CLIENT_ID || '',clientSecret:env.GOOGLE_DRIVE_CLIENT_SECRET || '',refreshToken:env.GOOGLE_DRIVE_REFRESH_TOKEN || '',folderId:env.GOOGLE_DRIVE_FOLDER_ID || '',ownerEmail:env.GOOGLE_DRIVE_OWNER_EMAIL || ''}),enabled);
}
