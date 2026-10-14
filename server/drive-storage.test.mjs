import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDriveStorage} from './drive-storage.mjs';
import {localFiles,fileStoreFromEnv} from './file-storage.mjs';

const folderId='folder_private_portal_12345', fileId='file_private_portal_123456';
const bytes=Buffer.from('Synthetic binary image content for provider contract');
const sha=createHash('sha256').update(bytes).digest('hex');
const config={clientId:'synthetic-client',clientSecret:'synthetic-secret',refreshToken:'synthetic-refresh',folderId,ownerEmail:'owner@example.invalid'};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
const folder=()=>({id:folderId,name:'PORTAL_EM',mimeType:'application/vnd.google-apps.folder',trashed:false,ownedByMe:true,owners:[{emailAddress:config.ownerEmail}],permissions:[{role:'owner',type:'user'}],capabilities:{canAddChildren:true}});
const metadata=()=>({id:fileId,size:String(bytes.length),mimeType:'image/png',sha256Checksum:sha,parents:[folderId],trashed:false});
test('Drive video: 308 sin seguir redirecciones, reanudación y rangos privados',async()=>{
 let offset=0,complete=false;const location='https://www.googleapis.com/upload/drive/v3/files?upload_id=video-test';
 const drive=createDriveStorage({...config,fetch:async(url,init={})=>{
  const target=String(url);
  if(target.includes('oauth2.googleapis.com'))return json({access_token:'synthetic-access',expires_in:3600});
  assert.equal(init.redirect,'manual');
  if(target.includes(`/files/${folderId}?`))return json(folder());
  if(target.includes(`/files/${fileId}?fields=`))return complete?json({...metadata(),mimeType:'video/mp4'}):json({},404);
  if(target.includes('uploadType=resumable'))return new Response(null,{headers:{Location:location}});
  if(target===location){if(init.body){offset+=init.body.length;complete=offset===bytes.length;}return complete?json({id:fileId}):new Response(null,{status:308,headers:{Location:location,...(offset?{Range:`bytes=0-${offset-1}`}:{})}});}
  if(target.includes('alt=media')){assert.equal(init.headers.Range,'bytes=2-7');return new Response(bytes.subarray(2,8),{status:206,headers:{'Content-Range':`bytes 2-7/${bytes.length}`}});}
  throw Error('Unexpected request');
 }});
 assert.deepEqual(await drive.video.start(fileId,bytes.length,sha),{location,offset:0});
 assert.equal(await drive.video.progress(fileId,location,bytes.length,sha),0);
 assert.equal(await drive.video.chunk(location,0,bytes.length,bytes),bytes.length);
 assert.equal(await drive.video.progress(fileId,location,bytes.length,sha),bytes.length);
 assert.deepEqual(await drive.range(fileId,bytes.length,sha,2,7),bytes.subarray(2,8));
 assert.deepEqual(await drive.video.start(fileId,bytes.length,sha),{location:'',offset:bytes.length});
});
function mock(options={}) {
  let stored=options.exists||false,tokens=0,uploads=0;const calls=[];
  const request=async(url,init={})=>{
    const target=String(url);calls.push({url:target,method:init.method||'GET'});
    if(target==='https://oauth2.googleapis.com/token'){
      tokens++;assert.equal(init.redirect,'error');assert.equal(new URLSearchParams(init.body).get('grant_type'),'refresh_token');
      return options.authFailure?json({error:'invalid_grant',sensitive:config.refreshToken},400):json({access_token:'synthetic-access',expires_in:3600});
    }
    assert.equal(init.headers.Authorization,'Bearer synthetic-access');assert.equal(init.redirect,'manual');
    if(target.includes('/files/generateIds'))return json({ids:[fileId]});
    if(target.includes(`/files/${folderId}?`))return json(options.folder||folder());
    if(target.includes(`/files/${fileId}?alt=media`))return new Response(options.download||bytes);
    if(target.includes(`/files/${fileId}?fields=`))return stored?json(options.metadata||metadata()):json({},404);
    if(init.method==='POST'&&target.includes('uploadType=resumable'))return new Response(null,{status:200,headers:{Location:options.location||'https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic'}});
    if(init.method==='PUT'){uploads++;stored=true;if(options.lostResponse){options.lostResponse=false;throw Error('network contains synthetic-secret');}return json({id:fileId});}
    throw Error('Unexpected test request');
  };
  return {drive:createDriveStorage({...config,fetch:request}),calls,counts:()=>({tokens,uploads})};
}
test('Drive: carga privada, checksum, lectura y reintento sin copia',async()=>{
  const {drive,counts}=mock();assert.equal(await drive.reserve(),fileId);await drive.put(fileId,bytes,'image/png');await drive.put(fileId,bytes,'image/png');
  assert.deepEqual(await drive.get(fileId,bytes.length,sha),bytes);assert.deepEqual(counts(),{tokens:1,uploads:1});
});
test('Drive: solicitudes concurrentes comparten la renovación de autorización',async()=>{
  const {drive,counts}=mock();await Promise.all([drive.reserve(),drive.reserve(),drive.reserve()]);assert.equal(counts().tokens,1);
});
test('Drive: respuesta perdida tras cargar se recupera con el mismo ID',async()=>{
  const {drive,counts}=mock({lostResponse:true});await assert.rejects(drive.put(fileId,bytes,'image/png'),error=>error.code==='DRIVE_NETWORK'&&!error.message.includes('synthetic-secret'));await drive.put(fileId,bytes,'image/png');assert.equal(counts().uploads,1);
});
test('Drive: rechaza carpeta compartida, ajena, papelera o con otro nombre',async()=>{
  for(const changes of [{permissions:[{role:'owner',type:'user'},{role:'reader',type:'anyone'}]},{owners:[{emailAddress:'foreign@example.invalid'}]},{trashed:true},{name:'AppSheet'}]){
    const {drive,counts}=mock({folder:{...folder(),...changes}});await assert.rejects(drive.put(fileId,bytes,'image/png'),error=>error.code==='DRIVE_FOLDER_PRIVATE');assert.equal(counts().uploads,0);
  }
});
test('Drive: una sesión de carga externa nunca recibe credenciales',async()=>{
  const {drive,calls}=mock({location:'https://attacker.example.invalid/upload/drive/v3/files'});await assert.rejects(drive.put(fileId,bytes,'image/png'),error=>error.code==='DRIVE_ENDPOINT');assert.ok(calls.every(call=>!call.url.includes('attacker')));
});
test('Drive: integridad y tamaño de descarga, y checksum devuelto por Google',async()=>{
  for(const download of [Buffer.from('corrupted'),Buffer.alloc(bytes.length+1)]){
    const {drive}=mock({download});await assert.rejects(drive.get(fileId,bytes.length,sha),error=>error.code==='DRIVE_INTEGRITY');
  }
  const {drive}=mock({exists:true,metadata:{...metadata(),sha256Checksum:'0'.repeat(64)}});await assert.rejects(drive.put(fileId,bytes,'image/png'),error=>error.code==='DRIVE_INTEGRITY');
});
test('Drive: revocación y configuración no exponen secretos ni simulan un guardado',async()=>{
  const {drive}=mock({authFailure:true});await assert.rejects(drive.reserve(),error=>error.status===503&&!error.message.includes(config.refreshToken));
  assert.throws(()=>createDriveStorage({...config,folderId:'../../other'}));
  await assert.rejects(localFiles.read({}, {content:Buffer.alloc(0),storage_key:sha}),error=>error.code==='DRIVE_NOT_CONFIGURED');
  assert.equal(fileStoreFromEnv({},{}),localFiles);assert.throws(()=>fileStoreFromEnv({},{FILE_STORAGE:'google-drive'}));
});
test('Drive: conserva los bytes locales y rechaza formatos de video no habilitados',async()=>{
  assert.deepEqual(await localFiles.read({},await localFiles.prepare(bytes,'image/png')),bytes);
  const {drive,calls}=mock();await assert.rejects(drive.put(fileId,bytes,'video/webm'));assert.equal(calls.length,0);
});

test('Drive: organiza sin copiar, admite reintentos y rechaza carpetas compartidas o externas',async()=>{
  const child='child_private_portal_12345',outside='outside_private_portal_12345';
  const folders=new Map([[folderId,folder()]]);let parent=folderId,moves=0,creates=0,lost=false;
  const request=async(url,init={})=>{
    const u=new URL(url),id=u.pathname.split('/').at(-1);
    if(u.hostname==='oauth2.googleapis.com')return json({access_token:'synthetic',expires_in:3600});
    if(init.method==='POST'&&u.pathname==='/drive/v3/files'){
      const data=JSON.parse(init.body);creates++;folders.set(data.id,{...folder(),...data});return json({id:data.id});
    }
    if(id===fileId){
      if(init.method==='PATCH'){assert.equal(u.searchParams.get('removeParents'),parent);parent=u.searchParams.get('addParents');moves++;if(lost){lost=false;throw Error('Lost move response');}}
      return json({...metadata(),parents:[parent]});
    }
    if(folders.has(id))return json(folders.get(id));
    return json({},404);
  };
  const drive=createDriveStorage({...config,fetch:request});
  await drive.folder(child,'Solicitudes',folderId);await drive.folder(child,'Solicitudes',folderId);assert.equal(creates,1);
  lost=true;await assert.rejects(drive.move(fileId,child,{sha256:sha,mime:'image/png',size:bytes.length}),e=>e.code==='DRIVE_NETWORK');
  await drive.move(fileId,child,{sha256:sha,mime:'image/png',size:bytes.length});assert.equal(moves,1);
  await drive.put(fileId,bytes,'image/png');assert.equal(moves,1,'Reutilizar la foto no cambia su ubicación');
  const privateChild={...folders.get(child)};
  folders.set(child,{...privateChild,permissions:[{role:'owner'},{role:'reader'}]});
  await assert.rejects(drive.put(fileId,bytes,'image/png'),e=>e.code==='DRIVE_FOLDER_PRIVATE');
  folders.set(child,{...privateChild,parents:[outside]});folders.set(outside,{...folder(),id:outside,parents:[]});
  await assert.rejects(drive.put(fileId,bytes,'image/png'),e=>e.code==='DRIVE_FOLDER_PRIVATE');
  folders.set(child,privateChild);
  await assert.rejects(drive.move(fileId,folderId,{sha256:'0'.repeat(64),mime:'image/png',size:bytes.length}),e=>e.code==='DRIVE_INTEGRITY');assert.equal(moves,1);
});
