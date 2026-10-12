export const attachmentFields='id,order_id,request_id,category,name,mime,size,sha256,uploaded_by,created_at';

// Use the same repeatable-read connection for metadata and content. A count alone
// would allow 50 x 4 MiB to accumulate before JSON/base64 serialization.
export async function* attachmentBatches(conn,{maxBytes=8*1024*1024,pageSize=50}={}) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<4*1024*1024||maxBytes>8*1024*1024||!Number.isInteger(pageSize)||pageSize<1||pageSize>50)throw new RangeError('Invalid backup batch limit');
  let cursor='';
  for(;;) {
    const [metadata]=await conn.execute(`SELECT id,OCTET_LENGTH(content) AS bytes FROM em_attachments WHERE id>? ORDER BY id LIMIT ${pageSize}`,[cursor]);
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
      const [rows]=await conn.execute(`SELECT ${attachmentFields},content FROM em_attachments WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`,ids);
      if(rows.length!==ids.length||rows.reduce((sum,row)=>sum+row.content.length,0)>maxBytes)throw Object.assign(new Error('Inconsistent attachment batch'),{code:'BACKUP_ATTACHMENT_BATCH'});
      yield rows;
    }
    cursor=metadata.at(-1).id;
  }
}

export function manifestPage(query) {
  if(query.limit===undefined&&query.cursor===undefined)return null; // Preserve the existing full manifest contract.
  const limit=Number(query.limit??100);
  if(!Number.isInteger(limit)||limit<1||limit>200)throw Object.assign(new Error('Usa un límite entre 1 y 200.'),{status:400,expose:true});
  let cursor=null;
  if(query.cursor!==undefined) {
    try {
      if(typeof query.cursor!=='string'||query.cursor.length>500)throw Error();
      cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));
      if(!Array.isArray(cursor)||cursor.length!==2||!Number.isSafeInteger(cursor[0])||cursor[0]<0||typeof cursor[1]!=='string'||!cursor[1]||cursor[1].length>128)throw Error();
    }catch{throw Object.assign(new Error('El cursor del manifiesto no es válido.'),{status:400,expose:true});}
  }
  return {limit,cursor};
}
