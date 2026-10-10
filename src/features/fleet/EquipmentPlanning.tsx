import { useState, type FormEvent } from 'react';
import { CalendarDays, Settings2, History, ArrowUpRight } from 'lucide-react';
import { useActor, useRows, useToast } from '../../app/state';
import { ErrorNotice, Modal } from '../../components/ui';
import { getDataSource } from '../../data/source';
import type { EntityRecord, Scalar } from '../../domain/model';
import { currentPlan, planTypes, planService, projectPlan, todayGT, planIntervalLimits } from '../../domain/maintenance-plan';
import { localDay } from '../../domain/equipment-history';
import { formatDate, formatNumber } from '../../domain/format';
import './equipment-planning.css';
import { PlanCycle } from './PlanCycle';
import { planDate } from './PlanCycle';
export { planDate } from './PlanCycle';

const reportName = (row: EntityRecord) => row.orden_origen ? `OS ${row.orden_origen}` : row.codigo;

function PlanForm({ equipment, type, current, services, onClose }: { equipment: EntityRecord; type: string; current?: EntityRecord; services: EntityRecord[]; onClose: () => void }) {
  const actor = useActor(); const notify = useToast(state => state.notify);
  const [revision] = useState(() => getDataSource().getRevision());
  const [values, setValues] = useState<Record<string, string>>(() => ({ criterio: String(current?.criterio || 'Horas'), intervalo: String(current?.intervalo || (type === 'Mayor' ? 2000 : 250)), estado_plan: String(current?.estado_plan || 'Activo'), base_origen: String(current?.base_origen || 'Pendiente'), base_orden_id: String(current?.base_orden_id || ''), base_fecha: String(current?.base_fecha || ''), base_horas: typeof current?.base_horas === 'number' ? String(current.base_horas) : '', base_calidad: String(current?.base_calidad || 'Registrada'), responsable: String(current?.responsable || ''), motivo: '' }));
  const [customInterval, setCustomInterval] = useState(() => !!current && !(type === 'Mayor' ? [2000] : current.criterio === 'Días' ? [30, 60, 90] : [250]).includes(Number(current.intervalo)));
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const eligible = services.filter(row => planService(row, equipment.id, type)).sort((a,b) => String(b.fecha).localeCompare(String(a.fecha)));
  const source = eligible.find(row => row.id === values.base_orden_id);
  const set = (key: string, value: string) => { setDirty(true); setValues(previous => ({ ...previous, [key]: value })); if (key.startsWith('base_') || key === 'criterio' || key === 'intervalo') setConfirmed(false); };
  function requestClose() {
    if (busy) return;
    if (dirty) setDiscard(true); else onClose();
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const date = new FormData(event.currentTarget).get('base_fecha');
    setBusy(true); setError('');
    try {
      if (getDataSource().getRevision() !== revision) throw new Error('Hay cambios nuevos. Cierra y vuelve a abrir este formulario antes de guardar.');
      const pending = values.base_origen === 'Pendiente'; const fromService = values.base_origen === 'Servicio';
      const fields: Record<string, Scalar> = { ...values, schema_plan: 1, equipo_id: equipment.id, tipo_plan: type, intervalo: Number(values.intervalo), base_confirmada: !pending && confirmed,
        base_fecha: pending ? '' : fromService && source ? localDay(String(source.fecha)) : String(date || values.base_fecha),
        base_horas: pending || values.criterio === 'Días' ? null : fromService ? (typeof source?.horometro === 'number' ? source.horometro : null) : values.base_horas === '' ? null : Number(values.base_horas),
        base_calidad: pending ? '' : fromService ? (values.criterio === 'Horas' && source?.horometro_estimado === true ? 'Estimada' : 'Registrada') : values.base_calidad,
        base_orden_id: fromService ? values.base_orden_id : '',
      };
      await getDataSource().repository('PlanPM', actor).create(fields);
      notify('Plan guardado. La versión anterior y el historial se conservan.'); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el plan.'); }
    finally { setBusy(false); }
  }
  return <Modal title={`${current ? 'Actualizar' : 'Configurar'} plan ${type.toLowerCase()}`} onClose={requestClose} wide><form className="pm-form" onSubmit={save} onChange={() => setDirty(true)}>
    <p className="pm-form-note pm-full">{equipment.codigo} · {equipment.id_interno_cliente || `${equipment.marca} ${equipment.modelo}`} · {current ? `Se guardará la versión ${Number(current.version) + 1}.` : 'Primer plan de este tipo.'}</p>
    <label>Criterio<select aria-label="Criterio del mantenimiento" value={values.criterio} disabled={busy || type === 'Mayor'} onChange={event => { setCustomInterval(false); set('criterio', event.target.value); set('intervalo', event.target.value === 'Horas' ? '250' : '30'); }}><option>Horas</option>{type !== 'Mayor' && <option>Días</option>}</select></label>
    <label>Intervalo<select aria-label="Intervalo del mantenimiento" value={customInterval ? 'custom' : values.intervalo} disabled={busy} onChange={event => { setCustomInterval(event.target.value === 'custom'); set('intervalo', event.target.value === 'custom' ? '' : event.target.value); }}>{(type === 'Mayor' ? [2000] : values.criterio === 'Horas' ? [250] : [30,60,90]).map(value => <option key={value} value={value}>{formatNumber(value)} {values.criterio === 'Horas' ? 'horas' : 'días'} · recomendado</option>)}<option value="custom">Personalizado para este equipo</option></select></label>
    {customInterval && <label className="pm-full">Intervalo personalizado ({values.criterio === 'Horas' ? 'horas' : 'días'}) *<input type="number" required min="1" max={values.criterio === 'Horas' ? planIntervalLimits.Horas : planIntervalLimits['Días']} step="1" value={values.intervalo} onChange={event => set('intervalo', event.target.value)} disabled={busy} placeholder="Indica el intervalo aplicable al equipo" /><small>Explica en el motivo la recomendación del fabricante o condición de uso que respalda este intervalo.</small></label>}
    <label>Estado del plan<select value={values.estado_plan} onChange={event => set('estado_plan', event.target.value)} disabled={busy}><option>Activo</option><option>Pausado</option></select></label>
    <label>Responsable<input value={values.responsable} onChange={event => set('responsable', event.target.value)} maxLength={160} disabled={busy} placeholder="Opcional" /></label>
    <label className="pm-full">Comenzar el conteo desde<select value={values.base_origen} onChange={event => set('base_origen', event.target.value)} disabled={busy}><option value="Pendiente">Pendiente de confirmar la base</option><option value="Servicio">Un mantenimiento completado del historial</option><option value="Base inicial">Una base inicial revisada</option></select></label>
    {values.base_origen === 'Servicio' && <><label className="pm-full">Mantenimiento base *<select value={values.base_orden_id} onChange={event => set('base_orden_id', event.target.value)} required disabled={busy}><option value="">Selecciona el reporte revisado</option>{eligible.map(row => <option key={row.id} value={row.id}>{reportName(row)} · {planDate(localDay(String(row.fecha)))} · {typeof row.horometro === 'number' ? `${formatNumber(row.horometro)} h${row.horometro_estimado === true ? ' · Estimada' : ''}` : 'Sin lectura'}</option>)}</select></label>{source && <p className="pm-form-note pm-full">Base: {planDate(localDay(String(source.fecha)))}{values.criterio === 'Horas' && ` · ${typeof source.horometro === 'number' ? formatNumber(source.horometro) + ' h' : 'Sin lectura: elige una base inicial revisada'}`}{values.criterio === 'Horas' && source.horometro_estimado === true && ' · El cálculo conservará la marca de estimación.'}</p>}{!eligible.length && <p className="pm-form-note pm-full">No hay reportes completados de este tipo. Puedes conservar la base pendiente o registrar una base inicial revisada.</p>}</>}
    {values.base_origen === 'Base inicial' && <><label>Fecha base *<input name="base_fecha" type="date" max={todayGT()} value={values.base_fecha} onInput={event => set('base_fecha', event.currentTarget.value)} required disabled={busy} /></label>{values.criterio === 'Horas' && <label>Horómetro base (h) *<input type="number" min="0" step="0.01" value={values.base_horas} onChange={event => set('base_horas', event.target.value)} required disabled={busy} /></label>}<label>Calidad de la base<select value={values.base_calidad} onChange={event => set('base_calidad', event.target.value)} disabled={busy}><option>Registrada</option><option>Estimada</option></select></label></>}
    {values.base_origen !== 'Pendiente' && <label className="pm-confirm pm-full"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required disabled={busy} /><span>Revisé esta base y el intervalo aplicable al equipo. Si la base es estimada, entiendo que el resultado seguirá pendiente de confirmar.</span></label>}
    {values.base_origen === 'Pendiente' && customInterval && <label className="pm-confirm pm-full"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required disabled={busy} /><span>Revisé el intervalo personalizado para este equipo. El cálculo seguirá pendiente hasta confirmar la base.</span></label>}
    <label className="pm-full">Motivo / información de respaldo *<textarea rows={3} value={values.motivo} onChange={event => set('motivo', event.target.value)} maxLength={500} required disabled={busy} placeholder="Explica la configuración, corrección o nuevo mantenimiento que reinicia este ciclo." /></label>
    <p className="pm-form-note pm-full">{type === 'Mayor' ? '2,000 h es un intervalo recomendado y configurable para el mayor. Un preventivo no reinicia su ciclo.' : '250 h y 30 / 60 / 90 días son recomendaciones configurables según el equipo. Cambiar el preventivo no reinicia el mayor.'} Guardar el plan no agrega servicios ni modifica horómetros. Revisa las recomendaciones del fabricante y las condiciones de uso.</p>
    <div className="pm-full"><ErrorNotice message={error} /></div>
    {discard && <div className="pm-discard pm-full"><p role="alert">Hay cambios sin guardar. ¿Quieres descartarlos?</p><div><button type="button" className="button" onClick={() => setDiscard(false)} autoFocus>Seguir editando</button><button type="button" className="button" onClick={onClose}>Descartar cambios</button></div></div>}
    <div className="modal-actions pm-full"><button type="button" className="button" onClick={requestClose} disabled={busy}>Cancelar</button><button className="button button-dark" disabled={busy}>{busy ? 'Guardando…' : 'Guardar plan'}</button></div>
  </form></Modal>;
}

export function EquipmentPlanning({ equipment, services, readings, onReport }: { equipment: EntityRecord; services: EntityRecord[]; readings: EntityRecord[]; onReport: (id: string) => void }) {
  const plans = useRows('PlanPM', true); const [editing, setEditing] = useState<string | null>(null);
  if (plans.error) return <ErrorNotice message={plans.error} />;
  if (!plans.ready) return <p role="status">Cargando planes…</p>;
  return <section className="equipment-planning" aria-label="Planificación del equipo"><header className="pm-heading"><CalendarDays size={27} /><div><h2>Planes de mantenimiento</h2><p>Preventivo y mayor tienen intervalos y puntos de inicio independientes.</p></div></header>
    <div className="pm-cards">{planTypes.map(type => {
      const plan = currentPlan(plans.rows, equipment.id, type); const projection = projectPlan(plan, readings, services);
      const versions = plans.rows.filter(row => row.schema_plan === 1 && row.equipo_id === equipment.id && row.tipo_plan === type).sort((a,b) => Number(b.version) - Number(a.version));
      return <article className="pm-card" key={type} aria-label={`Plan ${type.toLowerCase()}`}><div className="pm-card-title"><h3>{type}</h3><span className={`pm-status ${projection.tone}`}>{projection.status}</span></div><p className="pm-interval">{plan ? `Cada ${formatNumber(Number(plan.intervalo))} ${plan.criterio === 'Horas' ? 'horas' : 'días'}` : type === 'Mayor' ? 'Ciclo recomendado de 2,000 horas' : '250 horas o 30 / 60 / 90 días'}</p>
        <PlanCycle plan={plan} projection={projection} />
        {plan && <dl className="pm-base"><div><dt>Base del ciclo</dt><dd>{plan.base_origen === 'Pendiente' ? 'Pendiente de confirmar' : `${planDate(String(plan.base_fecha))}${typeof plan.base_horas === 'number' ? ` · ${formatNumber(plan.base_horas)} h` : ''} · ${plan.base_calidad}`}</dd></div><div><dt>Responsable</dt><dd>{plan.responsable || 'Sin asignar'}</dd></div></dl>}
        <div className="pm-actions"><button className="button button-dark" onClick={() => setEditing(type)}><Settings2 size={15} />{plan ? 'Actualizar plan o base' : `Configurar ${type.toLowerCase()}`}</button>{plan?.base_orden_id && <button className="summary-link" onClick={() => onReport(String(plan.base_orden_id))}>Ver reporte base<ArrowUpRight size={14} /></button>}</div>
        {versions.length > 0 && <details className="pm-history"><summary><History size={14} />Versiones y confirmaciones ({versions.length})</summary><ol>{versions.map(row => <li key={row.id}><strong>Versión {row.version} · {row.vigente ? 'Vigente' : 'Anterior'} · {row.estado_plan}</strong><p>{row.intervalo} {row.criterio} · Base: {row.base_origen}{row.base_fecha && ` · ${planDate(String(row.base_fecha))}`}{typeof row.base_horas === 'number' && ` · ${formatNumber(row.base_horas)} h`}{row.base_calidad && ` · ${row.base_calidad}`}</p><p>{row.motivo}</p><small>{row.confirmado_por} · {formatDate(String(row.confirmado_el))}</small></li>)}</ol></details>}
      </article>;
    })}</div><p className="pm-footnote">Al registrar un nuevo mantenimiento completado, actualiza la base del ciclo correspondiente. Las bases no avanzan automáticamente. Los avisos del estado del equipo se conservan por separado.</p>
    {editing && <PlanForm equipment={equipment} type={editing} current={currentPlan(plans.rows, equipment.id, editing)} services={services} onClose={() => setEditing(null)} />}
  </section>;
}
