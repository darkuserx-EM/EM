import type { EntityRecord } from './model';
import { ValidationError } from './errors';

export interface HistoricalReadingTarget {
  equipo_id: string; cliente_id: string; fecha: string; valor: number;
  odometro_millas: number | null; origen_id: string;
}
const absentNumber = (value: unknown) => value === undefined || value === '' || value === null ? null : value;
export function sameHistoricalReading(row: EntityRecord, target: HistoricalReadingTarget) {
  return row.equipo_id === target.equipo_id && row.cliente_id === target.cliente_id
    && Number.isFinite(Date.parse(target.fecha)) && Date.parse(String(row.fecha)) === Date.parse(target.fecha)
    && row.valor === target.valor && absentNumber(row.odometro_millas) === target.odometro_millas
    && row.es_estimado !== true && row.odometro_estimado !== true
    && (!row.origen_id || row.origen_id === target.origen_id);
}

/** Never infer a match from hours alone or discard a correction from the previous import. */
export function reusableHistoricalReading(readings: EntityRecord[], target: HistoricalReadingTarget) {
  const candidates = readings.filter(row => row.equipo_id === target.equipo_id
    && ((target.origen_id && row.origen_id === target.origen_id) || Date.parse(String(row.fecha)) === Date.parse(target.fecha)));
  if (!candidates.length) return undefined;
  const row = candidates[0];
  if (candidates.length !== 1 || !sameHistoricalReading(row, target) || row.orden_id) {
    throw new ValidationError(`Lectura de ${target.origen_id}: hay una coincidencia ambigua, vinculada o con valores/calidad distintos. Revisa el historial antes de importar.`);
  }
  return row;
}

export interface ReadingReconciliation { conservar_id: string; duplicada_id: string }
