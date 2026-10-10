import { useId, useState } from 'react';
import { monthlyUsage, type UsageMonth, type ProjectionReason } from '../../domain/monthly-usage';
import type { EntityRecord } from '../../domain/model';
import { formatDate, formatNumber } from '../../domain/format';
import './monthly-usage.css';

const monthName = (time: number, short = false) => new Intl.DateTimeFormat('es-GT', { timeZone: 'America/Guatemala', month: short ? 'short' : 'long', ...(short ? {} : { year: 'numeric' }) }).format(time).replace('.', '');
const date = (time: number) => formatDate(new Date(time).toISOString());
const hours = (value: number) => formatNumber(Math.round(value * 10) / 10);
const reasons: Record<ProjectionReason, string> = {
  available: '', current: 'La última lectura llega hasta el momento de la consulta.',
  sparse: 'Para proyectar se necesitan al menos tres lecturas comparables en 90 días, que abarquen 14 días o más.',
  stale: 'Actualiza el horómetro: la última lectura tiene más de 30 días. No se proyecta el uso posterior.',
  unreliable: 'Hay lecturas sin confirmar, inválidas o futuras que impiden proyectar con confianza.',
  zero: 'El tramo reciente no registra incremento. No se supone uso después de la última lectura.',
};

export function MonthlyUsageChart({ equipmentId, readings, from, to }: { equipmentId: string; readings: EntityRecord[]; from: string; to: string }) {
  const [selectedKey, setSelectedKey] = useState('');
  const [showProjection, setShowProjection] = useState(true);
  const id = useId();
  const data = monthlyUsage(equipmentId, readings, { from, to });
  const selected = data.months.find(month => month.key === selectedKey) ?? data.months.at(-1);
  const projected = (month: UsageMonth) => showProjection ? month.projectedHours : 0;
  const hasData = (month: UsageMonth) => month.coveredMs > 0 || (showProjection && month.projectedMs > 0);
  const total = (month: UsageMonth) => month.hours + projected(month);
  const description = (month: UsageMonth) => `${monthName(month.start)}: ${hasData(month) ? `aproximadamente ${hours(total(month))} horas${projected(month) > 0 ? ', incluye proyección' : ''}${!month.complete ? ', mes incompleto' : ''}` : 'sin datos comparables'}`;
  const width = Math.max(650, data.months.length * 38);
  const step = (width - 24) / Math.max(1, data.months.length);
  const ceiling = Math.max(1, ...data.months.map(total), data.baseline?.hours ?? 0);
  const height = (value: number) => value / ceiling * 138;
  const years = data.months.reduce<{ year: string; first: number; count: number }[]>((groups, month, index) => {
    const year = month.key.slice(0, 4); const last = groups.at(-1);
    if (last?.year === year) last.count++; else groups.push({ year, first: index, count: 1 });
    return groups;
  }, []);
  const projectionInRange = data.months.some(month => month.projectedMs > 0);
  return <section className="panel summary-panel monthly-usage" aria-labelledby={`${id}-title`}>
    <div className="summary-section-title"><h3 id={`${id}-title`}>Uso por mes</h3><span>Horas estimadas repartiendo el uso entre lecturas</span></div>
    {data.baseline || data.recentAverage ? <p className="monthly-comparison">
      {data.baseline && <>Promedio {data.baseline.year}: <strong>≈ {hours(data.baseline.hours)} h/mes</strong> ({data.baseline.count} meses completos).</>}
      {data.recentAverage && <> De {monthName(data.recentAverage.from)} a {monthName(data.recentAverage.to)}: <strong>≈ {hours(data.recentAverage.hours)} h/mes</strong>.</>}
    </p> : <p className="summary-caption">Compara el uso del equipo mes a mes. Los períodos sin lecturas comparables aparecen sin dato.</p>}
    {data.months.some(month => month.coveredMs > 0 || month.projectedMs > 0) ? <>
      <div className="monthly-chart-scroll" role="region" aria-label="Gráfico de horas estimadas por mes; desplazamiento horizontal en pantallas pequeñas" tabIndex={0}>
        <svg className="monthly-chart" style={{ minWidth: width }} viewBox={`0 0 ${width} 232`} role="group" aria-label="Uso mensual estimado. Selecciona una barra para consultar su cálculo.">
          <line x1="12" x2={width - 12} y1="178" y2="178" className="monthly-axis" />
          {data.months.map((month, index) => {
            const x = 12 + index * step + step * .14; const barWidth = step * .72;
            const amount = total(month); const h = height(amount); const forecastHeight = height(projected(month));
            return <g key={month.key} role="button" tabIndex={0} aria-label={description(month)} aria-pressed={selected?.key === month.key} className="monthly-bar" onClick={() => setSelectedKey(month.key)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedKey(month.key); } }}>
              <title>{description(month)}</title><rect x={x - 4} y="12" width={barWidth + 8} height="200" fill="transparent" />
              {month.coveredMs > 0 && <rect x={x} y={178 - height(month.hours)} width={barWidth} height={Math.max(2, height(month.hours))} rx="3" className="monthly-observed" />}
              {forecastHeight > 0 && <rect x={x} y={178 - h} width={barWidth} height={Math.max(2, forecastHeight)} rx="3" className="monthly-projected" />}
              <text x={x + barWidth / 2} y={hasData(month) ? 170 - h : 165} textAnchor="middle" className="monthly-value">{hasData(month) ? `${projected(month) > 0 ? '≈' : ''}${Math.round(amount)}` : '—'}</text>
              <text x={x + barWidth / 2} y="199" textAnchor="middle" className="monthly-month">{monthName(month.start, true)}{!month.complete && hasData(month) ? '*' : ''}</text>
              <line x1={x} x2={x + barWidth} y1="207" y2="207" className="monthly-selection" />
            </g>;
          })}
          {data.baseline && <g aria-hidden="true" className="monthly-average"><line x1="12" x2={width - 12} y1={178 - height(data.baseline.hours)} y2={178 - height(data.baseline.hours)} /><text x="16" y="20">Línea de promedio {data.baseline.year} · {hours(data.baseline.hours)} h</text></g>}
          {years.map(group => <g key={group.year} aria-hidden="true"><line className="monthly-axis" x1={12 + group.first * step} x2={12 + (group.first + group.count) * step - 4} y1="214" y2="214" /><text className="monthly-year" x={12 + (group.first + group.count / 2) * step} y="230" textAnchor="middle">{group.year}</text></g>)}
        </svg>
      </div>
      <p className="monthly-mobile-hint">Desliza el gráfico para ver todos los meses, o elige uno en el listado.</p>
      <div className="monthly-legend"><span><i /> Repartido entre lecturas</span>{projectionInRange && <span><i className="projected" /> Proyección después de la última lectura</span>}<span>* Mes incompleto o con proyección</span></div>
      <div className="monthly-controls"><label htmlFor={`${id}-month`}>Consultar un mes<select id={`${id}-month`} value={selected?.key} onChange={event => setSelectedKey(event.target.value)}>{data.months.map(month => <option key={month.key} value={month.key}>{monthName(month.start)}</option>)}</select></label>{projectionInRange && <label className="monthly-toggle"><input type="checkbox" checked={showProjection} onChange={event => setShowProjection(event.target.checked)} /> Incluir proyección hasta hoy</label>}</div>
    </> : <p className="summary-empty">No hay dos lecturas comparables que permitan calcular el uso de este período.</p>}
    {selected && <div className="monthly-detail" aria-live="polite" aria-atomic="true"><div><strong>{monthName(selected.start)}</strong><span>{hasData(selected) ? `≈ ${hours(total(selected))} h${selected.complete ? ' estimadas en el mes' : ' · cálculo parcial'}` : 'Sin datos comparables'}</span></div><p>{selected.coveredMs > 0 ? `${hours(selected.hours)} h distribuidas entre lecturas; cubren ${hours(selected.coveredMs / 86_400_000)} días del mes.` : 'No hay un tramo comparable entre lecturas para este mes.'}{projected(selected) > 0 ? ` Se suman ≈ ${hours(projected(selected))} h proyectadas en ${hours(selected.projectedMs / 86_400_000)} días, hasta el ${date(selected.to - 1)}.` : ''}</p>{selected.usesEstimatedReading && <p>Este cálculo incluye una lectura corregida y marcada como estimada. Se conserva su dato original en el historial.</p>}{selected.longGap && <p>Hay un tramo de más de 60 días entre lecturas: el reparto es orientativo y puede ocultar cambios de ritmo.</p>}{!selected.complete && <p>Mes incompleto o con proyección: no se usa en los promedios.</p>}</div>}
    <p className="summary-footnote">Cada incremento se reparte proporcionalmente al tiempo entre dos lecturas; las barras no son mediciones diarias. Los promedios utilizan solo meses completos cubiertos por lecturas, sin proyección. Ningún cálculo cambia los horómetros guardados.</p>
    {data.projection && projectionInRange ? <p className="summary-footnote">{showProjection ? 'Proyección incluida' : 'Proyección oculta'} desde el {date(data.projection.from)} hasta hoy, {date(data.projection.to)}, a ≈ {hours(data.projection.dailyRate)} h/día; ritmo de {data.projection.readings} lecturas entre {date(data.projection.baseFrom)} y {date(data.projection.from)}. No anticipa el cierre del mes.</p> : data.latest && <p className="summary-footnote">{reasons[data.projectionReason]}</p>}
    {(data.rejectedIntervals > 0 || data.invalidReadings > 0 || data.futureReadings > 0) && <p className="monthly-warning">Hay lecturas por revisar. Se omiten tramos con retrocesos, valores simultáneos distintos o incrementos superiores al tiempo transcurrido; tampoco se usan lecturas inválidas o futuras.</p>}
    {data.omittedMonths > 0 && <p className="summary-footnote">Se muestran los últimos 24 meses del período. Ajusta Desde y Hasta para consultar meses anteriores.</p>}
  </section>;
}
