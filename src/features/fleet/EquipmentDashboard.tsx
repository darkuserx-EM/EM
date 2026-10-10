import { type ReactNode } from 'react';
import { ArrowUpRight, CalendarDays, ClipboardList, Gauge, Wrench } from 'lucide-react';
import { useRows } from '../../app/state';
import { ErrorNotice } from '../../components/ui';
import type { EntityRecord } from '../../domain/model';
import { currentPlan, planTypes, projectPlan } from '../../domain/maintenance-plan';
import { findingSummary } from '../../domain/equipment-findings';
import { formatDate, formatNumber } from '../../domain/format';
import { PlanCycle, remainingLabel } from './PlanCycle';
import './equipment-dashboard.css';

export function EquipmentDashboard({ equipment, services, readings, findings, findingsReady, findingsError, followUp, onPlan, onFindings, onUsage, onServices }: {
  equipment: EntityRecord; services: EntityRecord[]; readings: EntityRecord[]; findings: EntityRecord[];
  followUp: ReactNode;
  findingsReady: boolean; findingsError: string; onPlan: () => void; onFindings: () => void; onUsage: () => void; onServices: () => void;
}) {
  const plans = useRows('PlanPM', true);
  const cycles = planTypes.map(type => { const plan = currentPlan(plans.rows, equipment.id, type); return { type, plan, projection: projectPlan(plan, readings, services) }; });
  const preventive = cycles[0];
  const totals = findingSummary(findings, equipment.id);
  const latest = readings.filter(row => row.equipo_id === equipment.id && typeof row.valor === 'number').sort((a,b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
  const ownServices = services.filter(row => row.equipo_id === equipment.id);
  return <div className="equipment-dashboard-overview">
    <div className="dashboard-indicators" aria-label="Indicadores principales del equipo">
      <button className="dashboard-indicator" onClick={onPlan}><span><CalendarDays size={17} />Próximo preventivo</span><strong>{plans.error ? 'No disponible' : !plans.ready ? 'Cargando…' : remainingLabel(preventive.plan, preventive.projection)}</strong><small>{plans.ready && !plans.error ? preventive.projection.status : 'Consulta la planificación'}</small></button>
      <button className="dashboard-indicator" onClick={onFindings}><span><ClipboardList size={17} />Hallazgos abiertos</span><strong>{findingsError || !findingsReady ? '—' : totals.active}</strong><small>{findingsError ? 'No se pudieron cargar' : !findingsReady ? 'Cargando seguimientos…' : `${totals.critical} críticos · ${totals.pending} por confirmar`}</small></button>
      <button className="dashboard-indicator" onClick={onUsage}><span><Gauge size={17} />Último horómetro</span><strong>{latest ? `${formatNumber(Number(latest.valor))} h` : 'Sin lectura'}</strong><small>{latest ? `${formatDate(String(latest.fecha))}${latest.es_estimado === true ? ' · Estimado' : ' · Registrado'}` : 'Pendiente de registrar'}</small></button>
      <button className="dashboard-indicator" onClick={onServices}><span><Wrench size={17} />Servicios del equipo</span><strong>{ownServices.length}</strong><small>Todo el historial · consultar reportes →</small></button>
    </div>
    <div className="dashboard-priorities">
    <section className="dashboard-next panel" aria-label="Próximo servicio">
      <header><div><span className="dashboard-eyebrow">PLAN DE MANTENIMIENTO</span><h2>Próximo servicio</h2></div><button className="button button-dark" onClick={onPlan}>Configurar planes<ArrowUpRight size={16} /></button></header>
      {plans.error ? <ErrorNotice message={plans.error} /> : !plans.ready ? <p role="status">Cargando planes…</p> : <div className="dashboard-cycle-grid">{cycles.map(({type, plan, projection}) => <article className="dashboard-cycle" key={type}><div className="pm-card-title"><h3>{type === 'Mayor' ? 'Mantenimiento mayor' : 'Preventivo periódico'}</h3><span className={`pm-status ${projection.tone}`}>{projection.status}</span></div><p className="pm-interval">{plan ? `Cada ${formatNumber(Number(plan.intervalo))} ${plan.criterio === 'Horas' ? 'horas' : 'días'}` : type === 'Mayor' ? 'Ciclo recomendado de 2,000 horas' : '250 horas o 30 / 60 / 90 días'}</p><PlanCycle plan={plan} projection={projection} compact />{!plan && <button className="summary-link" onClick={onPlan}>Definir la base y el intervalo<ArrowUpRight size={15} /></button>}</article>)}</div>}
      <p className="dashboard-caption">Planes independientes del filtro de fechas · las fechas proyectadas requieren confirmación.</p>
    </section>
    {followUp}
    </div>
  </div>;
}
