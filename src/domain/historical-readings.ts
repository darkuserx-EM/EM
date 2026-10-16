import type { EntityRecord } from './model';
import { repeatsReading } from './equipment-history';

/** Autor con el que la importación histórica registra sus lecturas. */
export const historicalReadingAuthor = 'Importación histórica AppSheet';

export type ReadingCleanupReason = 'Repite una lectura conservada' | 'Repite otra lectura importada' | 'Reporte excluido';
export interface ReadingCleanupItem { reading: EntityRecord; order: EntityRecord; reason: ReadingCleanupReason; kept?: EntityRecord }

/**
 * Lecturas que sobran de una importación histórica del cliente: repiten una lectura conservada del equipo,
 * repiten otra lectura importada del mismo día o pertenecen a un reporte excluido (por ID de origen u orden original).
 * Solo propone lecturas creadas por la importación y vinculadas a una orden importada; las demás nunca se tocan.
 */
export function planHistoricalReadingCleanup(entities: { OrdenServicio: EntityRecord[]; LecturaHorometro: EntityRecord[] }, clienteId: string, excludedReports: readonly string[] = []): ReadingCleanupItem[] {
  const orders = new Map(entities.OrdenServicio.filter(row => row.importado === true && row.cliente_id === clienteId).map(row => [row.id, row]));
  const fromImport = (row: EntityRecord) => row.registrado_por === historicalReadingAuthor && orders.has(String(row.orden_id));
  const excluded = new Set(excludedReports.map(value => value.trim().toLocaleLowerCase()).filter(Boolean));
  const group = (rows: EntityRecord[]) => {
    const byEquipment = new Map<string, EntityRecord[]>();
    for (const row of rows) { const list = byEquipment.get(String(row.equipo_id)) ?? []; list.push(row); byEquipment.set(String(row.equipo_id), list); }
    return byEquipment;
  };
  const kept = group(entities.LecturaHorometro.filter(row => !fromImport(row)));
  const keptImported = group([]);
  const candidates = entities.LecturaHorometro.filter(fromImport).sort((a, b) => Date.parse(String(a.fecha)) - Date.parse(String(b.fecha)) || String(a.codigo).localeCompare(String(b.codigo)));
  const plan: ReadingCleanupItem[] = [];
  for (const reading of candidates) {
    const order = orders.get(String(reading.orden_id))!;
    if ([order.origen_id, order.orden_origen].some(value => excluded.has(String(value ?? '').toLocaleLowerCase()))) { plan.push({ reading, order, reason: 'Reporte excluido' }); continue; }
    const value = { fecha: String(reading.fecha), valor: Number(reading.valor), odometro_millas: typeof reading.odometro_millas === 'number' ? reading.odometro_millas : null };
    const equipment = String(reading.equipo_id);
    const conserved = (kept.get(equipment) ?? []).find(row => repeatsReading(row, value));
    if (conserved) { plan.push({ reading, order, reason: 'Repite una lectura conservada', kept: conserved }); continue; }
    const twin = (keptImported.get(equipment) ?? []).find(row => repeatsReading(row, value));
    if (twin) { plan.push({ reading, order, reason: 'Repite otra lectura importada', kept: twin }); continue; }
    keptImported.set(equipment, [...(keptImported.get(equipment) ?? []), reading]);
  }
  return plan;
}
