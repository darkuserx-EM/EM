import { select } from './sql.mjs';
import { localFiles } from './file-storage.mjs';
export const attachmentFields='id,order_id,ticket_id,request_id,category,name,mime,size,sha256,uploaded_by,created_at';

// Use the same repeatable-read connection for metadata and content. A count alone
// would allow 50 x 4 MiB to accumulate before JSON/base64 serialization.
/** @param {import('mysql2/promise').PoolConnection} conn @param {{maxBytes?:number,pageSize?:number,files?:import('./file-storage.mjs').FileStore}} [options] */
export async function* attachmentBatches(conn,{maxBytes=8*1024*1024,pageSize=50,files=localFiles}={}) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<4*1024*1024||maxBytes>8*1024*1024||!Number.isInteger(pageSize)||pageSize<1||pageSize>50)throw new RangeError('Invalid backup batch limit');
  let cursor='';
  for(;;) {
    /** @type {{id:string,bytes:number}[]} */
    const metadata=await select(conn,`SELECT id,IF(storage_key IS NULL,OCTET_LENGTH(content),size) AS bytes FROM em_attachments WHERE id>? ORDER BY id LIMIT ${pageSize}`,[cursor]);
    if(!metadata.length)return;
    let offset=0;
    while(offset<metadata.length) {
      const ids=[];let bytes=0;
      while(offset<metadata.length) {
        const row=metadata[offset],size=Number(row.bytes);
        if(!Number.isSafeInteger(size)||size<12||size>4*1024*1024)throw Object.assign(new Error('Invalid attachment size'),{code:'BACKUP_ATTACHMENT_SIZE'});
        if(ids.length&&bytes+size>maxBytes)break;
        ids.push(row.id);bytes+=size;offset++;
      }
      /** @type {import('./contracts.js').AttachmentFile[]} */
      const rows=await select(conn,`SELECT ${attachmentFields},content,storage_key FROM em_attachments WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`,ids);
      for (const row of rows) row.content=await files.read(conn,row);
      if(rows.length!==ids.length||rows.reduce((sum,row)=>sum+row.content.length,0)>maxBytes)throw Object.assign(new Error('Inconsistent attachment batch'),{code:'BACKUP_ATTACHMENT_BATCH'});
      yield rows;
    }
    cursor=metadata[metadata.length-1].id;
  }
}

/** @param {{limit?:unknown,cursor?:unknown}} query @returns {{limit:number,cursor:[number,string]|null}|null} */
export function manifestPage(query) {
  if(query.limit===undefined&&query.cursor===undefined)return null; // Preserve the existing full manifest contract.
  const limit=Number(query.limit??100);
  if(!Number.isInteger(limit)||limit<1||limit>200)throw Object.assign(new Error('Usa un límite entre 1 y 200.'),{status:400,expose:true});
  /** @type {[number,string]|null} */
  let cursor=null;
  if(query.cursor!==undefined) {
    try {
      if(typeof query.cursor!=='string'||query.cursor.length>500)throw Error();
      /** @type {unknown} */
      const parsed=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));
      if(!Array.isArray(parsed)||parsed.length!==2||typeof parsed[0]!=='number'||!Number.isSafeInteger(parsed[0])||parsed[0]<0||typeof parsed[1]!=='string'||!parsed[1]||parsed[1].length>128)throw Error();
      cursor=[parsed[0],parsed[1]];
    }catch{throw Object.assign(new Error('El cursor del manifiesto no es válido.'),{status:400,expose:true});}
  }
  return {limit,cursor};
}
