import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, CalendarDays, FileText, Forklift, QrCode, Ticket } from 'lucide-react';
import { useActor, useRows } from '../../app/state';
import { Brand, EmptyState, ErrorNotice, Modal, SectionTitle } from '../../components/ui';
import { formatHourMeter, formatNumber } from '../../domain/format';
import { filterEquipmentStatus, operationalState } from '../../domain/equipment-status';
import { clientDisplayName } from '../../domain/client-profile';
import { EquipmentImageGallery, EquipmentPhoto } from '../records/EquipmentImages';
import { EquipmentStatus, EquipmentStatusNote, FleetSummary, FleetFilters } from '../fleet/EquipmentStatus';
import { MonthlyUsageChart } from '../fleet/MonthlyUsageChart';
import { operationDateLabel, operationDay, serviceLabel } from '../operations/operations-ui';
import { OperationStatus } from '../operations/OperationStatus';
import '../operations/operations.css';
import '../operations/client-portal.css';

export function ClientPortal() {
  const actor = useActor(); const clients = useRows('Cliente', true); const query = useRows('Equipo', true); const readings = useRows('LecturaHorometro', true); const orders = useRows('OrdenServicio', true); const tickets = useRows('Ticket', true);
  const [params, setParams] = useSearchParams(); const [search, setSearch] = useState(''); const [detailTab, setDetailTab] = useState('Resumen'); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [status, setStatus] = useState('Todos'); const [maintenance, setMaintenance] = useState('Todos'); const [includeRetired, setIncludeRetired] = useState(false); const [page, setPage] = useState(0);
  const ownEquipment = query.rows.filter(row => row.cliente_id === actor.cliente_id);
  const scope = filterEquipmentStatus(ownEquipment, 'Todos', 'Todos', includeRetired);
  const equipment = filterEquipmentStatus(scope, status, maintenance, true).filter(row => [row.codigo, row.id_interno_cliente, row.marca, row.modelo, row.serie].join(' ').toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')));
  const visibleReports = orders.rows.filter(row => row.cliente_id === actor.cliente_id && row.visible_cliente === true);
  const ownTickets = tickets.rows.filter(row => row.cliente_id === actor.cliente_id);
  const activeTickets = ownTickets.filter(row => !['Resuelto', 'Cancelado'].includes(String(row.estado)));
  const today = operationDay(new Date().toISOString());
  const scheduled = visibleReports.filter(row => row.schema_operacion === 1 && row.estado === 'Programada' && String(row.fecha_programada) >= today).sort((a, b) => String(a.fecha_programada).localeCompare(String(b.fecha_programada)));
  const selected = ownEquipment.find(row => row.id === params.get('equipo'));
  const selectedReadings = readings.rows.filter(row => row.equipo_id === selected?.id && typeof row.valor === 'number').sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const selectedReports = visibleReports.filter(row => row.equipo_id === selected?.id && (!from || operationDay(row.fecha || row.fecha_programada) >= from) && (!to || operationDay(row.fecha || row.fecha_programada) <= to)).sort((a, b) => String(b.fecha || b.fecha_programada).localeCompare(String(a.fecha || a.fecha_programada)));
  const latestReading = (id: string) => readings.rows.filter(row => row.equipo_id === id && typeof row.valor === 'number').sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
  const queries = [clients, query, readings, orders, tickets]; const loading = queries.some(item => !item.ready); const error = queries.find(item => item.error)?.error || '';
  const open = (id: string, tab = 'Resumen') => { setDetailTab(tab); setFrom(''); setTo(''); setParams({ equipo: id }); };
  const company = clients.rows.find(row => row.id === actor.cliente_id);
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(equipment.length / 10) - 1));
  const unknown = scope.filter(row => operationalState(row) === 'Pendiente de revisión').length;
  return <div className="client-portal em-client-portal">
    <SectionTitle eyebrow="PORTAL DEL CLIENTE" title={company ? clientDisplayName(company) : 'Mi flota'} description="Consulta tus equipos, revisa los trabajos realizados y solicita atención."><Link className="button button-dark" to="/tickets"><Ticket size={16} />Solicitar servicio</Link></SectionTitle>
    <div className="client-access-cards"><Link to="/tickets"><Ticket size={20} /><div><strong>{loading ? '…' : activeTickets.length}</strong><span>Solicitudes en atención</span></div><ArrowUpRight size={17} /></Link><Link to="/ordenes"><FileText size={20} /><div><strong>{loading ? '…' : visibleReports.length}</strong><span>Reportes disponibles</span></div><ArrowUpRight size={17} /></Link><Link to="/calendario"><CalendarDays size={20} /><div><strong>{scheduled[0] ? operationDateLabel(scheduled[0].fecha_programada) : 'Sin visita programada'}</strong><span>{scheduled[0] ? 'Próxima atención compartida' : 'Consulta el calendario de tu flota'}</span></div><ArrowUpRight size={17} /></Link></div>
    <ErrorNotice message={error} />
    <FleetSummary equipment={scope} selected={status} onSelect={value => { setStatus(value); setPage(0); }} loading={loading} />
    {!loading && unknown > 0 && <p className="client-state-notice">{unknown} {unknown === 1 ? 'equipo pendiente' : 'equipos pendientes'} de confirmar su estado. Esto no significa que estén fuera de servicio.</p>}
    <section className="panel client-fleet-panel"><div className="client-fleet-toolbar"><div><h2>Equipos de tu empresa <span>{loading ? '…' : equipment.length}</span></h2><p>Abre una ficha para consultar uso, fotografías e historial.</p></div><label>Buscar equipo<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="ID, código, modelo o serie" /></label></div>
    <FleetFilters status={status} onStatus={value => { setStatus(value); setPage(0); }} maintenance={maintenance} onMaintenance={value => { setMaintenance(value); setPage(0); }} includeRetired={includeRetired} onIncludeRetired={value => { setIncludeRetired(value); setPage(0); }} />
      {loading ? <p role="status" className="os-loading">Cargando tu flota…</p> : <div className="client-machine-list">{equipment.slice(pageIndex * 10, pageIndex * 10 + 10).map(row => { const latest = latestReading(row.id); const reportCount = visibleReports.filter(report => report.equipo_id === row.id).length; return <article key={row.id} className="client-machine-row"><div className="client-machine-heading"><EquipmentPhoto equipment={row} /><div><span>{row.id_interno_cliente ? `ID ${row.id_interno_cliente} · ` : ''}{row.codigo}</span><h3>{[row.marca, row.modelo].filter(Boolean).join(' ') || 'Equipo por completar'}</h3><small>Serie {row.serie || 'por confirmar'}</small></div></div><div className="client-machine-state"><small className="client-field-label">Estado reportado</small><EquipmentStatus equipment={row} /></div><div className="client-machine-reading"><small className="client-field-label">Último horómetro</small><strong>{formatHourMeter(latest?.valor ?? row.horometro)}</strong><small>{latest ? `${operationDateLabel(latest.fecha)}${latest.es_estimado ? ' · estimada' : ''}` : 'Fecha pendiente de actualizar'}</small></div><div className="client-machine-actions"><button className="button" aria-label={`Ver ficha ${row.id_interno_cliente || row.codigo}`} onClick={() => open(row.id)}>Ver ficha<ArrowUpRight size={15} /></button><button className="client-reports-link" aria-label={`Ver reportes ${row.id_interno_cliente || row.codigo}`} onClick={() => open(row.id, 'Servicios')}>{reportCount} {reportCount === 1 ? 'reporte compartido' : 'reportes compartidos'}</button></div></article>; })}</div>}
      {!loading && !error && !equipment.length && <EmptyState title="Sin equipos con estos filtros" description="Selecciona todos los estados y avisos para consultar tu flota." />}
      {!loading && equipment.length > 0 && <div className="client-pagination"><span>{pageIndex * 10 + 1}–{Math.min((pageIndex + 1) * 10, equipment.length)} de {equipment.length} equipos</span><div><button className="button button-small" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>Anterior</button><button className="button button-small" disabled={(pageIndex + 1) * 10 >= equipment.length} onClick={() => setPage(pageIndex + 1)}>Siguiente</button></div></div>}
    </section>
    {params.has('equipo') && !selected && !loading && !error && <ErrorNotice message="El equipo no está disponible para esta cuenta." />}
    {selected && <Modal title={`${selected.codigo}${selected.id_interno_cliente ? ` · ${selected.id_interno_cliente}` : ''} · ${selected.marca} ${selected.modelo}`} wide className="client-equipment-detail" onClose={() => setParams({})}>
      <div className="client-detail-context"><EquipmentStatus equipment={selected} /><span>Serie {selected.serie}</span><span>{selected.tipo}</span></div><EquipmentStatusNote equipment={selected} />
      <nav className="client-detail-tabs" aria-label="Información del equipo">{['Resumen', 'Uso', 'Servicios', 'Fotografías'].map(tab => <button type="button" key={tab} aria-pressed={detailTab === tab} onClick={() => setDetailTab(tab)}>{tab}</button>)}</nav>
      {detailTab === 'Resumen' && <><dl className="os-report-meta"><div><dt>Último horómetro</dt><dd>{formatHourMeter(selectedReadings[0]?.valor ?? selected.horometro)}</dd></div><div><dt>Fecha de lectura</dt><dd>{operationDateLabel(selectedReadings[0]?.fecha)}</dd></div><div><dt>Reportes compartidos</dt><dd>{visibleReports.filter(row => row.equipo_id === selected.id).length}</dd></div><div><dt>Capacidad</dt><dd>{typeof selected.capacidad_lb === 'number' ? `${formatNumber(selected.capacidad_lb)} lb` : 'Sin registrar'}</dd></div><div><dt>Altura de elevación</dt><dd>{typeof selected.altura_elevacion_in === 'number' ? `${selected.altura_elevacion_in} pulgadas · ${formatNumber(Math.round(selected.altura_elevacion_in * .0254 * 100) / 100)} m` : 'Sin registrar'}</dd></div><div><dt>Alimentación</dt><dd>{selected.combustible || (selected.voltaje ? `${selected.voltaje} V` : 'Sin registrar')}</dd></div></dl><div className="client-detail-links"><Link className="button" to="/tickets"><Ticket size={15} />Mis solicitudes</Link><Link className="button" to="/calendario"><CalendarDays size={15} />Ver agenda</Link></div><p className="os-help">El estado corresponde a la última actualización reportada. Revisa las notas de seguridad antes de operar el equipo.</p></>}
      {['Uso', 'Servicios'].includes(detailTab) && <div className="client-period"><label>Desde<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>Hasta<input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></label><button className="button button-small" onClick={() => { setFrom(''); setTo(''); }}>Todo el historial</button></div>}
      {detailTab === 'Uso' && <MonthlyUsageChart equipmentId={selected.id} readings={readings.rows} from={from} to={to} />}
      {detailTab === 'Servicios' && (selectedReports.length ? <div className="client-report-list">{selectedReports.map(report => <Link key={report.id} to={`/ordenes?orden=${encodeURIComponent(report.id)}`}><div><strong>{serviceLabel(report)} · {report.tipo || 'Servicio'}</strong><p>{operationDateLabel(report.fecha || report.fecha_programada)} · {report.sintoma || report.motivo || 'Ver diagnóstico y trabajo'}</p></div><OperationStatus value={report.estado} /><ArrowUpRight size={16} /></Link>)}</div> : <EmptyState title="Aún no hay reportes compartidos" description="Los reportes aprobados para tu consulta aparecerán aquí. Puedes ajustar el período." />)}
      {detailTab === 'Fotografías' && <EquipmentImageGallery equipment={selected} />}
    </Modal>}
    <div className="portal-bottom"><span>Expertos en Montacargas, S.A.</span><span>Siempre en movimiento<ArrowUpRight size={15} /></span></div>
  </div>;
}
export function OperatorPreview() {
  return <div className="operator-preview client-theme"><header><Brand /></header><main><span className="portal-eyebrow">REVISIÓN DIARIA · VISTA PREVIA</span><div className="operator-symbol"><QrCode size={64} strokeWidth={1.2} /></div><h1>Un buen día<br />empieza con<br /><em>una revisión.</em></h1><p>Este será el acceso sin cuenta para revisar un equipo desde el celular. El formulario, el QR y el registro de horómetro se construirán en la etapa 7.</p><div className="operator-placeholder"><Forklift size={23} /><div><strong>TCL-001</strong><small>Equipo ficticio de demostración</small></div></div><Link className="button button-orange" to="/inicio"><ArrowLeft size={17} />Volver al portal</Link></main><footer>EXPERTOS EN MONTACARGAS · GUATEMALA</footer></div>;
}
