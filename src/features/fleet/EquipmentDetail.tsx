import { EquipmentPlanning } from './EquipmentPlanning';
import { EquipmentDashboard } from './EquipmentDashboard';
import { EquipmentFindings, FindingOverview } from './EquipmentFindings';
import { EquipmentStatus, EquipmentStatusNote } from './EquipmentStatus';
import { administrativeState, maintenanceState } from '../../domain/equipment-status';
import { serviceKind } from '../../domain/vocabulary';
import { useEffect, useState } from 'react';
import { MonthlyUsageChart } from './MonthlyUsageChart';
import { ReadingChart } from './ReadingChart';
import { EquipmentSummary } from './EquipmentSummary';
import { assertAdmin } from '../../domain/permissions';
import { ClipboardList, LayoutDashboard, PanelsTopLeft, Camera, ArrowLeft, ChevronDown, Download, Gauge, MapPin, Wrench, Clock3, Package, SlidersHorizontal, TrendingUp, Pencil } from 'lucide-react';
import { useActor, useRows, useToast } from '../../app/state';
import { EmptyState, ErrorNotice, Status } from '../../components/ui';
import { equipmentHistory, latestEquipmentReading } from '../../domain/equipment-history';
import { formatDate, formatHourMeter, formatMoney, formatNumber, formatTime } from '../../domain/format';
import type { EntityRecord } from '../../domain/model';
import { EquipmentDataDrawer } from './EquipmentDataDrawer';
import { getDataSource, serverMode } from '../../data/source';
import { EquipmentPhoto, EquipmentImageGallery } from '../records/EquipmentImages';
import { EstimateNote, ImportedReportDetails } from './ImportedReportDetails';
import './equipment-file.css';

export function EquipmentDetail({ equipment, clients, onBack, onEdit, initialView }: { equipment: EntityRecord; clients: EntityRecord[]; onBack: () => void; onEdit?: () => void; initialView?: 'maintenance' }) {
  const findings = useRows('Hallazgo', true);
  const sites = useRows('Sede'); const audit = useRows('Bitacora', true);
  const actor = useActor(); const notify = useToast(state => state.notify);
  const services = useRows('OrdenServicio', true); const readings = useRows('LecturaHorometro', true); const parts = useRows('OTRepuesto'); const labor = useRows('OTHoras'); const technicians = useRows('Tecnico');
  const [selectedView, setView] = useState<'summary' | 'maintenance' | 'findings' | 'repairs' | 'usage' | 'images'>(actor.rol === 'Administrador' ? initialView || 'summary' : 'repairs');
  const view = ['summary', 'findings', 'maintenance'].includes(selectedView) && actor.rol !== 'Administrador' ? 'repairs' : selectedView;
  const [design, setDesign] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState('');
  const openReport = (id: string) => { setSelectedReport(id); setView('repairs'); };
  useEffect(() => {
    if (view !== 'repairs' || !selectedReport) return;
    const report = document.getElementById(`equipment-report-${selectedReport}`);
    report?.scrollIntoView({ block: 'start' });
    report?.querySelector('summary')?.focus({ preventScroll: true });
  }, [view, selectedReport]);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [exporting, setExporting] = useState(false);
  const invalidRange = !!from && !!to && from > to;
  const history = equipmentHistory(equipment.id, services.rows, readings.rows, parts.rows, labor.rows, from, to);
  const latest = latestEquipmentReading(equipment.id, readings.rows);
  const admin = actor.rol === 'Administrador';
  const loading = [services, readings, parts, labor, technicians].some(result => result.loading);
  const error = [services, readings, parts, labor, technicians].find(result => result.error)?.error ?? '';
  const client = clients.find(row => row.id === equipment.cliente_id);
  const site = sites.rows.find(row => row.id === equipment.sede_id);
  const totalCost = history.repairs.reduce((sum, row) => sum + Number(row.costo_repuestos || 0) + Number(row.costo_mano_obra || 0), 0);
  const totalLabor = history.labor.reduce((sum, row) => sum + Number(row.horas || 0), 0);
  const imported = history.repairs.filter(row => row.importado === true);
  const hasOdometer = history.usage.some(({ row }) => typeof row.odometro_millas === 'number');
  const hasCosts = history.repairs.some(row => typeof row.costo_repuestos === 'number' || typeof row.costo_mano_obra === 'number');
  const incompleteCosts = history.repairs.some(row => typeof row.costo_repuestos !== 'number' || typeof row.costo_mano_obra !== 'number');
  const exportHistory = async () => {
    setExporting(true);
    try { assertAdmin(actor); const { downloadWorkbook, makeEquipmentHistoryWorkbook } = await import('../../data/excel'); const [exported] = await getDataSource().repository('Equipo',actor).export(row => row.id === equipment.id); if (!exported) throw new Error('El equipo ya no está disponible.'); downloadWorkbook(makeEquipmentHistoryWorkbook(exported, history, from, to), `Portal-EM-${equipment.codigo}-historial.xlsx`); }
    catch (cause) { notify(`No se pudo exportar el historial: ${cause instanceof Error ? cause.message : 'intenta nuevamente'}`); }
    finally { setExporting(false); }
  };
  const statePanel = <section className="panel equipment-state-panel" aria-label="Estado actual del equipo"><h2>Estado y mantenimiento</h2><p>Aviso: {maintenanceState(equipment)}</p>{admin && <p>Situación administrativa: {administrativeState(equipment) || 'Sin especificar'}{equipment.estado === 'En taller' && !equipment.estado_administrativo ? ' · Registro anterior: En taller' : ''}</p>}<EquipmentStatusNote equipment={equipment} showAuthor={admin} />{admin && <details><summary>Historial de cambios de estado</summary>{audit.error ? <ErrorNotice message={audit.error} /> : audit.loading ? <p>Cargando cambios…</p> : audit.rows.some(row => row.equipo_id === equipment.id && row.accion === 'Cambio de estado') ? <ol>{audit.rows.filter(row => row.equipo_id === equipment.id && row.accion === 'Cambio de estado').sort((a,b) => String(b.fecha_creacion).localeCompare(String(a.fecha_creacion))).map(row => <li key={row.id}>{row.detalle}<small>{formatDate(String(row.fecha_creacion))} · {formatTime(String(row.fecha_creacion))} · {row.registrado_por || row.creado_por}</small>{row.motivo && <p>Motivo: {row.motivo}</p>}</li>)}</ol> : <p>Aún no hay cambios de estado registrados con esta clasificación.</p>}</details>}</section>;
  const periodControls = <div className="history-filters"><SlidersHorizontal size={16} aria-hidden="true" /><label>Desde<input type="date" value={from} onInput={event => setFrom(event.currentTarget.value)} /></label><label>Hasta<input type="date" value={to} onInput={event => setTo(event.currentTarget.value)} /></label>{(from || to) ? <button className="history-clear" onClick={() => { setFrom(''); setTo(''); }}>Quitar filtros</button> : <span className="history-range-label">Todo el historial</span>}</div>;
  return <div className={`equipment-detail equipment-file${admin ? ' equipment-dashboard' : ''}`}>
    <div className="history-back-row"><button className="history-back" onClick={onBack}><ArrowLeft size={16} />Volver a la flota</button></div>
    <header className="equipment-heading"><div className="equipment-title"><EquipmentPhoto equipment={equipment} large /><div><h1>{equipment.marca} {equipment.modelo}</h1><p className="equipment-identity">{equipment.codigo} · {equipment.propiedad}</p><p>{equipment.tipo} <span>·</span> Serie {equipment.serie}</p>{equipment.id_interno_cliente && <p>ID interno del cliente: <strong>{equipment.id_interno_cliente}</strong></p>}</div></div><div className="equipment-heading-actions">{admin && <button className="button" aria-pressed={design && view === 'summary'} onClick={() => { setFrom(''); setTo(''); setView('summary'); setDesign(true); }}><PanelsTopLeft size={15} />Diseñar ficha</button>}{onEdit && <button className="button button-dark" onClick={onEdit}><Pencil size={15} />Editar equipo</button>}<EquipmentStatus equipment={equipment} />{admin && <button className="button" onClick={exportHistory} disabled={exporting || loading || invalidRange || !!error}><Download size={15} />{exporting ? 'Preparando…' : serverMode ? 'Exportar historial (sin fotos)' : 'Exportar historial'}</button>}</div>
      <div className="equipment-context">
        <div><span>Cliente</span><strong>{client?.nombre_comercial || client?.nombre || 'Sin asignación'}</strong></div>
        <div><span>Sede</span><strong>{sites.error ? 'No disponible' : !sites.ready ? 'Cargando…' : site?.nombre || 'Sin sede asignada'}</strong></div>
        <button className="equipment-current-reading" onClick={() => { setFrom(''); setTo(''); setSelectedReport(''); setView('usage'); }} aria-label="Consultar uso y horómetro">
          <span>Último horómetro</span><strong>{readings.error ? 'No disponible' : !readings.ready ? 'Cargando…' : formatHourMeter(latest?.valor ?? equipment.horometro)}</strong>
          <small>{readings.error ? 'Reintenta la consulta' : !readings.ready ? 'Consultando lecturas' : latest ? formatDate(String(latest.fecha)) + (latest.es_estimado === true ? ' · Estimado' : ' · Registrado') : 'Sin fecha de lectura registrada'}</small>
        </button>
        <button className="button equipment-data-trigger" aria-haspopup="dialog" aria-expanded={dataOpen} onClick={() => setDataOpen(true)}><ClipboardList size={16} />Datos del equipo</button>
      </div>
    </header>
    {!serverMode && <div className="history-demo-note"><span className="plain-tag">DATOS FICTICIOS</span></div>}
    {admin ? <details className="dashboard-state-disclosure"><summary>Estado y mantenimiento · {maintenanceState(equipment)}</summary>{statePanel}</details> : statePanel}
    <div className="history-layout"><div className="history-main">
      <div className="history-switch" aria-label="Historial del equipo">{admin && <button aria-pressed={view === 'summary'} onClick={() => setView('summary')}><LayoutDashboard size={17} />Resumen</button>}{admin && <button aria-pressed={view === 'maintenance'} onClick={() => setView('maintenance')}><Wrench size={17} />Mantenimiento</button>}{admin && <button aria-pressed={view === 'findings'} onClick={() => setView('findings')}><ClipboardList size={17} />Hallazgos y notas</button>}<button aria-pressed={view === 'repairs'} onClick={() => setView('repairs')}><Wrench size={17} />Reparaciones y servicios</button><button aria-pressed={view === 'usage'} onClick={() => setView('usage')}><Gauge size={17} />Uso y horómetro</button><button aria-pressed={view === 'images'} onClick={() => setView('images')}><Camera size={17} />Fotografías y placa</button></div>
      {view === 'images' ? <EquipmentImageGallery equipment={equipment} onEdit={onEdit} /> : view === 'maintenance' && admin ? <><ErrorNotice message={services.error || readings.error} />{services.ready && readings.ready && !services.error && !readings.error ? <EquipmentPlanning equipment={equipment} services={services.rows} readings={readings.rows} onReport={id => { setFrom(''); setTo(''); openReport(id); }} /> : <p role="status">Cargando planificación…</p>}</> : view === 'findings' && admin ? <><ErrorNotice message={findings.error || services.error || audit.error} />{!findings.ready || !services.ready || !audit.ready ? <p role="status">Cargando seguimientos…</p> : !findings.error && !services.error && <EquipmentFindings equipment={equipment} findings={findings.rows} services={services.rows} audit={audit.rows} onReport={id => { setFrom(''); setTo(''); openReport(id); }} />}</> : <>{(view !== 'summary' || invalidRange || loading || !!error) && periodControls}
      <ErrorNotice message={invalidRange ? 'La fecha Desde debe ser anterior o igual a Hasta.' : error} />
      {loading ? <p className="history-loading" role="status">Cargando historial…</p> : !invalidRange && !error && <>
        {view === 'summary' ? <EquipmentDashboard followUp={<FindingOverview equipmentId={equipment.id} findings={findings.rows} services={services.rows} loading={findings.loading} error={findings.error} onOpen={() => setView('findings')} />} equipment={equipment} services={services.rows} readings={readings.rows} findings={findings.rows} findingsReady={findings.ready} findingsError={findings.error} onPlan={() => setView('maintenance')} onFindings={() => setView('findings')} onServices={() => { setFrom(''); setTo(''); setSelectedReport(''); setView('repairs'); }} render={dashboard => <EquipmentSummary monthlyUsage={<MonthlyUsageChart equipmentId={equipment.id} readings={readings.rows} from={from} to={to} />} periodFilters={periodControls} onPlan={() => setView('maintenance')} history={history} dashboard={dashboard} design={design} onCloseDesign={() => setDesign(false)} onReport={openReport} onView={next => { setSelectedReport(''); setView(next); }} />} /> : <><div className="history-metrics"><div><span>Servicios en el período</span><strong>{history.repairs.length.toString().padStart(2, '0')}</strong><small>{history.repairs.filter(row => row.tipo === 'Correctivo').length} correctivos · {history.repairs.filter(row => ['Preventivo','Mantenimiento Preventivo'].includes(String(row.tipo))).length} preventivos{history.repairs.some(row => row.tipo === 'Mantenimiento Mayor') && ` · ${history.repairs.filter(row => row.tipo === 'Mantenimiento Mayor').length} mayores`}{history.repairs.some(row => row.tipo === 'Emergencia') && ` · ${history.repairs.filter(row => row.tipo === 'Emergencia').length} emergencias`}</small></div><div><span>Uso entre lecturas seleccionadas</span><strong>{history.hoursUsed === null ? '—' : formatNumber(history.hoursUsed)} <em>h</em></strong>{history.hoursUsedEstimated && <small>Uso estimado</small>}<small>{history.usage.length >= 2 ? `${formatDate(String(history.usage[0].row.fecha))} → ${formatDate(String(history.usage.at(-1)!.row.fecha))}` : 'Se necesitan dos lecturas comparables'}</small></div><div><span>Mano de obra registrada</span><strong>{history.labor.length ? formatNumber(totalLabor) : '—'} <em>h</em></strong><small>{history.labor.length ? 'Tiempo de atención de los técnicos' : 'Sin horas de técnicos registradas'}</small></div></div>
        {imported.length > 0 && <p className="history-import-note">{imported.length} reportes históricos importados en este período. Se conservan las notas y los estados del origen. Las lecturas estimadas están señaladas y mantienen su valor original.</p>}
        {view === 'repairs' ? <section aria-label="Reparaciones y servicios del equipo">
          {admin && <div className="equipment-period-cost" aria-label="Costos del período seleccionado"><div><span>Costos del período</span><strong>{hasCosts ? formatMoney(totalCost) : 'Sin registrar'}</strong></div><p>{hasCosts ? incompleteCosts ? 'Total parcial: faltan costos por registrar.' : 'Repuestos y mano de obra registrados.' : 'El historial no incluye importes; no se han supuesto costos.'}<small>Solo administración · según el filtro de fechas</small></p></div>}
          <div className="history-section-heading"><div><h2>Reparaciones y servicios</h2></div><span>{history.repairs.length} registros</span></div>
          {history.repairs.length ? <div className="repair-list">{history.repairs.map((repair, index) => {
            const usedParts = history.parts.filter(row => row.orden_id === repair.id); const usedLabor = history.labor.filter(row => row.orden_id === repair.id);
            const technician = technicians.rows.find(row => row.id === repair.tecnico_id);
            return <details className="repair-card" id={`equipment-report-${repair.id}`} key={repair.id} open={selectedReport ? repair.id === selectedReport : index === 0}>
              <summary><span className={`repair-kind ${['Correctivo','Emergencia'].includes(serviceKind(repair)) ? 'corrective' : ''}`}><Wrench size={18} /></span><span className="repair-summary"><span className="repair-meta">{formatDate(String(repair.fecha))}<span>·</span>{repair.orden_origen ? `OS ${repair.orden_origen}` : repair.codigo}<span>·</span>{repair.tipo}</span><strong>{repair.motivo}</strong><span className="repair-subtitle">{repair.tecnicos || technician?.nombre || 'Técnico no registrado'}<span>·</span>{typeof repair.horometro === 'number' && Number.isFinite(repair.horometro) ? `${formatNumber(repair.horometro)} h de horómetro` : 'Sin lectura de horómetro'}{repair.horometro_estimado === true && <span className="estimate-tag">Estimado</span>}</span></span><ChevronDown size={18} className="repair-chevron" /></summary>
              <div className="repair-body"><div className="repair-status-line"><Status value={String(repair.estado)} /><span><MapPin size={13} />{repair.ubicacion}</span></div><div className="repair-description"><div><h3>{repair.importado ? 'Tipo de falla registrado' : 'Diagnóstico'}</h3><p>{repair.diagnostico || 'Sin diagnóstico registrado.'}</p></div><div><h3>{repair.importado ? 'Trabajo descrito en el reporte' : 'Trabajo realizado'}</h3><p>{repair.trabajo || 'Sin trabajo registrado.'}</p></div></div>
                <div className="repair-resources"><div><h3><Package size={14} />Repuestos y materiales</h3>{usedParts.length ? <ul>{usedParts.map(part => <li key={part.id}><span>{part.descripcion}</span><strong>× {formatNumber(Number(part.cantidad))}</strong></li>)}</ul> : repair.importado ? <div className="repair-source-materials"><p><strong>Insumos:</strong> {repair.insumos_origen || 'Sin detalle en el origen.'}</p><p><strong>Repuestos:</strong> {repair.repuestos_origen || 'Sin detalle en el origen.'}</p></div> : <p>Sin repuestos registrados.</p>}</div><div><h3><Clock3 size={14} />Mano de obra</h3>{usedLabor.length ? <ul>{usedLabor.map(row => <li key={row.id}><span>{technicians.rows.find(tech => tech.id === row.tecnico_id)?.nombre ?? 'Técnico'}</span><strong>{formatNumber(Number(row.horas))} h</strong></li>)}</ul> : <p>Sin horas registradas.</p>}</div></div>
                <ImportedReportDetails report={repair} />
                {admin && <div className="repair-cost"><span>Costo interno registrado</span><span>Repuestos {typeof repair.costo_repuestos === 'number' ? formatMoney(repair.costo_repuestos) : 'sin registrar'} <span>·</span> Mano de obra {typeof repair.costo_mano_obra === 'number' ? formatMoney(repair.costo_mano_obra) : 'sin registrar'}</span>{typeof repair.costo_repuestos === 'number' && typeof repair.costo_mano_obra === 'number' && <strong>{formatMoney(repair.costo_repuestos + repair.costo_mano_obra)}</strong>}</div>}
              </div>
            </details>;
          })}</div> : <div className="panel"><EmptyState illustration={<EquipmentPhoto equipment={equipment} large />} title={from || to ? "Sin servicios en este período" : "Aún no hay servicios registrados"} description={from || to ? "Cambia las fechas para consultar otros registros de este equipo." : "Las reparaciones y servicios de este equipo aparecerán aquí cuando se registren."} /></div>}
        </section> : <section aria-label="Uso y horómetro del equipo"><div className="history-section-heading"><div><h2>Uso y horómetro</h2></div><TrendingUp size={20} /></div>
          <div className="panel meter-panel"><div className="meter-heading"><h3>Horómetro acumulado <span>· horas</span></h3><span>{history.usage.length} lecturas</span></div><ReadingChart history={history} onReport={openReport} /><p className="meter-note">El uso corresponde a la diferencia entre lecturas. No hay medición de turnos, días sin lectura ni disponibilidad entre lecturas.{history.usage.some(({row}) => row.es_estimado === true) && ' Los puntos ámbar son estimaciones, no lecturas verificadas. Los intervalos que dependen de ellos también son estimados.'}</p></div>
          {history.usage.length ? <div className="panel reading-panel"><div className="reading-heading"><h3>Bitácora de lecturas</h3><span>Más recientes primero</span></div><div className="table-scroll reading-scroll"><table className={`data-table reading-table${hasOdometer ? ' with-odometer' : ''}`}><thead><tr><th>Fecha / origen</th><th className="numeric">Horómetro</th>{hasOdometer && <th className="numeric">Odómetro H3 · millas</th>}<th className="numeric">Uso desde lectura anterior</th><th>Registrado por / ubicación</th></tr></thead><tbody>{[...history.usage].reverse().map(({ row, previous, delta, estimated }) => <tr key={row.id}><td><strong>{formatDate(String(row.fecha))} <small>{formatTime(String(row.fecha))}</small></strong><small>{row.origen}{row.orden_id ? ` · ${services.rows.find(order => order.id === row.orden_id)?.codigo ?? 'OT'}` : ''}</small></td><td className="numeric mono">{formatNumber(Number(row.valor))} h{row.es_estimado === true && <EstimateNote original={row.valor_original} note={row.nota_estimacion} unit="h" />}</td>{hasOdometer && <td className="numeric mono">{typeof row.odometro_millas === 'number' ? formatNumber(row.odometro_millas) : '—'}{row.odometro_estimado === true && <EstimateNote original={row.odometro_original} note={row.odometro_nota_estimacion} unit="millas" />}</td>}<td className="numeric mono"><strong>{delta === null ? '—' : `+${formatNumber(delta)} h`}</strong>{delta !== null && estimated && <small className="estimate-tag">Uso estimado</small>}<small>{previous ? delta === null ? 'Lectura a revisar' : `Desde ${formatDate(String(previous.fecha))}` : 'Primera lectura'}</small></td><td>{row.registrado_por}<small>{row.ubicacion}</small></td></tr>)}</tbody></table></div></div> : <div className="panel"><EmptyState illustration={<EquipmentPhoto equipment={equipment} large />} title="Sin lecturas en este período" description="Selecciona otras fechas para consultar el horómetro de este equipo." /></div>}
        </section>}
        </>}
      </>}
      </>}
    </div></div>
    {dataOpen && <EquipmentDataDrawer equipment={equipment} client={client} site={site} siteError={sites.error} sitesReady={sites.ready} onClose={() => setDataOpen(false)} />}
  </div>;
}
