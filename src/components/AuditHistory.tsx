import { useEffect, useRef, useState } from 'react';
import { useActor, useRevision } from '../app/state';
import { getDataSource } from '../data/source';
import type { AuditPage, AuditQuery } from '../data/audit-log';
import { ErrorNotice } from './ui';
import { formatDate, formatTime } from '../domain/format';

export function useAuditLog(query: AuditQuery = {}) {
  const actor = useActor(), revision = useRevision();
  const key = JSON.stringify([actor.id,actor.rol,revision,query]);
  const current = useRef(key); current.current = key;
  const [state,setState] = useState<AuditPage & {key:string;error:string;loading:boolean}>({key:'',rows:[],nextCursor:null,error:'',loading:false});
  async function load(more = false) {
    const expected = key;
    setState(old=>({...old,key,rows:more&&old.key===key?old.rows:[],error:'',loading:true}));
    try {
      const page = await getDataSource().auditLog(actor,{...query,cursor:more?state.nextCursor||undefined:undefined});
      if(current.current===expected) setState(old=>({key,rows:more?[...old.rows,...page.rows.filter(row=>!old.rows.some(item=>item.id===row.id))]:page.rows,nextCursor:page.nextCursor,error:'',loading:false}));
    } catch(cause) { if(current.current===expected)setState(old=>({...old,key,error:(cause as Error).message,loading:false})); }
  }
  useEffect(()=>{ current.current=key; if(actor.rol==='Administrador') void load(); return ()=>{current.current='';}; },[key]);
  return {rows:state.key===key?state.rows:[],error:state.key===key?state.error:'',loading:state.key!==key||state.loading,nextCursor:state.key===key?state.nextCursor:null,load};
}
export function AuditHistory({query}: {query:AuditQuery}) {
  const audit=useAuditLog(query);
  return <><ErrorNotice message={audit.error}/>{audit.rows.length ? <ol>{audit.rows.map(row=><li key={row.id}><p>{row.detalle}</p><small>{formatDate(row.fecha_creacion)} · {formatTime(row.fecha_creacion)} · {row.registrado_por||row.creado_por}</small>{row.motivo&&<p>Motivo: {row.motivo}</p>}</li>)}</ol> : !audit.loading&&!audit.error&&<p>Sin movimientos registrados.</p>}{audit.loading&&<p role="status">Cargando historial…</p>}{(audit.nextCursor||audit.error)&&<button type="button" className="button button-small" disabled={audit.loading} onClick={()=>void audit.load(!!audit.nextCursor)}>{audit.error?'Reintentar':'Ver más movimientos'}</button>}</>;
}
export function AuditDisclosure({query,title}: {query:AuditQuery;title:string}) {
  const [open,setOpen]=useState(false);
  return <details className="finding-audit" onToggle={event=>setOpen(event.currentTarget.open)}><summary>{title}</summary>{open&&<AuditHistory query={query}/>}</details>;
}
