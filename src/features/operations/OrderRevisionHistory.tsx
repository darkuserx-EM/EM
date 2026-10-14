import { useEffect, useState } from 'react';
import { api } from '../../data/remote';
import { serverMode } from '../../data/source';
import { ErrorNotice } from '../../components/ui';
type Event = { id: string; action: string; date: string; actor: string; reason?: string; previous?: string; next?: string; changes: {field:string;before:string|boolean;after:string|boolean}[] };
export default function OrderRevisionHistory({ id, version }: { id: string; version: string }) {
  const [events,setEvents]=useState<Event[]>([]),[error,setError]=useState('');
  useEffect(()=>{let active=true;setError('');if(serverMode)api<{events:Event[]}>(`orders/${encodeURIComponent(id)}/revisions`).then(result=>{if(active)setEvents(result.events);}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[id,version]);
  const labels:Record<string,string>={sintoma:"Síntoma",diagnostico:"Diagnóstico",causa_confirmada:"Causa",trabajo_realizado:"Trabajo",recomendaciones:"Recomendaciones",pruebas_realizadas:"Pruebas",resultado_pruebas:"Resultado",recibido_por:"Recibido por",notas_seguridad:"Seguridad",insumos:"Insumos",repuestos:"Repuestos",fecha_fin:"Fin del trabajo",visible_cliente:"Compartido con cliente"};
  return <details className="panel order-revisions"><summary>Historial de revisiones y evidencias</summary><ErrorNotice message={error}/>{events.length?<ul>{events.map(event=><li key={event.id}><strong>{event.action}</strong><p>{new Date(event.date).toLocaleString('es-GT',{timeZone:'America/Guatemala'})} · {event.actor}</p><p>{event.reason}</p>{event.previous&&<p>{event.previous} → {event.next}</p>}<ul>{event.changes.map(change=><li key={change.field}><strong>{labels[change.field]||change.field}</strong><p>Antes: {String(change.before)||"Sin dato"}</p><p>Ahora: {String(change.after)||"Sin dato"}</p></li>)}</ul></li>)}</ul>:<p>Sin revisiones registradas. Se muestran hasta 100 eventos recientes.</p>}</details>;
}
