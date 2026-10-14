import {describe,it,expect,vi} from 'vitest';
vi.mock('../../data/remote',()=>({api:vi.fn(),videoChunk:vi.fn()}));
import {uploadVideo} from './video-upload';
describe('carga de videos por partes',()=>{
 it('reanuda desde el bloque confirmado y conserva el identificador y la huella',async()=>{
  const file=new File([new Uint8Array(2*1024*1024+45)],'falla.mp4',{type:'video/mp4'}),saved={id:'saved',category:'Solicitud',name:file.name,mime:file.type,size:file.size};
  const start=vi.fn().mockResolvedValue({offset:1024*1024}),chunk=vi.fn(async(_id:string,offset:number,part:Blob)=>({offset:offset+part.size})),finish=vi.fn().mockResolvedValue({file:saved}),progress=vi.fn();
  expect(await uploadVideo(file,'stable-request',{ticketId:'ticket'},progress,{start,chunk,finish})).toEqual({file:saved});
  expect(chunk.mock.calls.map(call=>call[1])).toEqual([1024*1024,2*1024*1024]);expect(start.mock.calls[0][0].requestId).toBe('stable-request');expect(start.mock.calls[0][0].sha256).toMatch(/^[a-f0-9]{64}$/);expect(progress).toHaveBeenLastCalledWith(100);
 });
 it('no reenvía un archivo cuyo guardado ya fue confirmado y no anuncia éxito antes del cierre',async()=>{
  const file=new File([new Uint8Array(40)],'video.mp4',{type:'video/mp4'}),saved={id:'saved',category:'Antes',name:file.name,mime:file.type,size:file.size};
  const chunk=vi.fn(),finish=vi.fn(),progress=vi.fn();await uploadVideo(file,'stable',{orderId:'order'},progress,{start:vi.fn().mockResolvedValue({offset:40,file:saved}),chunk,finish});expect(chunk).not.toHaveBeenCalled();expect(finish).not.toHaveBeenCalled();
  progress.mockClear();await expect(uploadVideo(file,'stable',{orderId:'order'},progress,{start:vi.fn().mockResolvedValue({offset:40}),chunk,finish:vi.fn().mockRejectedValue(new Error('Video inválido'))})).rejects.toThrow('Video inválido');expect(progress).not.toHaveBeenCalledWith(100);
 });
 it('detiene un progreso inválido sin continuar ni guardar',async()=>{
  const file=new File([new Uint8Array(40)],'video.mp4',{type:'video/mp4'}),finish=vi.fn();
  await expect(uploadVideo(file,'stable',{ticketId:'ticket'},()=>{},{start:vi.fn().mockResolvedValue({offset:0}),chunk:vi.fn().mockResolvedValue({offset:0}),finish})).rejects.toThrow('No se confirmó');expect(finish).not.toHaveBeenCalled();
 });
});
