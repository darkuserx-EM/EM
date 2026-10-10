import { useId, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { EquipmentHistory } from '../../domain/equipment-history';
import { formatDate, formatNumber, formatTime } from '../../domain/format';
import { meterSegments } from '../../domain/equipment-summary';
import { useChartWidth } from '../../components/useChartWidth';
import { EstimateNote } from './ImportedReportDetails';

export function ReadingChart({ history, onReport }: { history: EquipmentHistory; onReport: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState('');
  const selectId = useId();
  const { chartRef, width } = useChartWidth(300);
  const readings = history.usage;
  const selected = readings.find(item => item.row.id === selectedId) ?? readings.at(-1);
  if (!selected) return <p className="summary-empty">No hay lecturas en este período. Registra una lectura o ajusta las fechas.</p>;
  const values = readings.map(item => Number(item.row.valor));
  const low = values.reduce((min, value) => Math.min(min, value), values[0]);
  const high = values.reduce((max, value) => Math.max(max, value), values[0]);
  const first = Date.parse(String(readings[0].row.fecha));
  const duration = Date.parse(String(readings.at(-1)!.row.fecha)) - first;
  const left = 66; const right = width - 20;
  const points = readings.map(({ row }) => ({
    x: duration > 0 ? left + (Date.parse(String(row.fecha)) - first) / duration * (right - left) : (left + right) / 2,
    y: high > low ? 174 - (Number(row.valor) - low) / (high - low) * 142 : 103,
    row,
  }));
  const reports = new Map(history.repairs.map(row => [row.id, row]));
  const report = reports.get(String(selected.row.orden_id));
  const reportLabel = report && (report.orden_origen ? `OS ${report.orden_origen}` : report.codigo);
  const segments = meterSegments(readings);
  const ticks = duration > 120 * 86_400_000 ? (width < 480 ? [0, .5, 1] : [0, .25, .5, .75, 1]) : duration > 0 ? [0, 1] : [0];
  const tickDate = (time: number) => duration > 120 * 86_400_000 ? new Intl.DateTimeFormat('es-GT', { timeZone: 'America/Guatemala', month: 'short', year: 'numeric' }).format(time) : formatDate(new Date(time).toISOString());
  return <>
    <div className="summary-chart-legend"><span>● Registrada</span>{readings.some(item => item.row.es_estimado === true) && <span className="estimated">◌ Estimada · línea discontinua</span>}<span className="chart-instruction">Selecciona un punto para consultar la lectura</span></div>
    <div ref={chartRef} className="reading-chart-scroll" role="region" aria-label="Gráfico de horómetro; desplazamiento horizontal en pantallas pequeñas" tabIndex={0}>
      <svg className="summary-meter" style={{ minWidth: width }} width={width} height="212" viewBox={`0 0 ${width} 212`} role="group" aria-label="Lecturas de horómetro. Selecciona un punto o usa el listado en Ver detalle de lecturas.">
        {(high > low ? [0, .5, 1] : [.5]).map(fraction => <g key={fraction} aria-hidden="true"><line x1={left} x2={right} y1={174 - fraction * 142} y2={174 - fraction * 142} className="summary-grid-line" /><text x={left - 10} y={178 - fraction * 142} textAnchor="end">{formatNumber(Math.round(low + (high - low) * fraction))}</text></g>)}
        {segments.map(segment => <g key={segment.to} aria-hidden="true"><polygon points={`${points[segment.from].x},174 ${points[segment.from].x},${points[segment.from].y} ${points[segment.to].x},${points[segment.to].y} ${points[segment.to].x},174`} className="summary-meter-area" /><line x1={points[segment.from].x} y1={points[segment.from].y} x2={points[segment.to].x} y2={points[segment.to].y} className={segment.estimated ? 'summary-line estimated' : 'summary-line'} /></g>)}
        {points.map(({ row, x, y }) => {
          const origin = reports.get(String(row.orden_id));
          const description = `${formatDate(String(row.fecha))} · ${formatNumber(Number(row.valor))} h${row.es_estimado === true ? ' · Estimada' : ''}${origin ? ` · ${origin.orden_origen ? `OS ${origin.orden_origen}` : origin.codigo}` : ''}`;
          return <g key={row.id} role="button" tabIndex={0} aria-pressed={selected.row.id === row.id} aria-label={description} className={`summary-point${row.es_estimado === true ? ' estimated' : ''}`} onClick={() => setSelectedId(row.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(row.id); } }}><title>{description}</title><circle cx={x} cy={y} r="12" fill="transparent" className="point-hit" /><circle cx={x} cy={y} r={selected.row.id === row.id ? 5 : 3.5} className="point-mark" /></g>;
        })}
        {ticks.map(fraction => <text key={fraction} x={duration > 0 ? left + fraction * (right - left) : (left + right) / 2} y="201" textAnchor={duration === 0 ? 'middle' : fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}>{tickDate(first + fraction * duration)}</text>)}
      </svg>
    </div>
    <div className="chart-selection-row" aria-live="polite" aria-atomic="true"><span><strong>{formatNumber(Number(selected.row.valor))} h</strong> · {formatDate(String(selected.row.fecha))}{selected.row.es_estimado === true && <em>Estimada</em>}</span>{report && <button className="summary-link" onClick={() => onReport(report.id)}>Ver reporte {reportLabel}<ArrowUpRight size={14} /></button>}</div>
    <details className="chart-disclosure"><summary>Ver detalle de lecturas</summary><div className="chart-disclosure-body">
      <label className="summary-reading-label" htmlFor={selectId}>Consultar una lectura</label><select id={selectId} value={selected.row.id} onChange={event => setSelectedId(event.target.value)}>{[...readings].reverse().map(({ row }) => <option key={row.id} value={row.id}>{formatDate(String(row.fecha))} · {formatNumber(Number(row.valor))} h{row.es_estimado === true ? ' · Estimada' : ''}</option>)}</select>
      <div className="summary-reading-detail"><p>{selected.row.origen || 'Origen sin registrar'} · {formatTime(String(selected.row.fecha))}</p>{selected.row.es_estimado === true && <EstimateNote original={selected.row.valor_original} note={selected.row.nota_estimacion} unit="h" />}{typeof selected.row.odometro_millas === 'number' && <p>Odómetro H3: {formatNumber(selected.row.odometro_millas)} millas{selected.row.odometro_estimado === true ? ' · Estimado' : ''}</p>}</div>
      <p className="summary-footnote">Las líneas unen lecturas comparables; no representan medición continua ni proyección futura.{readings.length === 1 ? ' Se necesita otra lectura para calcular el uso.' : ''}</p>
    </div></details>
  </>;
}
