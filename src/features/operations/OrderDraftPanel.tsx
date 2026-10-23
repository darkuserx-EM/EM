import {useEffect,useState} from 'react';
import {draftKey,draftTexts,readDraft,canRestoreDraft,type OrderDraft} from './order-draft';
import type {Actor} from '../../domain/model';

export function OrderDraftPanel({actor,scope,version,equipment,values,initial,requestId,onRestore,onSavedDraft}: {
 actor:Actor;scope:string;version:string;equipment:string;values:Record<string,string>;initial:Record<string,string>;requestId:string;
 onRestore:(texts:Record<string,string>,requestId:string)=>void;onSavedDraft?:(clear:()=>void)=>void;
}) {
 const key=draftKey(actor,scope);
 const [pending,setPending]=useState<OrderDraft>(); const [checked,setChecked]=useState(false);
 const [status,setStatus]=useState(''); const [online,setOnline]=useState(()=>navigator.onLine);
 useEffect(()=>{try{setPending(readDraft(localStorage,key));}catch{setStatus('No se puede guardar el borrador en este navegador.');}setChecked(true);},[key]);
 useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
 const texts=JSON.stringify(draftTexts(values)),base=JSON.stringify(draftTexts(initial));
 useEffect(()=>{
  if(!checked||pending||actor.rol==='Cliente')return;
  try{if(texts===base){localStorage.removeItem(key);setStatus('');return;}
   localStorage.setItem(key,JSON.stringify({version:1,savedAt:Date.now(),baseVersion:version,requestId,equipment,texts:JSON.parse(texts)} satisfies OrderDraft));
   setStatus('Texto respaldado en este dispositivo · todavía no guardado en el portal.');
  }catch{setStatus('No se pudo respaldar el texto localmente. Mantén esta ventana abierta y guarda en el portal.');}
 },[key,checked,pending,texts,base,version,requestId,equipment,actor.rol]);
 useEffect(()=>{onSavedDraft?.(()=>{setPending(undefined);try{localStorage.removeItem(key);}catch{/* Keep the save result independent of browser storage. */}});},[key,onSavedDraft]);
 if(actor.rol==='Cliente')return null;
 const compatible=pending&&canRestoreDraft(pending,version);
 return <aside className="os-draft-notice" aria-label="Borrador y conexión">
  {!online&&<p role="status">El dispositivo indica que no tiene conexión. Puedes seguir redactando; guardar en el portal requiere comunicación con el servidor.</p>}
  {status&&<p role="status">{status}</p>}
  {pending&&<><p><strong>Hay texto pendiente de recuperar</strong> · {pending.equipment||'Orden nueva'} · {new Date(pending.savedAt).toLocaleString('es-GT',{timeZone:'America/Guatemala'})}.</p>
   <p>{compatible?'Revisa el texto antes de restaurarlo. Solo se recuperan textos; fechas, equipo, estado, lecturas y evidencias no se cambian.':'La orden cambió desde este borrador. No se restaurará automáticamente: compara el texto con la versión actual y copia únicamente lo que corresponda.'}</p>
   <details><summary>Consultar texto del borrador</summary>{Object.entries(pending.texts).filter(([,v])=>v).map(([k,v])=><label className="os-field" key={k}>{k.replaceAll('_',' ')}<textarea value={v} readOnly rows={3}/></label>)}</details>
   {compatible&&<button type="button" className="button" onClick={()=>{onRestore(pending.texts,pending.requestId);setPending(undefined);}}>Restaurar textos</button>}
   <button type="button" className="button" onClick={()=>{try{localStorage.removeItem(key);setPending(undefined);}catch{setStatus('No se pudo descartar el borrador.');}}}>Descartar borrador local</button>
  </>}
  <small>Respaldo de textos durante 7 días en este navegador. No incluye fotos, videos ni firmas. Usa «Guardar avance» para compartir el trabajo.</small>
 </aside>;
}
