import {Worker} from 'node:worker_threads';
export const VIDEO_MAX_BYTES=25*1024*1024;
export const VIDEO_CHUNK_BYTES=1024*1024;
/** @param {Buffer} bytes */
export async function validateVideo(bytes) {
  if(bytes.length<32||bytes.length>VIDEO_MAX_BYTES)throw Object.assign(new Error('El video debe tener hasta 25 MB.'),{status:400,expose:true});
  const data=new Uint8Array(bytes);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./video-worker.mjs',import.meta.url),{execArgv:[],workerData:data,transferList:[data.buffer],resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16}});
    let settled=false;
    /** @param {boolean} valid */
    const finish=valid=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();if(valid)resolve(true);else reject(Object.assign(new Error('Usa un MP4 válido de hasta 60 segundos, con video H.264 y audio AAC opcional. Exporta el archivo con formato compatible antes de subirlo.'),{status:400,expose:true}));};
    const timer=setTimeout(()=>finish(false),5000);
    worker.once('message',value=>finish(value===true));worker.once('error',()=>finish(false));worker.once('exit',()=>finish(false));
  });
}
