import type { EntityRecord } from './model';

export interface UsageReading { row: EntityRecord; previous?: EntityRecord; delta: number | null; estimated: boolean }
/** Select by the actual instant, retaining the original value, quality and date. */
export function latestEquipmentReading(equipmentId: string, readings: EntityRecord[]) {
  return readings.filter(row => row.equipo_id === equipmentId && typeof row.valor === 'number' && Number.isFinite(row.valor) && Number.isFinite(Date.parse(String(row.fecha))))
    .reduce<EntityRecord | undefined>((latest, row) => !latest || Date.parse(String(row.fecha)) > Date.parse(String(latest.fecha)) ? row : latest, undefined);
}
export const localDay = (date: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
/** A historical reading repeats a kept one of the same equipment with the same hour meter, no conflicting odometer and the same Guatemala day.
 * «Ingreso de equipo» is dated when the machine was registered, not when it was read, so the same hour meter is enough. */
export function repeatsReading(kept: Record<string, unknown>, reading: { fecha: string; valor: number; odometro_millas: number | null }) {
  if (kept.valor !== reading.valor) return false;
  if (typeof kept.odometro_millas === 'number' && reading.odometro_millas !== null && kept.odometro_millas !== reading.odometro_millas) return false;
  if (kept.origen === 'Ingreso de equipo') return true;
  return typeof kept.fecha === 'string' && Number.isFinite(Date.parse(kept.fecha)) && localDay(kept.fecha) === localDay(reading.fecha);
}
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
    return { row, previous, delta: change !== null && change >= 0 ? change : null, estimated: row.es_estimado === true || previous?.es_estimado === true };
  }).filter(item => inDateRange(item.row, from, to));
  const orderIds = new Set(repairs.map(row => row.id));
  const relevantParts = parts.filter(row => row.equipo_id === equipmentId && orderIds.has(String(row.orden_id)));
  const relevantLabor = labor.filter(row => row.equipo_id === equipmentId && orderIds.has(String(row.orden_id)));
  // Differences across meter resets/corrections cannot be interpreted as usage.
  const hoursUsed = usage.length >= 2 && usage.slice(1).every(item => item.delta !== null) ? Number(usage.at(-1)!.row.valor) - Number(usage[0].row.valor) : null;
  const hoursUsedEstimated = hoursUsed !== null && (usage[0].row.es_estimado === true || usage.at(-1)!.row.es_estimado === true);
  return { repairs, usage, parts: relevantParts, labor: relevantLabor, hoursUsed, hoursUsedEstimated };
}
export type EquipmentHistory = ReturnType<typeof equipmentHistory>;
