import OrderRevisionHistory from './OrderRevisionHistory';
import { assignedTo, orderTeamLabel } from '../../domain/order-team';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, ClipboardList, Eye, EyeOff, History, Pencil, Plus, Printer, Search, Wrench } from 'lucide-react';
import { useActor, useRows, useToast, useOperationPage } from '../../app/state';
import { EmptyState, ErrorNotice, Modal, SectionTitle } from '../../components/ui';
import { FilterToggle, KpiCard } from '../../components/design-system';
import { clientDisplayName } from '../../domain/client-profile';
import type { EntityRecord } from '../../domain/model';
import { getDataSource } from '../../data/source';
import ServiceOrderForm from './ServiceOrderForm';
import { canCreateTicketOrder } from '../../domain/technician-work';
import AttachmentPanel from '../attachments/AttachmentPanel';
import TicketPhotos from '../attachments/TicketPhotos';
import { OperationStatus } from './OperationStatus';
import { ServiceReport } from './ServiceReport';
import { operationFiltersFromParams, operationFilterParams, emptyOperationFilters, isOperationalOrder, operationDateLabel, serviceLabel, serviceStates } from './operations-ui';
import './operations.css';

export default function ServiceOrders() {
  const actor = useActor(); const manager = ['Administrador', 'Coordinador'].includes(actor.rol); const canCreate = manager || actor.rol === 'Técnico' && !!actor.tecnico_id;
  const notify = useToast(state => state.notify); const [sharing, setSharing] = useState(false); const [shareError, setShareError] = useState('');
  const equipment = useRows('Equipo', true); const clients = useRows('Cliente', true); const technicians = useRows('Tecnico', true);
  // Sedes: solo para mostrar la del reporte; si no se pueden leer, el reporte dice «Sin sede registrada».
  const sites = useRows('Sede', true);
  const [params, setParams] = useSearchParams(); const filters = operationFiltersFromParams(params);
  const setFilters = (next: typeof filters) => { setParams(operationFilterParams(next, params), { replace: true }); }; const [page, setPage] = useState(1); const [filtersOpen, setFiltersOpen] = useState(false);
  const [reopening, setReopening] = useState(false), [reason, setReason] = useState('');
  const [editor, setEditor] = useState<EntityRecord | 'new' | null>(null); const [dismissedTicket, setDismissedTicket] = useState(''); const [attachmentBusy, setAttachmentBusy] = useState(false);
  const orders=useOperationPage('OrdenServicio',{...filters,page});
  const detail=useOperationPage('OrdenServicio',{id:params.get('orden')||'',pageSize:1},params.has('orden'));
  const tickets=useOperationPage('Ticket',{id:params.get('ticket')||'',pageSize:1},canCreate&&params.has('ticket')&&params.get('ticket')!==dismissedTicket);
  const queries = [orders, equipment, clients, technicians, tickets, detail]; const loading = queries.some(query => !query.ready); const error = queries.find(query => query.error)?.error || '';
  const visible=orders.rows,total=orders.data?.total||0;
  const pageCount=Math.max(1,Math.ceil(total/25)),safePage=orders.data?.page||page;
  const selected=detail.rows[0];
  const selectedEquipment = equipment.rows.find(row => row.id === selected?.equipo_id);
  const selectedClient = clients.rows.find(row => row.id === selected?.cliente_id);
  const ticket = canCreate && params.get('ticket') !== dismissedTicket ? tickets.rows.find(row => row.id === params.get('ticket') && canCreateTicketOrder(actor, row)) : undefined;
  const createFromLink = canCreate && params.get('nueva') === '1';
  const activeFilters = (['client', 'equipment', 'technician', 'state', 'origin', 'from', 'to'] as const).filter(key => filters[key]).length;
  const counters = [
    { label: 'Órdenes actuales', icon: <ClipboardList size={18} />, origin: 'actual', state: '', value: orders.data?.counts.actual },
    { label: 'Programadas', icon: <CalendarDays size={18} />, origin: 'actual', state: 'Programada', value: orders.data?.counts.actualStates.Programada ?? (orders.data ? 0 : undefined) },
    { label: 'En proceso', icon: <Wrench size={18} />, origin: 'actual', state: 'En proceso', value: orders.data?.counts.actualStates['En proceso'] ?? (orders.data ? 0 : undefined) },
    { label: 'Reportes históricos', icon: <History size={18} />, origin: 'historico', state: '', value: orders.data?.counts.historico },
  ];
  const change = (key: keyof typeof filters, value: string) => { setPage(1); setFilters({ ...filters, [key]: value, ...(key === 'client' ? { equipment: '' } : {}) }); };
  const open = (id: string) => { setShareError(''); const next = new URLSearchParams(params); next.delete('nueva'); next.delete('ticket'); next.set('orden', id); setParams(next); };
  const close = () => { if (!attachmentBusy && !sharing) { const next = new URLSearchParams(params); next.delete('orden'); setParams(next); } };
  async function share() {
    if (!selected || sharing) return;
    setSharing(true); setShareError('');
    try { await getDataSource().repository('OrdenServicio', actor).update(selected.id, { visible_cliente: selected.visible_cliente !== true, expected_updated_at: selected.fecha_actualizacion }); notify(selected.visible_cliente === true ? 'Reporte ocultado del portal del cliente.' : 'Reporte compartido con el cliente.'); }
    catch (cause) { setShareError(cause instanceof Error ? cause.message : 'No se pudo cambiar la publicación del reporte.'); }
    finally { setSharing(false); }
  }
  async function reopenOrder() {
    if (!selected || sharing) return; setSharing(true); setShareError('');
    try { await getDataSource().repository('OrdenServicio', actor).update(selected.id, { revision_accion: 'reabrir', revision_motivo: reason, expected_updated_at: selected.fecha_actualizacion }); setReopening(false); setReason(''); notify('Orden reabierta. Revisa la solicitud vinculada y el trabajo pendiente.'); }
    catch (cause) { setShareError(cause instanceof Error ? cause.message : 'No se pudo reabrir.'); } finally { setSharing(false); }
  }
  return <div className="operations-page">
    <SectionTitle eyebrow={actor.rol === 'Técnico' ? 'MI TRABAJO' : actor.rol === 'Cliente' ? 'MI FLOTA' : 'SERVICIO Y OPERACIÓN'} title={actor.rol === 'Técnico' ? 'Mis órdenes de servicio' : actor.rol === 'Cliente' ? 'Reportes de servicio' : 'Órdenes de servicio'} description={actor.rol === 'Técnico' ? 'Tus visitas asignadas, diagnóstico, trabajo realizado y pruebas de cierre.' : actor.rol === 'Cliente' ? 'Los servicios realizados en tus equipos, con su reporte.' : 'Consulta cada servicio por cliente y equipo. El historial importado conserva su información de origen.'}>{canCreate && <button className="button button-dark" onClick={() => setEditor('new')}><Plus size={16} />Nueva orden</button>}</SectionTitle>
    <div className="kpi-grid kpi-grid-page" role="group" aria-label="Filtrar órdenes">{counters.map(item => { const pressed = filters.origin === item.origin && filters.state === item.state; return <KpiCard key={item.label} icon={item.icon} label={item.label} value={item.value ?? '—'} pressed={pressed} onClick={() => { setFilters(pressed ? { ...emptyOperationFilters } : { ...emptyOperationFilters, origin: item.origin, state: item.state }); setPage(1); }} />; })}</div>
    <section className="panel os-list-panel">
      <div className="os-filters">
        <label className="os-filter-search"><span><Search size={14} />Buscar reporte o equipo</span><input type="search" placeholder="Código, serie, ID del cliente o diagnóstico" value={filters.search} onChange={event => change('search', event.target.value)} /></label>
        <FilterToggle open={filtersOpen} active={activeFilters} controls="os-filter-fields" onToggle={() => setFiltersOpen(!filtersOpen)} />
        <div id="os-filter-fields" className={`filter-fields${filtersOpen ? ' is-open' : ''}`}>
        {actor.rol !== 'Cliente' && <label>Cliente<select value={filters.client} onChange={event => { change('client', event.target.value); }}><option value="">Todos</option>{clients.rows.map(client => <option value={client.id} key={client.id}>{clientDisplayName(client)}</option>)}</select></label>}
        <label>Equipo<select value={filters.equipment} onChange={event => change('equipment', event.target.value)}><option value="">Todos</option>{equipment.rows.filter(row => !filters.client || row.cliente_id === filters.client).map(row => <option value={row.id} key={row.id}>{row.codigo} · {row.id_interno_cliente || row.modelo}</option>)}</select></label>
        {actor.rol !== 'Técnico' && actor.rol !== 'Cliente' && <label>Técnico<select value={filters.technician} onChange={event => change('technician', event.target.value)}><option value="">Todos</option>{technicians.rows.map(row => <option value={row.id} key={row.id}>{row.nombre}</option>)}</select></label>}
        <label>Estado<select value={filters.state} onChange={event => change('state', event.target.value)}><option value="">Todos</option><option value="abiertas">Abiertas</option>{Array.from(new Set([...serviceStates, ...(orders.data?.states||[])])).filter(Boolean).map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Origen<select value={filters.origin} onChange={event => change('origin', event.target.value)}><option value="">Todos</option><option value="actual">Órdenes actuales</option><option value="historico">Historial</option></select></label>
        <label>Desde<input type="date" value={filters.from} onChange={event => change('from', event.target.value)} /></label><label>Hasta<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => change('to', event.target.value)} /></label>
        </div>
      </div>
      <div className="os-result-bar"><span>{orders.ready ? total : '…'} reportes · fecha del servicio; si está pendiente, fecha programada</span><button onClick={() => { setFilters({ ...emptyOperationFilters }); setPage(1); }}>Limpiar filtros</button></div>
      <ErrorNotice message={error} />{loading ? <p className="os-loading" role="status">Cargando reportes…</p> : !visible.length ? <EmptyState title="No hay reportes en esta selección" description={manager ? 'Crea una orden o ajusta los filtros para consultar el historial.' : 'Los reportes disponibles para tu perfil aparecerán aquí.'} /> : <>
        <div className="table-scroll"><table className="data-table os-table"><thead><tr><th>Reporte / fecha</th><th>Equipo / cliente</th><th>Servicio / técnico</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{visible.map(row => { const machine = equipment.rows.find(item => item.id === row.equipo_id); const client = clients.rows.find(item => item.id === row.cliente_id);  return <tr key={row.id}><td><button className="os-row-link" onClick={() => open(row.id)}>{serviceLabel(row)}</button><small>{operationDateLabel(row.fecha || row.fecha_programada || row.fecha_creacion)}{!isOperationalOrder(row) ? ' · Histórico' : ''}</small></td><td><strong>{machine?.id_interno_cliente || machine?.codigo || 'Equipo'}</strong><small>{machine ? `${machine.marca} ${machine.modelo} · ${machine.serie}` : String(row.equipo_id)}</small><small>{clientDisplayName(client)}</small></td><td><strong>{String(row.tipo || 'Servicio')}</strong><small>{orderTeamLabel(row, technicians.rows)}</small></td><td><OperationStatus value={row.estado} /></td><td><button className="button button-small" onClick={() => open(row.id)}>Ver reporte<ArrowUpRight size={14} /></button></td></tr>; })}</tbody></table></div>
        <div className="os-pagination"><span>Página {safePage} de {pageCount}</span><button className="button button-small" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Anterior</button><button className="button button-small" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)}>Siguiente</button></div>
      </>}
    </section>
    {params.has('orden') && !loading && !selected && !error && <ErrorNotice message="No se encontró el reporte o no tienes acceso a él." />}
    {canCreate && params.has('ticket') && params.get('ticket') !== dismissedTicket && !loading && !ticket && !error && <div><ErrorNotice message="No se puede crear una orden desde esta solicitud: revisa si ya tiene orden, está cerrada o cambió su asignación." /><Link className="button" to={`/tickets?ticket=${encodeURIComponent(params.get('ticket') || '')}`}>Revisar solicitud</Link></div>}
    {selected && !editor && <Modal title={`Reporte ${serviceLabel(selected)}`} wide className="os-detail-modal" onClose={close}>
      <div className="os-detail-actions">{actor.rol !== 'Técnico' && <Link className="button" aria-disabled={attachmentBusy} onClick={event => { if (attachmentBusy) event.preventDefault(); }} to={`/${actor.rol === 'Cliente' ? 'portal' : 'flota'}?equipo=${encodeURIComponent(String(selected.equipo_id))}`}>Ficha del equipo<ArrowUpRight size={15} /></Link>}<button className="button" disabled={attachmentBusy || sharing} onClick={() => window.print()}><Printer size={15} />Imprimir / PDF</button>{isOperationalOrder(selected) && (selected.estado !== 'Cancelada' && (selected.estado !== 'Completada' || manager)) && (manager || actor.rol === 'Técnico' && assignedTo(selected, actor.tecnico_id)) && <button className="button button-dark" disabled={attachmentBusy || sharing} onClick={() => setEditor(selected)}><Pencil size={15} />{selected.estado === 'Completada' ? 'Corregir reporte' : 'Editar reporte'}</button>}{manager && isOperationalOrder(selected) && selected.estado === 'Completada' && <button className="button" disabled={attachmentBusy || sharing} onClick={()=>{setReason('');setShareError('');setReopening(true);}}>Reabrir orden</button>}</div>
      {(actor.rol === 'Administrador' || manager && isOperationalOrder(selected)) && selected.cliente_id && <div className="os-sharing"><span>{selected.visible_cliente === true ? 'Visible en el portal del cliente' : 'El cliente aún no ve este reporte'}</span><button className="button button-small" disabled={sharing || attachmentBusy} onClick={share}>{selected.visible_cliente === true ? <EyeOff size={15} /> : <Eye size={15} />}{sharing ? 'Guardando…' : selected.visible_cliente === true ? 'Ocultar reporte' : 'Compartir con cliente'}</button></div>}
      <ErrorNotice message={shareError} />
      <ServiceReport order={selected} equipment={selectedEquipment} client={selectedClient} site={sites.rows.find(row => row.id === selected.sede_id)} technicians={technicians.rows} />
      {manager && isOperationalOrder(selected) && <OrderRevisionHistory id={selected.id} version={selected.fecha_actualizacion + String(attachmentBusy)}/> }
      {selected.ticket_id && <TicketPhotos key={selected.id} orderId={selected.id}/>}
      {isOperationalOrder(selected) && <AttachmentPanel orderId={selected.id} completed={selected.estado === 'Completada'} onBusy={setAttachmentBusy} editable={selected.estado !== 'Cancelada' && (manager || selected.estado !== 'Completada' && actor.rol === 'Técnico' && assignedTo(selected, actor.tecnico_id))} />}
    </Modal>}
    {reopening && selected && <Modal title={`Reabrir ${selected.codigo}`} onClose={()=>{if(!sharing)setReopening(false);}}><form onSubmit={e=>{e.preventDefault();void reopenOrder();}}><p>La orden vuelve a En proceso. Se conserva el cierre anterior en el historial; la solicitud resuelta vinculada vuelve a En revisión. El reporte quedará sin compartir hasta su revisión.</p><label className="record-field">Motivo de reapertura<textarea required minLength={8} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={sharing}/></label><ErrorNotice message={shareError}/><div className="modal-actions"><button type="submit" className="button button-dark" disabled={sharing}>{sharing?'Guardando…':'Confirmar reapertura'}</button></div></form></Modal>}
    {(editor || ticket || createFromLink) && <ServiceOrderForm key={editor && editor !== 'new' ? editor.id : ticket?.id || 'new'} row={editor && editor !== 'new' ? editor : undefined} ticket={editor ? undefined : ticket} onClose={() => { setEditor(null); if (ticket) setDismissedTicket(ticket.id); if (ticket || createFromLink) setParams({}); }} onSaved={row => { setEditor(null); setDismissedTicket(ticket?.id || ''); open(row.id); }} />}
  </div>;
}
