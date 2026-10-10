import { type ReactNode } from 'react';
import { ArrowUpRight, CalendarDays, Gauge, Wrench } from 'lucide-react';
import type { EquipmentHistory } from '../../domain/equipment-history';
import type { EntityRecord } from '../../domain/model';
import { formatDate, formatNumber } from '../../domain/format';
import { summarizeEquipment } from '../../domain/equipment-summary';
import { EquipmentLayoutDesigner } from './EquipmentLayoutDesigner';
import type { DashboardBlocks } from './EquipmentDashboard';
import { ReadingChart } from './ReadingChart';
import './equipment-summary.css';

const reportName = (report: EntityRecord) => report.orden_origen ? `OS ${report.orden_origen}` : report.codigo;

export function EquipmentSummary({ history, onReport, onView, onPlan, dashboard, periodFilters, monthlyUsage, design, onCloseDesign }: { history: EquipmentHistory; dashboard: DashboardBlocks; design?: boolean; onCloseDesign: () => void; periodFilters?: ReactNode; monthlyUsage?: ReactNode; onPlan?: () => void; onReport: (id: string) => void; onView: (view: 'repairs' | 'usage') => void }) {
  const summary = summarizeEquipment(history);
  const maxCount = Math.max(1, ...summary.serviceTypes.map(group => group.count));
  const activity = <div className="summary-kpis">
      <button className="summary-kpi" onClick={() => onView('repairs')}><Wrench size={18} /><span>Servicios registrados</span><strong>{history.repairs.length}</strong><small>Ver reparaciones y servicios →</small></button>
      <button className="summary-kpi" onClick={() => onView('usage')}><Gauge size={18} /><span>Uso entre lecturas</span><strong>{history.hoursUsed === null ? '—' : formatNumber(history.hoursUsed)} <em>h</em></strong><small>{history.hoursUsed === null ? 'Faltan lecturas comparables' : `${history.hoursUsedEstimated ? 'Estimado · ' : ''}${formatDate(String(history.usage[0].row.fecha))} → ${formatDate(String(history.usage.at(-1)!.row.fecha))}`}</small></button>
      <div className="summary-kpi"><CalendarDays size={18} /><span>Lecturas disponibles</span><strong>{history.usage.length}</strong><small>{!history.usage.length ? 'Sin lecturas en este período' : summary.estimatedReadings ? `${summary.estimatedReadings} estimada${summary.estimatedReadings === 1 ? '' : 's'} · originales conservados` : 'Sin lecturas marcadas como estimadas'}</small></div>
    </div>;
  const meter = <section className="panel summary-panel reading-panel"><div className="summary-section-title"><h3>Evolución del horómetro</h3><span>H1 · horas acumuladas</span></div><ReadingChart history={history} onReport={onReport} /></section>;
  const recent = <section className="panel summary-panel summary-recent"><div className="summary-section-title"><h3>Servicios recientes</h3><button className="summary-link" onClick={() => onView('repairs')}>Ver todos<ArrowUpRight size={14} /></button></div>{history.repairs.length ? <ol className="summary-timeline">{history.repairs.slice(0, 5).map(report => <li key={report.id}><button onClick={() => onReport(report.id)}><span>{formatDate(String(report.fecha))} · {reportName(report)} · {report.tipo}</span><strong>{report.motivo || 'Sin descripción registrada'}</strong><small>{report.estado || 'Sin estado registrado'}</small><ArrowUpRight size={16} /></button></li>)}</ol> : <p className="summary-empty">No hay servicios registrados en este período.</p>}</section>;
  const serviceTypes = <section className="panel summary-panel"><h3>Servicios por tipo</h3><p className="summary-caption">Clasificación de los reportes registrados.</p><div className="summary-bars">{summary.serviceTypes.map(group => <div key={group.label}><span>{group.label}</span><strong>{group.count}</strong><div className="summary-bar-track" aria-hidden="true"><i style={{ width: `${group.count / maxCount * 100}%` }} /></div></div>)}</div></section>;
  const completedMaintenance = <section className="panel summary-panel"><h3>Mantenimientos registrados</h3><p className="summary-caption">Últimos reportados como completados dentro del período.</p>{[['Preventivo', summary.lastPreventive], ['Mayor', summary.lastMajor]].map(([label, value]) => {
        const report = typeof value === 'object' ? value : undefined;
        return <div className="summary-maintenance" key={String(label)}><strong>{String(label)}</strong>{report ? <><button className="summary-link" onClick={() => onReport(report.id)}>{formatDate(String(report.fecha))} · {reportName(report)}<ArrowUpRight size={13} /></button><span>{typeof report.horometro === 'number' ? `${formatNumber(report.horometro)} h${report.horometro_estimado === true ? ' · Estimado' : ''}` : 'Sin lectura registrada'}</span></> : <span>Sin registro completado en este período</span>}</div>;
      })}<p className="summary-footnote">Estos registros no confirman por sí solos que el mantenimiento esté al día. Revisa la base y el intervalo en la planificación.</p>{onPlan && <button className="button button-dark" onClick={onPlan}>Planificar mantenimiento<ArrowUpRight size={14} /></button>}</section>;
  if (design) return <EquipmentLayoutDesigner onClose={onCloseDesign} blocks={[
    { id: 'indicators', title: 'Indicadores principales', content: dashboard.indicators },
    { id: 'planning', title: 'Próximo servicio', content: dashboard.planning },
    { id: 'findings', title: 'Hallazgos y recomendaciones', content: dashboard.followUp },
    { id: 'activity', title: 'Actividad del período', content: activity },
    { id: 'meter', title: 'Evolución del horómetro', content: meter },
    { id: 'monthly', title: 'Uso por mes', content: monthlyUsage },
    { id: 'recent', title: 'Servicios recientes', content: recent },
    { id: 'types', title: 'Servicios por tipo', content: serviceTypes },
    { id: 'completed', title: 'Mantenimientos registrados', content: completedMaintenance },
  ]} />;
  return <section className="equipment-summary" aria-label="Resumen del equipo">
    <div className="summary-title"><div><h2>Dashboard de mantenimiento</h2><p>Estado, próximos servicios e historial · vista de administración</p></div></div>
    <div className="equipment-dashboard-overview">{dashboard.indicators}<div className="dashboard-priorities">{dashboard.planning}{dashboard.followUp}</div></div>
    <div className="summary-period-heading"><h3>Actividad y uso del equipo</h3>{periodFilters}</div>
    {activity}
    <div className="summary-charts">{meter}{monthlyUsage}</div>
    <div className="summary-secondary-grid">{recent}{serviceTypes}{completedMaintenance}</div>
    <details className="summary-quality"><summary>Sobre la información del historial</summary><p>{summary.pendingReports ? `${summary.pendingReports} reportes importados figuran como pendientes en el origen. Deben revisarse antes de considerarlos trabajos pendientes actuales.` : 'Los estados del historial corresponden a cada visita y no determinan el estado actual del equipo.'}</p><p>Las recomendaciones de los reportes se conservan en cada servicio. Puedes revisar su vigencia y registrar su atención en Hallazgos y notas.</p></details>
  </section>;
}
