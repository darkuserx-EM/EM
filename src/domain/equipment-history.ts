import type { EntityRecord } from './model';

export interface UsageReading { row: EntityRecord; previous?: EntityRecord; delta: number | null }
export const localDay = (date: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
export function inDateRange(row: EntityRecord, from: string, to: string) {
  if (typeof row.fecha !== 'string' || !Number.isFinite(Date.parse(row.fecha))) return false;
  const date = localDay(row.fecha);
  return (!from || date >= from) && (!to || date <= to);
}
export function equipmentHistory(equipmentId: string, services: EntityRecord[], readings: EntityRecord[], parts: EntityRecord[], labor: EntityRecord[], from = '', to = '') {
  const repairs = services.filter(row => row.equipo_id === equipmentId && inDateRange(row, from, to)).sort((a, b) => Date.parse(String(b.fecha)) - Date.parse(String(a.fecha)));
  const ordered = readings.filter(row => row.equipo_id === equipmentId && typeof row.valor === 'number' && inDateRange(row, '', '')).sort((a, b) => Date.parse(String(a.fecha)) - Date.parse(String(b.fecha)));
  const usage: UsageReading[] = ordered.map((row, i) => {
    const previous = ordered[i - 1]; const change = previous ? Number(row.valor) - Number(previous.valor) : null;
    return { row, previous, delta: change !== null && change >= 0 ? change : null };
  }).filter(item => inDateRange(item.row, from, to));
  const orderIds = new Set(repairs.map(row => row.id));
  const relevantParts = parts.filter(row => row.equipo_id === equipmentId && orderIds.has(String(row.orden_id)));
  const relevantLabor = labor.filter(row => row.equipo_id === equipmentId && orderIds.has(String(row.orden_id)));
  // Differences across meter resets/corrections cannot be interpreted as usage.
  const hoursUsed = usage.length >= 2 && usage.slice(1).every(item => item.delta !== null) ? Number(usage.at(-1)!.row.valor) - Number(usage[0].row.valor) : null;
  return { repairs, usage, parts: relevantParts, labor: relevantLabor, hoursUsed };
}
export type EquipmentHistory = ReturnType<typeof equipmentHistory>;
