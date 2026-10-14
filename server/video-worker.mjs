import {parentPort,workerData} from 'node:worker_threads';
import {createFile} from 'mp4box';
// Parsing runs away from the HTTP event loop, with CPU and memory limits.
try {
  if(!(workerData instanceof Uint8Array))throw Error('Invalid input');
  const bytes=Buffer.from(workerData.buffer,workerData.byteOffset,workerData.byteLength);
  let offset=0,media=false,moov=false;
  while(offset<bytes.length){
    if(offset+8>bytes.length)throw Error('Truncated box');
    let size=bytes.readUInt32BE(offset);const type=bytes.toString('ascii',offset+4,offset+8);let header=8;
    if(size===1){if(offset+16>bytes.length)throw Error('Truncated box');size=Number(bytes.readBigUInt64BE(offset+8));header=16;}
    if(size===0)size=bytes.length-offset;
    if(!Number.isSafeInteger(size)||size<header||offset+size>bytes.length)throw Error('Invalid box');
    if(offset===0&&type!=='ftyp')throw Error('Not MP4');
    if(type==='moof')throw Error('Use non-fragmented MP4');
    if(type==='mdat')media=true;if(type==='moov')moov=true;
    offset+=size;
  }
  if(!media||!moov)throw Error('Missing media');
  const file=createFile(false);let valid=false;
  file.onError=()=>{throw Error('Invalid MP4');};
  file.onReady=info=>{
    const duration=info.duration/info.timescale;
    if(!Number.isFinite(duration)||duration<=0||duration>60||info.isFragmented||info.videoTracks.length!==1||info.audioTracks.length>1||info.tracks.length!==info.videoTracks.length+info.audioTracks.length)throw Error('Invalid tracks');
    if(!/^avc1\./.test(info.videoTracks[0].codec)||info.audioTracks.some(t=>!/^mp4a\.40\.2$/.test(t.codec)))throw Error('Unsupported codec');
    for(const track of info.tracks){
      if(track.duration/track.timescale>60||track.nb_samples<1)throw Error('Invalid duration');
      const samples=file.getTrackById(track.id)?.samples;
      if(!samples?.length||samples.some(s=>!Number.isSafeInteger(s.offset)||!Number.isSafeInteger(s.size)||s.size<1||s.offset<0||s.offset+s.size>bytes.length))throw Error('Missing sample bytes');
    }
    valid=true;
  };
  const buffer=Object.assign(new ArrayBuffer(bytes.length),{fileStart:0});new Uint8Array(buffer).set(bytes);
  file.appendBuffer(buffer);file.flush();parentPort?.postMessage(valid);
}catch{parentPort?.postMessage(false);}
