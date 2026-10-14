import { useEffect, useId, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { api } from '../../data/remote';
import { serverMode } from '../../data/source';
import { ErrorNotice } from '../../components/ui';
import { photoSelectionError, uploadTicketPhotos, type TicketPhotoDraft } from './ticket-photo-upload';
import './ticket-photos.css';
import PrivateAttachment from './PrivateAttachment';

type Photo = {mime:string;id:string;name:string;size:number;created_at:number};
export function useTicketPhotoDraft() {
  const [photos,setPhotos] = useState<TicketPhotoDraft[]>([]);
  const [selectionError,setSelectionError] = useState('');
  function select(files: File[]) {
    const accepted: TicketPhotoDraft[] = []; const errors: string[] = [];
    for (const file of files) {
      const error = photoSelectionError(file);
      if (error) { errors.push(error); continue; }
      if (photos.length + accepted.length >= 10) { errors.push('Selecciona hasta 10 archivos por envío.'); break; }
      if (photos.some(row => row.file.name === file.name && row.file.size === file.size && row.file.lastModified === file.lastModified)) continue;
      accepted.push({id:crypto.randomUUID(),file,status:'pending'});
    }
    setPhotos(previous => [...previous,...accepted]); setSelectionError(errors.join(' '));
  }
  const upload = (ticketId: string) => uploadTicketPhotos(ticketId,photos,changed => setPhotos(previous => previous.map(row => row.id === changed.id ? changed : row)));
  return {photos,selectionError,select,upload,remove:(id:string) => setPhotos(previous => previous.filter(row => row.id !== id)),clearSaved:() => setPhotos(previous => previous.filter(row => row.status !== 'saved')),pending:photos.some(row => row.status !== 'saved')};
}
function Preview({file}: {file: File}) {
  const [url,setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); },[file]);
  return url && file.type==='video/mp4' ? <video src={url} controls playsInline preload="metadata" aria-label={`Vista previa: ${file.name}`}/> : url ? <img src={url} alt={`Vista previa: ${file.name}`} /> : null;
}
export function TicketPhotoPicker({draft,busy}: {draft:ReturnType<typeof useTicketPhotoDraft>;busy:boolean}) {
  const input = useRef<HTMLInputElement>(null); const label = useId();
  return <section className="ticket-photos" aria-labelledby={label} onDragOver={event => {event.preventDefault();}} onDrop={event => {event.preventDefault();if (!busy && serverMode) draft.select(Array.from(event.dataTransfer.files));}} onPaste={event => {if (!busy && serverMode && event.clipboardData.files.length) {event.preventDefault();draft.select(Array.from(event.clipboardData.files));}}}>
    <h3 id={label}>Fotos y videos del problema <span>· opcional</span></h3>
    <p className="field-help">Hasta 10 archivos por solicitud. Fotos JPG, PNG o WebP hasta 10 MB; se optimizan. Videos MP4 hasta 25 MB y 60 segundos, H.264 con audio AAC opcional.</p>
    {!serverMode ? <p className="field-help">Las fotografías requieren conexión al portal.</p> : <><input ref={input} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,video/mp4" disabled={busy} onChange={event => {draft.select(Array.from(event.target.files || []));event.target.value='';}} />
      <button type="button" className="button" aria-label="Seleccionar fotos o videos del problema" disabled={busy} onClick={() => input.current?.click()}><Camera size={16}/>Seleccionar fotos o videos</button>
      <p className="field-help">Puedes elegir de la galería, arrastrar archivos o pegar una imagen aquí. Para WhatsApp, descarga primero el archivo recibido.</p></>}
    <ErrorNotice message={draft.selectionError} />
    <ul className="ticket-photo-list">{draft.photos.map(photo => <li key={photo.id}><Preview file={photo.file}/><div><strong>{photo.file.name}</strong><small role="status">{photo.status === 'saved' ? 'Guardada' : photo.status === 'uploading' ? (photo.progress === 99 ? 'Verificando video…' : `Subiendo${photo.progress === undefined ? '…' : ` ${photo.progress}%`}`) : photo.status === 'error' ? photo.error : `${Math.ceil(photo.file.size/1024)} KB · lista para enviar`}</small></div>{photo.status !== 'saved' && <button type="button" className="icon-button" disabled={busy} aria-label={`Quitar ${photo.file.name}`} onClick={() => draft.remove(photo.id)}><X size={16}/></button>}</li>)}</ul>
  </section>;
}
export default function TicketPhotos({ticketId,orderId,editable=false,onBusy,onPending}: {ticketId?:string;orderId?:string;editable?:boolean;onBusy?:(busy:boolean)=>void;onPending?:(pending:boolean)=>void}) {
  const [photos,setPhotos] = useState<Photo[]>([]), [error,setError] = useState(''), [loading,setLoading] = useState(true), [busy,setBusy] = useState(false), [version,setVersion] = useState(0), [uploadError,setUploadError] = useState('');
  const draft = useTicketPhotoDraft(); const query = orderId ? `orderId=${encodeURIComponent(orderId)}` : `ticketId=${encodeURIComponent(ticketId || '')}`;
  useEffect(() => {onPending?.(draft.pending);return () => onPending?.(false);},[draft.pending,onPending]);
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setPhotos([]);
    if (!serverMode) {setLoading(false);return;}
    api<{files:Photo[]}>(`ticket-attachments?${query}`).then(result => {if (active) setPhotos(result.files);}).catch(cause => {if (active) setError(cause.message);}).finally(() => {if (active) setLoading(false);});
    return () => {active=false;};
  },[query,version]);
  async function save() {
    if (busy || !ticketId) return; setBusy(true); onBusy?.(true); setUploadError('');
    try { const failed = await draft.upload(ticketId); if (failed) setUploadError('Quedan archivos pendientes. Puedes reintentar su envío.'); else draft.clearSaved(); setVersion(value => value+1); }
    finally {setBusy(false);onBusy?.(false);}
  }
  return <section className="ticket-photos os-report-section" aria-label="Evidencia inicial del problema"><h3><Camera size={17}/> Evidencia inicial del problema</h3><p className="field-help">Fotos y videos de la solicitud{orderId ? ' · se consultan desde su registro original' : ''}.</p>
    <ErrorNotice message={error || uploadError}/>{error && !busy && <button type="button" className="button button-small" onClick={() => setVersion(value => value+1)}>Volver a consultar</button>}
    {loading ? <p role="status">Cargando archivos…</p> : !error && !photos.length ? <p className="field-help">Sin archivos registrados.</p> : null}
    <div className="attachment-grid">{photos.map(photo => {const url=`/api/attachments/${encodeURIComponent(photo.id)}/file${orderId ? `?orderId=${encodeURIComponent(orderId)}` : ''}`;return <PrivateAttachment key={photo.id} url={url} name={photo.name} mime={photo.mime} caption={new Date(photo.created_at).toLocaleDateString('es-GT',{timeZone:'America/Guatemala'})}/>;})}</div>
    {editable && ticketId && serverMode && <><TicketPhotoPicker draft={draft} busy={busy}/><button type="button" className="button" disabled={!draft.pending || busy || loading || photos.length>=10} onClick={save}>{busy ? 'Guardando archivos…' : 'Guardar fotos o videos'}</button></>}
  </section>;
}
