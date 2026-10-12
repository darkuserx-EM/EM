import { AuditDisclosure } from '../../components/AuditHistory';
import { useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, ClipboardList, Plus, CheckCircle2, Pencil } from 'lucide-react';
import { useActor, useToast } from '../../app/state';
import { ErrorNotice, Modal, useUnsavedChanges } from '../../components/ui';
import { getDataSource } from '../../data/source';
import type { EntityRecord } from '../../domain/model';
import { completedService, findingClosed, findingComponents, findingPriorities, findingStates, findingSummary, recommendationReports } from '../../domain/equipment-findings';
import { formatDate } from '../../domain/format';
import './equipment-findings.css';

const reportLabel = (row: EntityRecord) => row.orden_origen ? `OS ${row.orden_origen}` : row.codigo;
const dateLabel = (date: EntityRecord[string]) => date ? formatDate(String(date).length === 10 ? `${date}T12:00:00-06:00` : String(date)) : 'Sin fecha';

export function FindingOverview({ equipmentId, findings, services, onOpen, loading, error }: { equipmentId: string; findings: EntityRecord[]; services: EntityRecord[]; onOpen: () => void; loading: boolean; error: string }) {
  const totals = findingSummary(findings, equipmentId);
  const recommendations = recommendationReports(services, equipmentId);
  const unlinked = recommendations.filter(report => !findings.some(row => row.equipo_id === equipmentId && row.orden_origen_id === report.id)).length;
  return <section className="finding-overview" aria-label="Seguimiento del equipo"><div className="finding-overview-heading"><ClipboardList size={23} /><div><h3>Hallazgos y recomendaciones</h3></div></div>{loading ? <p role="status">Cargando seguimientos…</p> : error ? <ErrorNotice message={error} /> : <><div className="finding-overview-counts"><div><strong>{totals.active}</strong><span>En seguimiento</span></div><div><strong>{totals.pending}</strong><span>Por confirmar</span></div><div><strong>{unlinked}</strong><span>Reportes con notas sin vincular</span></div></div><button className="button button-dark" onClick={onOpen}>Revisar hallazgos y notas<ArrowRight size={16} /></button><small>Las notas históricas requieren revisión; no se cuentan automáticamente como fallas abiertas.</small></>}</section>;
}

function FindingForm({ equipment, services, row, origin, onClose, onSaved }: { equipment: EntityRecord; services: EntityRecord[]; row?: EntityRecord; origin?: EntityRecord; onClose: () => void; onSaved: (state: string) => void }) {
  const actor = useActor(); const notify = useToast(state => state.notify);
  const [openedRevision] = useState(() => getDataSource().getRevision());
  const [values, setValues] = useState<Record<string, string>>(() => ({
    descripcion: String(row?.descripcion || origin?.notas_seguridad || ''), componente: String(row?.componente || 'Por clasificar'),
    prioridad: String(row?.prioridad || 'Por definir'), estado: String(row?.estado || 'Por confirmar'), responsable: String(row?.responsable || ''),
    fecha_programada: String(row?.fecha_programada || ''), orden_origen_id: String(row?.orden_origen_id || origin?.id || ''),
    orden_resolucion_id: String(row?.orden_resolucion_id || ''), detalle_resolucion: String(row?.detalle_resolucion || ''), nota_cambio: '',
  }));
  const [initialValues] = useState(values); const guard = useUnsavedChanges(JSON.stringify(values) !== JSON.stringify(initialValues), onClose);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (key: string, value: string) => setValues(previous => ({ ...previous, [key]: value }));
  const ownServices = services.filter(service => service.equipo_id === equipment.id).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  async function save(event: FormEvent) {
    event.preventDefault();
    const submittedDate = new FormData(event.currentTarget as HTMLFormElement).get('fecha_programada');
    setValues(previous => ({ ...previous, fecha_programada: String(submittedDate || '') }));
    setBusy(true); setError('');
    try {
      if (getDataSource().getRevision() !== openedRevision) throw new Error('Hay cambios nuevos. Cierra y vuelve a abrir este formulario para revisar la información antes de guardar.');
      const fields = { ...values, fecha_programada: String(submittedDate || ''), equipo_id: equipment.id, orden_resolucion_id: values.estado === 'Resuelto' ? values.orden_resolucion_id : '', detalle_resolucion: ['Resuelto', 'Descartado'].includes(values.estado) ? values.detalle_resolucion : '' };
      const repo = getDataSource().repository('Hallazgo', actor);
      if (row) await repo.update(row.id, fields); else await repo.create(fields);
      notify(row ? 'Seguimiento actualizado.' : 'Seguimiento creado.'); onSaved(values.estado);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el seguimiento.'); }
    finally { setBusy(false); }
  }
  const choose = (key: string, label: string, options: readonly string[]) => <label>{label}<select value={values[key]} onChange={event => set(key, event.target.value)} disabled={busy}>{options.map(value => <option key={value}>{value}</option>)}</select></label>;
  return <Modal title={row ? `Editar seguimiento ${row.codigo}` : 'Nuevo seguimiento'} onClose={() => { if (!busy) guard.requestClose(); }} wide>{guard.prompt}
    <form className="finding-form" onSubmit={save}>
      <p className="finding-form-equipment">{equipment.codigo} · {equipment.id_interno_cliente || `${equipment.marca} ${equipment.modelo}`}</p>
      {origin && !row && <p className="finding-form-hint">Revisa la nota de {reportLabel(origin)} y deja aquí un solo hallazgo. Puedes crear otro seguimiento para una recomendación diferente del mismo reporte.</p>}
      <label className="finding-full">Descripción del hallazgo *<textarea rows={4} value={values.descripcion} onChange={event => set('descripcion', event.target.value)} maxLength={2000} required disabled={busy} /></label>
      {choose('componente', 'Componente', findingComponents)}{choose('prioridad', 'Prioridad', findingPriorities)}
      {choose('estado', 'Estado del seguimiento', findingStates)}
      <label>Responsable{values.estado === 'Programado' ? ' *' : ''}<input value={values.responsable} onChange={event => set('responsable', event.target.value)} placeholder="Nombre de la persona responsable" maxLength={160} required={values.estado === 'Programado'} disabled={busy} /></label>
      <label>Reporte de origen<select value={values.orden_origen_id} onChange={event => set('orden_origen_id', event.target.value)} disabled={busy || !!row || !!origin}><option value="">Sin reporte · registro manual</option>{ownServices.map(service => <option key={service.id} value={service.id}>{reportLabel(service)} · {dateLabel(service.fecha)}</option>)}</select></label>
      <label>Fecha programada{values.estado === 'Programado' ? ' *' : ''}<input type="date" name="fecha_programada" value={values.fecha_programada} onInput={event => set('fecha_programada', event.currentTarget.value)} required={values.estado === 'Programado'} disabled={busy} /></label>
      {values.estado === 'Resuelto' && <label className="finding-full">Servicio que confirma la resolución *<select value={values.orden_resolucion_id} onChange={event => set('orden_resolucion_id', event.target.value)} required disabled={busy}><option value="">Selecciona un servicio completado</option>{ownServices.filter(completedService).map(service => <option key={service.id} value={service.id}>{reportLabel(service)} · {dateLabel(service.fecha)} · {service.motivo}</option>)}</select></label>}
      {['Resuelto', 'Descartado'].includes(values.estado) && <label className="finding-full">{values.estado === 'Resuelto' ? 'Cómo se resolvió' : 'Motivo del descarte'} *<textarea rows={3} value={values.detalle_resolucion} onChange={event => set('detalle_resolucion', event.target.value)} required maxLength={500} disabled={busy} /></label>}
      {row && <label className="finding-full">Nota del cambio{values.estado !== row.estado ? ' *' : ''}<input value={values.nota_cambio} onChange={event => set('nota_cambio', event.target.value)} required={values.estado !== row.estado} maxLength={300} disabled={busy} placeholder="Explica el avance o la corrección" /></label>}
      <p className="finding-form-hint finding-full">Por confirmar conserva una observación pendiente de revisión. Activar un seguimiento requiere definir su prioridad. El estado operativo del equipo se actualiza por separado.</p>
      <div className="finding-full"><ErrorNotice message={error} /></div>
      <div className="modal-actions finding-full"><button className="button" type="button" onClick={guard.requestClose} disabled={busy}>Cancelar</button><button className="button button-dark" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar seguimiento'}</button></div>
    </form>
  </Modal>;
}

export function EquipmentFindings({ equipment, findings, services, onReport }: { equipment: EntityRecord; findings: EntityRecord[]; services: EntityRecord[]; onReport: (id: string) => void }) {
  const [section, setSection] = useState<'notes' | 'active' | 'closed'>('notes');
  const [search, setSearch] = useState(''); const [stateFilter, setStateFilter] = useState('Todos');
  const [editing, setEditing] = useState<{ row?: EntityRecord; origin?: EntityRecord } | null>(null);
  const own = findings.filter(row => row.equipo_id === equipment.id).sort((a, b) => b.fecha_actualizacion.localeCompare(a.fecha_actualizacion));
  const totals = findingSummary(own, equipment.id);
  const reports = recommendationReports(services, equipment.id);
  const match = (text: string) => text.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'));
  const visible = own.filter(row => findingClosed(row) === (section === 'closed') && (stateFilter === 'Todos' || row.estado === stateFilter) && match(`${row.codigo} ${row.descripcion} ${row.componente} ${row.responsable}`));
  const visibleReports = reports.filter(row => match(`${reportLabel(row)} ${row.notas_seguridad}`));
  return <section className="equipment-findings" aria-label="Hallazgos y recomendaciones del equipo">
    <header className="findings-heading"><div><h2>Hallazgos y notas</h2></div><button className="button button-dark" onClick={() => setEditing({})}><Plus size={16} />Nuevo seguimiento</button></header>
    <div className="findings-counters"><div><strong>{totals.active}</strong><span>En seguimiento</span></div><div className={totals.critical ? 'has-critical' : ''}><strong>{totals.critical}</strong><span>Críticos confirmados</span></div><div><strong>{totals.pending}</strong><span>Por confirmar</span></div><div><strong>{totals.closed}</strong><span>Cerrados</span></div></div>
    <div className="finding-sections" aria-label="Listas de seguimiento"><button aria-pressed={section === 'notes'} onClick={() => { setSection('notes'); setStateFilter('Todos'); }}>Recomendaciones <b>{reports.length}</b></button><button aria-pressed={section === 'active'} onClick={() => { setSection('active'); setStateFilter('Todos'); }}>Seguimientos <b>{totals.active + totals.pending}</b></button><button aria-pressed={section === 'closed'} onClick={() => { setSection('closed'); setStateFilter('Todos'); }}>Cerrados <b>{totals.closed}</b></button></div>
    <div className="finding-search"><label>Buscar en {section === 'notes' ? 'recomendaciones' : 'seguimientos'}<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Descripción, responsable o reporte" /></label>{section !== 'notes' && <label>Estado<select value={stateFilter} onChange={event => setStateFilter(event.target.value)}><option>Todos</option>{findingStates.filter(state => findingClosed({estado: state}) === (section === 'closed')).map(state => <option key={state}>{state}</option>)}</select></label>}</div>
    {section === 'notes' ? <>
      <p className="findings-review-note"><ClipboardList size={19} /><span><strong>{reports.length} reportes con recomendaciones históricas.</strong> Se muestran las notas del origen. Revisa si siguen vigentes antes de crear un hallazgo; varias notas pueden referirse al mismo problema.</span></p>
      <div className="finding-cards">{visibleReports.map(report => { const linked = own.filter(row => row.orden_origen_id === report.id); return <article key={report.id} className="recommendation-card"><div className="recommendation-meta"><span>{reportLabel(report)} · {dateLabel(report.fecha)}</span><span>{linked.length ? `${linked.length} seguimiento${linked.length === 1 ? '' : 's'} vinculado${linked.length === 1 ? '' : 's'}` : 'Sin seguimiento vinculado'}</span></div><p>{report.notas_seguridad}</p><div className="finding-card-actions"><button className="summary-link" onClick={() => onReport(report.id)}>Ver reporte completo<ArrowUpRight size={14} /></button><button className="button button-small" onClick={() => setEditing({ origin: report })}><Plus size={14} />{linked.length ? 'Agregar otro seguimiento' : 'Crear seguimiento'}</button></div></article>; })}</div>
      {!visibleReports.length && <p className="finding-empty">{search ? 'No hay recomendaciones que coincidan con la búsqueda.' : 'No hay recomendaciones registradas en los reportes de este equipo. Puedes crear un seguimiento manual.'}</p>}
    </> : <>
      {!visible.length && <div className="finding-empty"><CheckCircle2 size={30} /><h3>{search || stateFilter !== 'Todos' ? 'Sin resultados con estos filtros' : section === 'closed' ? 'Aún no hay seguimientos cerrados' : 'Aún no hay seguimientos activos'}</h3><p>{section === 'active' ? 'Revisa las recomendaciones históricas o registra un hallazgo con Nuevo seguimiento.' : 'Los hallazgos resueltos o descartados quedarán aquí con su evidencia.'}</p></div>}
      <div className="finding-cards">{visible.map(row => { const origin = services.find(report => report.id === row.orden_origen_id); const resolution = services.find(report => report.id === row.orden_resolucion_id); return <article key={row.id} className={`finding-card${row.prioridad === 'Crítica' && !findingClosed(row) && row.estado !== 'Por confirmar' ? ' critical' : ''}`}><div className="finding-card-top"><span>{row.codigo} · {row.componente}</span><span className={`finding-state${findingClosed(row) ? ' closed' : ''}`}>{row.estado}</span></div><h3>{row.descripcion}</h3><dl><div><dt>Prioridad</dt><dd>{row.prioridad}</dd></div><div><dt>Responsable</dt><dd>{row.responsable || 'Sin asignar'}</dd></div><div><dt>Programación</dt><dd>{row.fecha_programada ? dateLabel(row.fecha_programada) : 'Sin fecha acordada'}</dd></div></dl>{findingClosed(row) && <p className="finding-resolution"><strong>{row.estado === 'Resuelto' ? 'Resolución' : 'Motivo del descarte'}:</strong> {row.detalle_resolucion}</p>}<div className="finding-card-actions">{origin ? <button className="summary-link" onClick={() => onReport(origin.id)}>Origen: {reportLabel(origin)}<ArrowUpRight size={14} /></button> : <span>Registro manual</span>}{resolution && row.estado === 'Resuelto' && <button className="summary-link" onClick={() => onReport(resolution.id)}>Resolución: {reportLabel(resolution)}<ArrowUpRight size={14} /></button>}<button className="button button-small" onClick={() => setEditing({ row })}><Pencil size={14} />Actualizar</button></div><AuditDisclosure title={`Historial · ${row.actualizado_nombre || "Administración"} · ${dateLabel(row.fecha_actualizacion)}`} query={{hallazgo_id:row.id}}/></article>; })}</div>
    </>}
    <p className="findings-footer">Seguimiento interno de administración · incluye todo el historial del equipo, independiente del filtro de fechas de las otras pestañas.</p>
    {editing && <FindingForm equipment={equipment} services={services} {...editing} onClose={() => setEditing(null)} onSaved={state => { setEditing(null); setSection(findingClosed({estado: state}) ? 'closed' : 'active'); setSearch(''); setStateFilter('Todos'); }} />}
  </section>;
}
