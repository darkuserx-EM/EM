import { useEffect, useRef, useState } from 'react';
import { api } from '../../data/remote';
import { serverMode } from '../../data/source';
import { ErrorNotice } from '../../components/ui';
import {uploadVideo} from './video-upload';
import PrivateAttachment from './PrivateAttachment';
import { prepareEquipmentImage } from '../records/equipment-image-upload';
type Attachment={id:string;category:string;name:string;mime:string;size:number};
export default function AttachmentPanel({orderId,editable=false,onBusy,completed=false}:{orderId:string;editable?:boolean;completed?:boolean;onBusy?:(busy:boolean)=>void}) {
  const [files,setFiles]=useState<Attachment[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[category,setCategory]=useState('Antes');
  const [reason,setReason]=useState('');
  const [progress,setProgress]=useState<number|null>(null);
  const [selected,setSelected]=useState<File|null>(null); const attempt=useRef(crypto.randomUUID()); const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{let active=true;setFiles([]);setError('');if(serverMode) api<{files:Attachment[]}>(`attachments?orderId=${encodeURIComponent(orderId)}`).then(result=>{if(active)setFiles(result.files);}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[orderId]);
  async function upload(){
    if(!selected||busy)return;if(completed&&(reason.trim().length<8||reason.trim().length>500)){setError('Explica el motivo de agregar evidencia después del cierre (8 a 500 caracteres).');return;}setBusy(true);onBusy?.(true);setError('');
    try{
      let base64:string;
      let result:{file:Attachment};
      if(selected.type==='video/mp4'){if(category==='Documento')throw new Error('Elige Antes o Después para el video.');result=await uploadVideo(selected,attempt.current,{orderId,category,reason},setProgress);}
      else {
      if(selected.type.startsWith('image/')) base64=(await prepareEquipmentImage(selected,'placa_datos')).split(',')[1];
      else {if(category!=='Documento'||selected.type!=='application/pdf'||selected.size>4*1024*1024)throw new Error('Usa un PDF de hasta 4 MB en Documento.');base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('No pudimos leer el archivo.'));reader.readAsDataURL(selected);});}
      result=await api<{file:Attachment}>('attachments',{orderId,category,name:selected.name,base64,requestId:attempt.current,reason});
      }
      setFiles(previous=>previous.some(row=>row.id===result.file.id)?previous:[...previous,result.file]);setSelected(null);attempt.current=crypto.randomUUID();if(input.current)input.current.value='';
    }catch(cause){setError((cause as Error).message);}finally{setBusy(false);setProgress(null);onBusy?.(false);}
  }
  return <section className="panel attachment-panel"><h2>Evidencias y documentos</h2><p className="field-help">Antes y después del trabajo · archivos privados de esta orden.</p><ErrorNotice message={error}/>
    {!serverMode?<p>Los adjuntos requieren una cuenta en el servidor.</p>:<>{editable&&<div className="ops-filters"><>{completed&&<label>Motivo de evidencia posterior al cierre<textarea minLength={8} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/></label>}</><label>Tipo<select disabled={busy} value={category} onChange={e=>{setCategory(e.target.value);attempt.current=crypto.randomUUID();}}>{['Antes','Después','Documento'].map(value=><option key={value}>{value}</option>)}</select></label><label>Archivo<input ref={input} type="file" disabled={busy} accept="image/png,image/jpeg,image/webp,application/pdf,video/mp4" onChange={e=>{setSelected(e.target.files?.[0]||null);attempt.current=crypto.randomUUID();}}/></label><button className="button button-dark" type="button" disabled={busy||!selected} onClick={upload}>{busy?(progress===99?'Verificando video…':progress===null?'Subiendo…':`Subiendo ${progress}%`):'Guardar adjunto'}</button></div>}
    {editable&&<p className="field-help">Hasta 20 archivos. Fotos hasta 10 MB que se optimizan antes de subir; PDF hasta 4 MB. Videos MP4 hasta 25 MB y 60 segundos (H.264, audio AAC opcional). Agrega evidencias antes de completar la orden.</p>}
    <div className="attachment-grid">{files.map(file=><PrivateAttachment key={file.id} url={`/api/attachments/${encodeURIComponent(file.id)}/file`} name={file.name} mime={file.mime} caption={`${file.category} · ${Math.ceil(file.size/1024)} KB`}/>)}</div>{!files.length&&<p className="field-help">Aún no hay adjuntos registrados.</p>}</>}
  </section>;
}
