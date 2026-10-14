import {createHash} from 'node:crypto';
import {select} from './sql.mjs';

/** @param {string} value */
const label = value => value.replace(/[\x00-\x1f/\\]/g,'-').slice(0,100);
/** @param {import('./contracts.js').SqlConnection} conn @param {string} entity @param {string} id */
async function record(conn,entity,id) {
  /** @type {{payload:string}[]} */ const rows=await select(conn,'SELECT payload FROM em_records WHERE entity=? AND id=?',[entity,id]);
  return rows[0] ? /** @type {import('../src/domain/model.js').EntityRecord} */(JSON.parse(rows[0].payload)) : undefined;
}
/** @param {import('./contracts.js').SqlConnection} conn @param {string} sha */
export async function fileFolderPath(conn,sha) {
  // One physical original keeps its first recorded origin, even when reused elsewhere.
  /** @type {{entity:string,id:string,created_at:number,kind:string}[]} */
  const owners=await select(conn,`SELECT 'Equipo' entity,equipment_id id,created_at,'Fotos' kind FROM em_media WHERE storage_key=?
    UNION ALL SELECT IF(ticket_id IS NULL,'OrdenServicio','Ticket'),IFNULL(ticket_id,order_id),created_at,IF(mime='application/pdf','Documentos',IF(mime='video/mp4','Videos','Fotos')) FROM em_attachments WHERE storage_key=?
    UNION ALL SELECT 'Equipo',equipment_id,created_at,'Miniaturas' FROM em_media WHERE thumbnail_key=? ORDER BY created_at,entity,id LIMIT 1`,[sha,sha,sha]);
  const owner=owners[0];if(!owner)return null;
  const row=await record(conn,owner.entity,owner.id);
  const title=label(`${row?.codigo || 'Archivado'}_${owner.id.slice(0,8)}`);
  const year=new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'America/Guatemala'}).format(new Date(Number(owner.created_at)));
  return owner.entity==='Equipo' ? ['Equipos',title,owner.kind] : [owner.entity==='Ticket'?'Solicitudes':'Reportes',year,title,owner.kind];
}

/** @param {import('mysql2/promise').Pool} pool @param {ReturnType<import('./drive-storage.mjs').createDriveStorage>} drive */
export function createFolderOrganizer(pool,drive) {
  /** @type {Promise<number>|undefined} */ let pending;
  /** @type {Map<string,string>} */ let verified=new Map();
  /** @param {string[]} names */
  async function ensurePath(names) {
    let parent=drive.rootId;
    for(let depth=0;depth<names.length;depth++) {
      const path=names.slice(0,depth+1).join('/');
      if(verified.has(path)){parent=/** @type {string} */(verified.get(path));continue;}
      const key=createHash('sha256').update(drive.rootId+'\n'+path).digest('hex');
      /** @type {{file_id:string,parent_id:string,name:string}[]} */ let rows=await select(pool,'SELECT file_id,parent_id,name FROM em_drive_folders WHERE path_hash=?',[key]);
      if(!rows.length) {
        const id=await drive.reserve();
        await pool.execute('INSERT IGNORE INTO em_drive_folders (path_hash,file_id,parent_id,name) VALUES (?,?,?,?)',[key,id,parent,names[depth]]);
        rows=await select(pool,'SELECT file_id,parent_id,name FROM em_drive_folders WHERE path_hash=?',[key]);
      }
      const row=rows[0];if(!row || row.parent_id!==parent || row.name!==names[depth])throw Error('Conflicting managed folder');
      await drive.folder(row.file_id,row.name,parent);parent=row.file_id;verified.set(path,parent);
    }
    return parent;
  }
  async function run() {
    verified=new Map();
    for(const name of ['Equipos','Solicitudes','Reportes'])await ensurePath([name]);
    /** @type {{sha256:string,file_id:string,mime:string,size:number}[]} */
    const rows=await select(pool,`SELECT b.sha256,b.file_id,b.mime,b.size FROM em_drive_blobs b WHERE ready=TRUE AND folder_id IS NULL AND
      (EXISTS(SELECT 1 FROM em_media m WHERE m.storage_key=b.sha256 OR m.thumbnail_key=b.sha256) OR EXISTS(SELECT 1 FROM em_attachments a WHERE a.storage_key=b.sha256)) ORDER BY created_at,sha256 LIMIT 20`);
    let moved=0;
    for(const row of rows) {
      const names=await fileFolderPath(pool,row.sha256);if(!names)continue;
      const destination=await ensurePath(names);
      await drive.move(row.file_id,destination,row);
      await pool.execute('UPDATE em_drive_blobs SET folder_id=? WHERE sha256=? AND folder_id IS NULL',[destination,row.sha256]);moved++;
    }
    return moved;
  }
  return () => pending ?? (pending=run().finally(()=>{pending=undefined;}));
}
