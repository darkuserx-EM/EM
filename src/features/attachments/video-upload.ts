import {api,videoChunk} from '../../data/remote';
export interface VideoAttachment {id:string;category:string;name:string;mime:string;size:number}
interface Receipt {offset:number;file?:VideoAttachment}
export function videoSelectionError(file:Pick<File,'size'|'type'|'name'>) {
  if(file.type!=='video/mp4')return 'Usa un video MP4 con H.264 y audio AAC opcional.';
  if(file.size<32||file.size>25*1024*1024)return 'El video debe tener hasta 25 MB.';
  return '';
}
// The same request ID and SHA resume an interrupted upload without copying the file.
export async function uploadVideo(file:File,requestId:string,target:{ticketId?:string;orderId?:string;category?:string},progress:(percent:number)=>void,
  dependencies={start:(body:object)=>api<Receipt>('videos/start',body, {timeoutMs:90000}),chunk:videoChunk,finish:(id:string)=>api<{file:VideoAttachment}>(`videos/${id}/finish`,{}, {timeoutMs:180000})}) {
  const invalid=videoSelectionError(file);if(invalid)throw new Error(invalid);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const started=await dependencies.start({...target,requestId,name:file.name,size:file.size,sha256:hash});if(started.file){progress(100);return {file:started.file};}
  let offset=started.offset;
  if(!Number.isSafeInteger(offset)||offset<0||offset>file.size)throw new Error('Progreso de video inválido. Reintenta la carga.');
  progress(Math.floor(offset/file.size*99));
  while(offset<file.size){
    const result=await dependencies.chunk(requestId,offset,file.slice(offset,offset+1024*1024));
    if(!Number.isSafeInteger(result.offset)||result.offset<=offset||result.offset>file.size)throw new Error('No se confirmó el bloque del video. Reintenta la carga.');
    offset=result.offset;progress(Math.floor(offset/file.size*99));
  }
  const result=await dependencies.finish(requestId);progress(100);return result;
}
