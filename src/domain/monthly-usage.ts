import type { EntityRecord } from './model';

const DAY = 86_400_000;
const GT_OFFSET = 6 * 3_600_000;
const monthIndex = (time: number) => { const day = new Date(time - GT_OFFSET); return day.getUTCFullYear() * 12 + day.getUTCMonth(); };
const monthStart = (index: number) => Date.UTC(Math.floor(index / 12), index % 12, 1, 6);
const dayStart = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00-06:00`) : NaN;
type Point = { time: number; value: number | null; estimated: boolean };
type Interval = { start: number; end: number; hours: number; estimated: boolean };
export interface UsageMonth {
  key: string; start: number; end: number; from: number; to: number;
  hours: number; projectedHours: number; coveredMs: number; projectedMs: number;
  usesEstimatedReading: boolean; longGap: boolean; complete: boolean;
}
export type ProjectionReason = 'available' | 'sparse' | 'stale' | 'unreliable' | 'zero' | 'current';

/** Read-only distribution of counter increments over elapsed time, in Guatemala calendar months. */
export function monthlyUsage(equipmentId: string, rows: EntityRecord[], options: { from?: string; to?: string; now?: number } = {}) {
  const now = options.now ?? Date.now();
  let invalidReadings = 0;
  let futureReadings = 0;
  const groups = new Map<number, Point>();
  for (const row of rows) {
    if (row.equipo_id !== equipmentId) continue;
    const time = typeof row.fecha === 'string' ? Date.parse(row.fecha) : NaN;
    if (!Number.isFinite(time)) { invalidReadings++; continue; }
    if (time > now) { futureReadings++; continue; }
    const value = typeof row.valor === 'number' && Number.isFinite(row.valor) && row.valor >= 0 ? row.valor : null;
    if (value === null) invalidReadings++;
    const existing = groups.get(time);
    // A conflicting simultaneous reading is a barrier, never silently pick one or bridge across it.
    groups.set(time, { time, value: existing && existing.value !== value ? null : value, estimated: row.es_estimado === true || existing?.estimated === true });
  }
  const points = [...groups.values()].sort((a, b) => a.time - b.time);
  const intervals: Interval[] = [];
  let rejectedIntervals = 0;
  let cleanStart = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]; const b = points[i];
    const hours = a.value === null || b.value === null ? -1 : b.value - a.value;
    // H1 measures hours: more than one hour per elapsed hour needs review, not clipping.
    if (hours < 0 || hours > (b.time - a.time) / 3_600_000) { rejectedIntervals++; cleanStart = i; continue; }
    intervals.push({ start: a.time, end: b.time, hours, estimated: a.estimated || b.estimated });
    if (a.estimated || b.estimated) cleanStart = i;
  }
  const latest = points.at(-1);
  const recent = latest ? points.slice(cleanStart).filter(point => point.time >= latest.time - 90 * DAY) : [];
  const span = recent.length > 1 ? latest!.time - recent[0].time : 0;
  const dailyRate = span > 0 && recent[0].value !== null && latest?.value !== null ? (latest!.value! - recent[0].value) / (span / DAY) : 0;
  let projectionReason: ProjectionReason = 'sparse';
  if (latest && now - latest.time > 30 * DAY) projectionReason = 'stale';
  else if (futureReadings || invalidReadings || recent.some(point => point.value === null || point.estimated)) projectionReason = 'unreliable';
  else if (recent.length >= 3 && span >= 14 * DAY) projectionReason = dailyRate > 0 ? (latest!.time < now ? 'available' : 'current') : 'zero';
  const projection = projectionReason === 'available' ? { from: latest!.time, to: now, dailyRate, readings: recent.length, baseFrom: recent[0].time } : undefined;

  const start = options.from ? dayStart(options.from) : points[0]?.time;
  const end = options.to ? Math.min(dayStart(options.to) + DAY, now) : now;
  const months: UsageMonth[] = [];
  let omittedMonths = 0;
  if (start !== undefined && Number.isFinite(start) && Number.isFinite(end) && start < end && points.length) {
    const lastIndex = monthIndex(end - 1);
    const firstIndex = monthIndex(start);
    omittedMonths = Math.max(0, lastIndex - firstIndex + 1 - 24);
    for (let index = firstIndex + omittedMonths; index <= lastIndex; index++) {
      const month: UsageMonth = {
        key: `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`,
        start: monthStart(index), end: monthStart(index + 1), from: Math.max(start, monthStart(index)), to: Math.min(end, monthStart(index + 1)),
        hours: 0, projectedHours: 0, coveredMs: 0, projectedMs: 0, usesEstimatedReading: false, longGap: false, complete: false,
      };
      for (const interval of intervals) {
        const overlap = Math.min(month.to, interval.end) - Math.max(month.from, interval.start);
        if (overlap <= 0) continue;
        month.hours += interval.hours * overlap / (interval.end - interval.start);
        month.coveredMs += overlap;
        month.usesEstimatedReading ||= interval.estimated;
        month.longGap ||= interval.end - interval.start > 60 * DAY;
      }
      if (projection) {
        month.projectedMs = Math.max(0, Math.min(month.to, projection.to) - Math.max(month.from, projection.from));
        month.projectedHours = month.projectedMs / DAY * projection.dailyRate;
      }
      month.complete = month.coveredMs >= month.end - month.start;
      months.push(month);
    }
  }
  const complete = months.filter(month => month.complete);
  const firstYear = months[0]?.key.slice(0, 4);
  const baselineMonths = complete.filter(month => month.key.startsWith(`${firstYear}-`));
  const average = (items: UsageMonth[]) => items.reduce((sum, month) => sum + month.hours, 0) / items.length;
  const baseline = baselineMonths.length >= 3 ? { year: firstYear!, hours: average(baselineMonths), count: baselineMonths.length } : undefined;
  const recentMonths = complete.slice(-3);
  const consecutive = recentMonths.length === 3 && monthIndex(recentMonths[2].start) - monthIndex(recentMonths[0].start) === 2;
  const recentAverage = consecutive ? { hours: average(recentMonths), from: recentMonths[0].start, to: recentMonths[2].start } : undefined;
  return { months, baseline, recentAverage, projection, projectionReason, invalidReadings, futureReadings, rejectedIntervals, omittedMonths, latest: latest?.time };
}
export type MonthlyUsage = ReturnType<typeof monthlyUsage>;
