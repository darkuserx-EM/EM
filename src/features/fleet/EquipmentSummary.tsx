import { useId, useState, type ReactNode } from 'react';
import { ArrowUpRight, CalendarDays, Gauge, Wrench } from 'lucide-react';
import type { EquipmentHistory } from '../../domain/equipment-history';
import type { EntityRecord } from '../../domain/model';
import { formatDate, formatNumber, formatTime } from '../../domain/format';
import { meterSegments, summarizeEquipment } from '../../domain/equipment-summary';
import { EstimateNote } from './ImportedReportDetails';
import './equipment-summary.css';

const reportName = (report: EntityRecord) => report.orden_origen ? `OS ${report.orden_origen}` : report.codigo;

function ReadingChart({ history, onReport }: { history: EquipmentHistory; onReport: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState('');
  const selectId = useId();
  const readings = history.usage;
  const selected = readings.find(item => item.row.id === selectedId) ?? readings.at(-1);
  if (!selected) return <p className="summary-empty">No hay lecturas en este período. Cuando se registren, podrás explorar aquí la evolución del equipo.</p>;
  const values = readings.map(item => Number(item.row.valor));
  const low = values.reduce((min, value) => Math.min(min, value), values[0]);
  const high = values.reduce((max, value) => Math.max(max, value), values[0]);
  const first = Date.parse(String(readings[0].row.fecha));
  const duration = Date.parse(String(readings.at(-1)!.row.fecha)) - first;
  const points = readings.map(({ row }) => ({
    x: duration > 0 ? 66 + (Date.parse(String(row.fecha)) - first) / duration * 570 : 351,
    y: high > low ? 160 - (Number(row.valor) - low) / (high - low) * 126 : 97,
    row,
  }));
  const report = history.repairs.find(row => row.id === selected.row.orden_id);
  return <>
    <svg className="summary-meter" viewBox="0 0 680 208" role="group" aria-label="Lecturas de horómetro. Selecciona un punto o usa el listado inferior.">
      {(high > low ? [0, .5, 1] : [.5]).map(fraction => <g key={fraction} aria-hidden="true"><line x1="66" x2="636" y1={160 - fraction * 126} y2={160 - fraction * 126} className="summary-grid-line" /><text x="56" y={164 - fraction * 126} textAnchor="end">{formatNumber(low + (high - low) * fraction)}</text></g>)}
      {meterSegments(readings).map(segment => <line key={segment.to} x1={points[segment.from].x} y1={points[segment.from].y} x2={points[segment.to].x} y2={points[segment.to].y} className={segment.estimated ? 'summary-line estimated' : 'summary-line'} aria-hidden="true" />)}
      {points.map(({ row, x, y }) => <g key={row.id} role="button" tabIndex={0} aria-pressed={selected.row.id === row.id} aria-label={`${formatDate(String(row.fecha))}, ${formatNumber(Number(row.valor))} horas${row.es_estimado === true ? ', estimada' : ', registrada'}`} className={`summary-point${row.es_estimado === true ? ' estimated' : ''}`} onClick={() => setSelectedId(row.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(row.id); } }}>
        <circle cx={x} cy={y} r="13" fill="transparent" className="point-hit" />
        <circle cx={x} cy={y} r={selected.row.id === row.id ? 6 : 4} className="point-mark" />
      </g>)}
      <text x="66" y="195">{formatDate(String(readings[0].row.fecha))}</text>{duration > 0 && <text x="636" y="195" textAnchor="end">{formatDate(String(readings.at(-1)!.row.fecha))}</text>}
    </svg>
    <div className="summary-chart-legend"><span>● Registrada</span>{readings.some(item => item.row.es_estimado === true) && <span className="estimated">● Estimada · tramo discontinuo</span>}</div>
    <label className="summary-reading-label" htmlFor={selectId}>Consultar una lectura</label>
    <select id={selectId} value={selected.row.id} onChange={event => setSelectedId(event.target.value)}>{[...readings].reverse().map(({ row }) => <option key={row.id} value={row.id}>{formatDate(String(row.fecha))} · {formatNumber(Number(row.valor))} h{row.es_estimado === true ? ' · Estimada' : ''}</option>)}</select>
    <div className="summary-reading-detail" aria-live="polite" aria-atomic="true">
      <div><strong>{formatNumber(Number(selected.row.valor))} h</strong><span>{formatDate(String(selected.row.fecha))} · {formatTime(String(selected.row.fecha))}</span></div>
      <p>{selected.row.origen || 'Origen sin registrar'}</p>
      {selected.row.es_estimado === true && <EstimateNote original={selected.row.valor_original} note={selected.row.nota_estimacion} unit="h" />}
      {typeof selected.row.odometro_millas === 'number' && <p>Odómetro H3: {formatNumber(selected.row.odometro_millas)} millas{selected.row.odometro_estimado === true ? ' · Estimado' : ''}</p>}
      {report && <button className="summary-link" onClick={() => onReport(report.id)}>Ver reporte {reportName(report)}<ArrowUpRight size={14} /></button>}
    </div>
    <p className="summary-footnote">Se muestran lecturas registradas, sin proyección futura. Las líneas unen lecturas comparables; no representan medición continua.{readings.length === 1 ? ' Se necesita otra lectura para calcular el uso.' : ''}</p>
  </>;
}

export function EquipmentSummary({ history, onReport, onView, followUp }: { history: EquipmentHistory; followUp?: ReactNode; onReport: (id: string) => void; onView: (view: 'repairs' | 'usage') => void }) {
  const summary = summarizeEquipment(history);
  const maxCount = Math.max(1, ...summary.serviceTypes.map(group => group.count));
  return <section className="equipment-summary" aria-label="Resumen del equipo">
    <div className="summary-title"><div><h2>El equipo, de un vistazo</h2><p>Resumen del período seleccionado · vista de administración</p></div></div>
    {followUp}
    <div className="summary-kpis">
      <button className="summary-kpi" onClick={() => onView('repairs')}><Wrench size={18} /><span>Servicios registrados</span><strong>{history.repairs.length}</strong><small>Ver reparaciones y servicios →</small></button>
      <button className="summary-kpi" onClick={() => onView('usage')}><Gauge size={18} /><span>Uso entre lecturas</span><strong>{history.hoursUsed === null ? '—' : formatNumber(history.hoursUsed)} <em>h</em></strong><small>{history.hoursUsed === null ? 'Faltan lecturas comparables' : `${history.hoursUsedEstimated ? 'Estimado · ' : ''}${formatDate(String(history.usage[0].row.fecha))} → ${formatDate(String(history.usage.at(-1)!.row.fecha))}`}</small></button>
      <div className="summary-kpi"><CalendarDays size={18} /><span>Lecturas disponibles</span><strong>{history.usage.length}</strong><small>{!history.usage.length ? 'Sin lecturas en este período' : summary.estimatedReadings ? `${summary.estimatedReadings} estimada${summary.estimatedReadings === 1 ? '' : 's'} · originales conservados` : 'Sin lecturas marcadas como estimadas'}</small></div>
    </div>
    <section className="panel summary-panel"><div className="summary-section-title"><h3>Evolución del horómetro</h3><span>H1 · horas</span></div><ReadingChart history={history} onReport={onReport} /></section>
    <div className="summary-columns">
      <section className="panel summary-panel"><h3>Servicios por tipo</h3><p className="summary-caption">Clasificación de los reportes registrados.</p><div className="summary-bars">{summary.serviceTypes.map(group => <div key={group.label}><span>{group.label}</span><strong>{group.count}</strong><div className="summary-bar-track" aria-hidden="true"><i style={{ width: `${group.count / maxCount * 100}%` }} /></div></div>)}</div></section>
      <section className="panel summary-panel"><h3>Mantenimientos registrados</h3><p className="summary-caption">Últimos reportados como completados dentro del período.</p>{[['Preventivo', summary.lastPreventive], ['Mayor', summary.lastMajor]].map(([label, value]) => {
        const report = typeof value === 'object' ? value : undefined;
        return <div className="summary-maintenance" key={String(label)}><strong>{String(label)}</strong>{report ? <><button className="summary-link" onClick={() => onReport(report.id)}>{formatDate(String(report.fecha))} · {reportName(report)}<ArrowUpRight size={13} /></button><span>{typeof report.horometro === 'number' ? `${formatNumber(report.horometro)} h${report.horometro_estimado === true ? ' · Estimado' : ''}` : 'Sin lectura registrada'}</span></> : <span>Sin registro completado en este período</span>}</div>;
      })}<p className="summary-footnote">La programación se habilitará en la etapa de planificación. Estos registros no confirman por sí solos que el mantenimiento esté al día.</p></section>
    </div>
    <section className="panel summary-panel"><div className="summary-section-title"><h3>Servicios recientes</h3><button className="summary-link" onClick={() => onView('repairs')}>Ver todos<ArrowUpRight size={14} /></button></div>{history.repairs.length ? <ol className="summary-timeline">{history.repairs.slice(0, 5).map(report => <li key={report.id}><button onClick={() => onReport(report.id)}><span>{formatDate(String(report.fecha))} · {reportName(report)} · {report.tipo}</span><strong>{report.motivo || 'Sin descripción registrada'}</strong><small>{report.estado || 'Sin estado registrado'}</small><ArrowUpRight size={16} /></button></li>)}</ol> : <p className="summary-empty">No hay servicios registrados en este período.</p>}</section>
    <details className="summary-quality"><summary>Sobre la información del historial</summary><p>{summary.pendingReports ? `${summary.pendingReports} reportes importados figuran como pendientes en el origen. Deben revisarse antes de considerarlos trabajos pendientes actuales.` : 'Los estados del historial corresponden a cada visita y no determinan el estado actual del equipo.'}</p><p>Las recomendaciones de los reportes se conservan en cada servicio. Puedes revisar su vigencia y registrar su atención en Hallazgos y notas.</p></details>
  </section>;
}
