import type { EntityRecord } from '../../domain/model';
import type { PlanProjection } from '../../domain/maintenance-plan';
import { formatDate, formatNumber } from '../../domain/format';

export const planDate = (value: string) => formatDate(`${value}T12:00:00-06:00`);

export function remainingLabel(plan: EntityRecord | undefined, projection: PlanProjection) {
  if (projection.remaining === undefined) return projection.status;
  const amount = Math.abs(projection.remaining);
  const unit = plan?.criterio === 'Días' ? (amount === 1 ? 'día' : 'días') : 'h';
  if (amount === 0) return 'Objetivo alcanzado';
  return projection.remaining < 0 ? `${formatNumber(amount)} ${unit} de atraso` : `${formatNumber(amount)} ${unit} ${amount === 1 ? 'restante' : 'restantes'}`;
}

/** Display the same reviewed projection in the dashboard and the plan editor. */
export function PlanCycle({ plan, projection, compact = false }: { plan?: EntityRecord; projection: PlanProjection; compact?: boolean }) {
  if (!plan || projection.target === undefined) return <p className="pm-explanation">{projection.detail}</p>;
  const interval = Number(plan.intervalo);
  const elapsed = projection.remaining === undefined ? undefined : Math.max(0, interval - projection.remaining);
  const percent = elapsed === undefined ? undefined : Math.min(100, Math.round(elapsed / interval * 100));
  const unit = plan.criterio === 'Horas' ? 'h' : 'días';
  const calculation = <>
    <p className="pm-explanation">{projection.detail}</p>
    <dl className="pm-calculation"><div><dt>Comienza en</dt><dd>{planDate(String(plan.base_fecha))}{typeof plan.base_horas === 'number' && ` · ${formatNumber(plan.base_horas)} h`}</dd></div><div><dt>Regla del ciclo</dt><dd>{plan.criterio === 'Horas' ? `${formatNumber(Number(plan.base_horas))} + ${formatNumber(interval)} = ${formatNumber(Number(projection.target))} h` : `${planDate(String(plan.base_fecha))} + ${interval} días`}</dd></div>{projection.latestDay && <div><dt>Lectura usada</dt><dd>{planDate(projection.latestDay)} · {formatNumber(projection.latest!)} h</dd></div>}</dl>
  </>;
  return <>
    <div className={`pm-target ${projection.tone}`}>
      <span>{projection.estimated ? 'Objetivo orientativo · estimado' : 'Próximo objetivo'}</span>
      <strong>{typeof projection.target === 'number' ? `${formatNumber(projection.target)} h` : planDate(projection.target)}</strong>
      <p>{remainingLabel(plan, projection)}{plan.criterio === 'Horas' && ' según la última lectura'}</p>
      {percent !== undefined && <div className="pm-cycle-progress">
        <div role="progressbar" aria-label={`Avance del ciclo ${String(plan.tipo_plan).toLowerCase()}${projection.estimated ? ' (estimado)' : ''}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${formatNumber(elapsed!)} de ${formatNumber(interval)} ${unit}${projection.estimated ? ', estimado' : ''}`} className={`pm-cycle-track ${projection.estimated ? 'estimated' : ''}`}><i style={{ width: `${percent}%` }} /></div>
        <small>{formatNumber(elapsed!)} de {formatNumber(interval)} {unit} del ciclo{projection.estimated ? ' · Estimado' : ''}</small>
      </div>}
    </div>
    {compact ? <details className="chart-disclosure"><summary>Ver base y cálculo</summary><div className="chart-disclosure-body">{calculation}</div></details> : calculation}
    {projection.forecast && <div className="pm-forecast"><strong>Fecha orientativa: {planDate(projection.forecast)}</strong><p>Ritmo reciente: {formatNumber(Math.round(projection.rate! * 10) / 10)} h/día. Es una proyección de uso, pendiente de comprobar con nuevas lecturas; no es una cita.</p></div>}
  </>;
}
