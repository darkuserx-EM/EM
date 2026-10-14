import { createHash } from 'node:crypto';

const api = 'https://www.googleapis.com/drive/v3';
const maxBytes = 4 * 1024 * 1024;
const idPattern = /^[A-Za-z0-9_-]{10,200}$/;
export class DriveStorageError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code,message) { super(message); this.code=code; this.status=503; this.expose=true; }
}
/** @param {string} code @param {string} message */
const unavailable = (code, message) => new DriveStorageError(code,message);
/** @param {Response} response */
function check(response) {
  if (response.ok) return;
  if ([401,403].includes(response.status)) throw unavailable('DRIVE_ACCESS', 'No se pudo acceder al almacenamiento. Administración debe revisar la conexión con Google Drive.');
  if (response.status === 429) throw unavailable('DRIVE_LIMIT', 'Google Drive está limitando las cargas. Conserva el archivo y vuelve a intentarlo.');
  throw unavailable('DRIVE_UNAVAILABLE', 'El almacenamiento no está disponible. El archivo no se ha confirmado; vuelve a intentarlo.');
}
/** @param {unknown} value @returns {Record<string,unknown>} */
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable('DRIVE_RESPONSE', 'Google Drive devolvió una respuesta inesperada.');
  return /** @type {Record<string,unknown>} */ (value);
}
/** @param {Response} response @param {number} limit */
async function boundedBytes(response, limit) {
  if (!response.body || Number(response.headers.get('content-length') || 0) > limit) throw unavailable('DRIVE_INTEGRITY', 'El tamaño del archivo no coincide con su registro.');
  const reader = response.body.getReader(), parts = []; let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) throw unavailable('DRIVE_INTEGRITY', 'El tamaño del archivo no coincide con su registro.');
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts);
  } finally { await reader.cancel().catch(() => {}); }
}
/**
 * Private binary provider. Tokens never leave this server; callers authorize the
 * equipment/ticket/order before reading. No public Drive URL is returned.
 * @param {{clientId:string,clientSecret:string,refreshToken:string,folderId:string,ownerEmail:string,fetch?:typeof fetch}} options
 */
export function createDriveStorage({clientId,clientSecret,refreshToken,folderId,ownerEmail,fetch:request=fetch}) {
  if (!clientId || !clientSecret || !refreshToken || !idPattern.test(folderId) || !ownerEmail.includes('@')) throw unavailable('CONFIG_DRIVE', 'Falta completar la conexión privada con Google Drive.');
  let access = '', expires = 0;
  /** @type {Promise<string>|undefined} */ let refreshing;
  async function token() {
    if (access && expires > Date.now() + 60000) return access;
    if (!refreshing) refreshing = (async () => {
      const response = await request('https://oauth2.googleapis.com/token', {method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
      if(response.status===400)throw unavailable('DRIVE_AUTH','La autorización de Google Drive venció o fue revocada. Administración debe volver a conectar la cuenta.');
      check(response); const data = object(await response.json());
      if (typeof data.access_token !== 'string' || !Number.isFinite(Number(data.expires_in))) throw unavailable('DRIVE_AUTH', 'Vuelve a conectar la cuenta de Google Drive desde administración.');
      access = data.access_token; expires = Date.now() + Math.min(Number(data.expires_in),3600) * 1000; return access;
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  }
  /** @param {string} url @param {RequestInit} [init] */
  async function call(url, init={}) {
    // Only fixed Google endpoints and validated resumable upload locations may receive credentials.
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.hostname !== 'www.googleapis.com' || !/^\/(drive\/v3\/|upload\/drive\/v3\/)/.test(target.pathname) || target.username || target.password || target.port) throw unavailable('DRIVE_ENDPOINT', 'La dirección del almacenamiento no es válida.');
    try {
      const response = await request(target,{...init,redirect:'error',signal:AbortSignal.timeout(45000),headers:{...init.headers,Authorization:`Bearer ${await token()}`}});
      if (response.status === 401) { access = ''; expires = 0; }
      return response;
    } catch (error) {
      if (error instanceof Error && 'expose' in error) throw error;
      // Never expose/log upstream request objects, upload-session URLs or credentials.
      throw unavailable('DRIVE_NETWORK', 'No se pudo comunicar con Google Drive. Conserva el archivo y vuelve a intentarlo.');
    }
  }
  async function verifyFolder() {
    const response = await call(`${api}/files/${folderId}?fields=id,name,mimeType,trashed,ownedByMe,owners(emailAddress),permissions(type,role),capabilities(canAddChildren)`); check(response);
    const folder = object(await response.json());
    const owners = Array.isArray(folder.owners) ? folder.owners.map(object) : [];
    const permissions = Array.isArray(folder.permissions) ? folder.permissions.map(object) : [];
    if (folder.id !== folderId || folder.name !== 'PORTAL_EM' || folder.mimeType !== 'application/vnd.google-apps.folder' || folder.trashed !== false || folder.ownedByMe !== true || !owners.some(owner => String(owner.emailAddress).toLowerCase() === ownerEmail.toLowerCase()) || !permissions.length || permissions.some(permission => permission.role !== 'owner') || object(folder.capabilities).canAddChildren !== true) throw unavailable('DRIVE_FOLDER_PRIVATE', 'PORTAL_EM debe ser una carpeta privada de la cuenta propietaria, sin enlaces públicos ni acceso compartido.');
    return {id:folderId,name:'PORTAL_EM',private:true};
  }
  /** @param {string} id @returns {Promise<Record<string,unknown>>} */
  async function privateFolder(id) {
    if(!idPattern.test(id))throw unavailable('DRIVE_FOLDER_PRIVATE','La carpeta no pertenece a PORTAL_EM.');
    const response=await call(`${api}/files/${id}?fields=id,name,mimeType,parents,trashed,ownedByMe,owners(emailAddress),permissions(type,role),capabilities(canAddChildren)`);check(response);
    const data=object(await response.json());
    const owners=Array.isArray(data.owners)?data.owners.map(object):[],permissions=Array.isArray(data.permissions)?data.permissions.map(object):[];
    if(data.id!==id || data.mimeType!=='application/vnd.google-apps.folder' || data.trashed!==false || data.ownedByMe!==true || !owners.some(o=>String(o.emailAddress).toLowerCase()===ownerEmail.toLowerCase()) || !permissions.length || permissions.some(p=>p.role!=='owner') || object(data.capabilities).canAddChildren!==true)throw unavailable('DRIVE_FOLDER_PRIVATE','Las carpetas del portal deben permanecer privadas y en la cuenta propietaria.');
    return data;
  }
  /** @param {string} id */
  async function verifyTree(id) {
    const seen=new Set();
    for(let depth=0;depth<7;depth++) {
      if(id===folderId){await verifyFolder();return;}
      if(seen.has(id))break;seen.add(id);
      const data=await privateFolder(id);
      if(!Array.isArray(data.parents)||data.parents.length!==1||typeof data.parents[0]!=='string')break;
      id=data.parents[0];
    }
    throw unavailable('DRIVE_FOLDER_PRIVATE','La carpeta no pertenece a PORTAL_EM.');
  }
  return {
    rootId:folderId,
    verifyFolder,
    /** @param {string} id @param {string} name @param {string} parent */
    async folder(id,name,parent) {
      if(!idPattern.test(id)||!name||name.length>100||/[\x00-\x1f/\\]/.test(name))throw unavailable('DRIVE_INPUT','La carpeta no es válida.');
      await verifyTree(parent);
      const old=await call(`${api}/files/${id}?fields=id`);
      if(old.status===404) {
        const created=await call(`${api}/files`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name,mimeType:'application/vnd.google-apps.folder',parents:[parent]})});
        if(created.status!==409)check(created);
      }else check(old);
      const data=await privateFolder(id);
      if(data.name!==name||!Array.isArray(data.parents)||data.parents.length!==1||data.parents[0]!==parent)throw unavailable('DRIVE_FOLDER_PRIVATE','La carpeta registrada cambió. No se movieron archivos.');
    },
    /** @param {string} id @param {string} destination @param {{sha256:string,mime:string,size:number}} expected */
    async move(id,destination,expected) {
      if(!idPattern.test(id)||!idPattern.test(destination))throw unavailable('DRIVE_INPUT','La ubicación no es válida.');
      await verifyTree(destination);
      const url=`${api}/files/${id}?fields=id,size,mimeType,sha256Checksum,parents,trashed`;
      const before=await call(url);check(before);const data=object(await before.json());
      if(data.id!==id||data.trashed!==false||data.sha256Checksum!==expected.sha256||data.mimeType!==expected.mime||Number(data.size)!==Number(expected.size)||!Array.isArray(data.parents)||data.parents.length!==1||typeof data.parents[0]!=='string')throw unavailable('DRIVE_INTEGRITY','El archivo no coincide con su registro. No se movió.');
      await verifyTree(data.parents[0]);
      if(data.parents[0]===destination)return;
      const result=await call(`${api}/files/${id}?addParents=${destination}&removeParents=${data.parents[0]}&fields=id,size,mimeType,sha256Checksum,parents,trashed`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{}'});check(result);
      const after=await call(url);check(after);const moved=object(await after.json());
      if(moved.id!==id||moved.sha256Checksum!==expected.sha256||Number(moved.size)!==Number(expected.size)||moved.mimeType!==expected.mime||moved.trashed!==false||!Array.isArray(moved.parents)||moved.parents.length!==1||moved.parents[0]!==destination)throw unavailable('DRIVE_INTEGRITY','No se pudo verificar la nueva ubicación. Se conservaron los identificadores.');
    },
    async reserve() {
      const response = await call(`${api}/files/generateIds?count=1&space=drive&type=files`); check(response);
      const data = object(await response.json()), id = Array.isArray(data.ids) ? data.ids[0] : undefined;
      if (typeof id !== 'string' || !idPattern.test(id)) throw unavailable('DRIVE_RESPONSE', 'No se pudo reservar el archivo en Google Drive.');
      return id;
    },
    /** @param {string} id @param {Buffer} bytes @param {string} mime */
    async put(id, bytes, mime) {
      if (!idPattern.test(id) || !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maxBytes || !['image/jpeg','image/png','image/webp','application/pdf'].includes(mime)) throw unavailable('DRIVE_INPUT', 'El archivo no tiene un formato o tamaño permitido.');
      await verifyFolder();
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const metadataUrl = `${api}/files/${id}?fields=id,size,mimeType,sha256Checksum,parents,trashed`;
      /** @param {Response} response */
      const verify = async response => {
        check(response); const data = object(await response.json());
        if (data.id !== id || data.trashed !== false || Number(data.size) !== bytes.length || data.mimeType !== mime || data.sha256Checksum !== sha256 || !Array.isArray(data.parents) || data.parents.length!==1 || typeof data.parents[0]!=='string') throw unavailable('DRIVE_INTEGRITY', 'El archivo de Drive no coincide con la carga. No se ha enlazado al registro.');
        await verifyTree(data.parents[0]);
      };
      const old = await call(metadataUrl);
      if (old.ok) { await verify(old); return; }
      if (old.status !== 404) check(old);
      const extension = { 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf' }[mime];
      const start = await call('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':mime,'X-Upload-Content-Length':String(bytes.length)},body:JSON.stringify({id,name:`${sha256}.${extension}`,mimeType:mime,parents:[folderId]})});
      if (start.status === 409) { await verify(await call(metadataUrl)); return; }
      check(start); const location = start.headers.get('location');
      if (!location) throw unavailable('DRIVE_RESPONSE', 'No se pudo iniciar la carga a Google Drive.');
      const uploaded = await call(location,{method:'PUT',headers:{'Content-Type':mime,'Content-Length':String(bytes.length)},body:new Uint8Array(bytes)});
      if (uploaded.status !== 409) check(uploaded);
      // A successful HTTP upload is insufficient: verify Google's checksum before SQL links it.
      await verify(await call(metadataUrl));
    },
    /** @param {string} id @param {number} size @param {string} sha256 */
    async get(id, size, sha256) {
      if (!idPattern.test(id) || !Number.isSafeInteger(size) || size < 1 || size > maxBytes || !/^[a-f0-9]{64}$/.test(sha256)) throw unavailable('DRIVE_METADATA', 'Los datos del archivo no son válidos.');
      const response = await call(`${api}/files/${id}?alt=media`); check(response);
      const bytes = await boundedBytes(response,size);
      if (bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== sha256) throw unavailable('DRIVE_INTEGRITY', 'La integridad del archivo no coincide con su registro.');
      return bytes;
    },
  };
}
