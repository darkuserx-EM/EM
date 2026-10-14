import type { EntityRecord } from './model';

export const supportFields = ['tecnico_apoyo_1_id', 'tecnico_apoyo_2_id'] as const;
export function orderTechnicians(row: Partial<EntityRecord>): string[] {
  return [row.tecnico_id, ...supportFields.map(key => row[key])].filter((id): id is string => typeof id === 'string' && !!id);
}
export function assignedTo(row: Partial<EntityRecord>, technicianId?: string) {
  return !!technicianId && orderTechnicians(row).includes(technicianId);
}
export function orderTeamLabel(row: EntityRecord, technicians: EntityRecord[]) {
  const names = orderTechnicians(row).map(id => technicians.find(item => item.id === id)?.nombre);
  return names.length && names.every(Boolean) ? names.join(' · ') : String(row.tecnico || 'Sin técnico asignado');
}
