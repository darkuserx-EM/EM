import type { Actor, Database, EntityRecord } from './model';
import { ValidationError } from './errors';
import { retiredEquipment } from './equipment-status';
export interface SubmittedReading { equipo_id: string; fecha: string; valor: number; observacion: string }
export interface ReadingSubmission { archivo: string; filas: SubmittedReading[] }
export interface ReadingDecision { id: string; aprobar: boolean; motivo: string }
export function checkSubmittedReading(row: SubmittedReading, actor: Actor, db: Database) {
  const equipment = db.entities.Equipo.find(item => item.id === row?.equipo_id);
  if (!equipment || !actor.cliente_id || equipment.cliente_id !== actor.cliente_id || retiredEquipment(equipment) || equipment.activo === false) throw new ValidationError('El equipo no pertenece a tu flota activa.');
  if (typeof row.fecha !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(row.fecha) || !Number.isFinite(Date.parse(row.fecha)) || Date.parse(row.fecha) > Date.now()) throw new ValidationError('La fecha debe ser válida y no estar en el futuro.');
  if (new Date(row.fecha).toISOString() !== row.fecha.replace(/(?<!\.\d{3})Z$/, '.000Z')) throw new ValidationError('La fecha no existe en el calendario.');
  if (typeof row.valor !== 'number' || !Number.isFinite(row.valor) || row.valor < 0 || row.valor > 1e9 || typeof row.observacion !== 'string' || row.observacion.length > 300) throw new ValidationError('Lectura u observación inválida.');
  return equipment;
}
export function readingWarnings(row: Pick<SubmittedReading, 'equipo_id' | 'fecha' | 'valor'>, readings: EntityRecord[]) {
  const ordered = readings.filter(r => r.equipo_id === row.equipo_id && typeof r.valor === 'number' && r.es_estimado !== true).sort((a,b) => Date.parse(String(a.fecha)) - Date.parse(String(b.fecha)));
  const before = ordered.filter(r => Date.parse(String(r.fecha)) < Date.parse(row.fecha)).at(-1);
  const after = ordered.find(r => Date.parse(String(r.fecha)) > Date.parse(row.fecha));
  const warnings: string[] = [];
  if (before && row.valor < Number(before.valor) || after && row.valor > Number(after.valor)) warnings.push('Retroceso respecto al historial');
  if (before && row.valor - Number(before.valor) > (Date.parse(row.fecha) - Date.parse(String(before.fecha))) / 3600000 + 1) warnings.push('Aumento superior al tiempo transcurrido');
  return warnings;
}
