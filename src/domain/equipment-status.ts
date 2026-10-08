import type { EntityRecord } from './model';

export const operationalStates = ['Operativo', 'No operativo', 'En reparación', 'En mantenimiento', 'Pendiente de revisión'] as const;
export type OperationalState = typeof operationalStates[number];
export const administrativeStates = ['Disponible', 'En renta', 'En tránsito', 'Vendido', 'Baja'] as const;
export const maintenanceStates = ['Por revisar', 'Sin pendientes reportados', 'Mantenimiento pendiente'] as const;
export const statusMetadataFields = ['estado_actualizado_por', 'estado_actualizado_el'] as const;
type Equipment = Partial<EntityRecord>;

export function operationalState(row: Equipment): OperationalState {
  if (operationalStates.includes(row.estado_operativo as OperationalState)) return row.estado_operativo as OperationalState;
  // An old maintenance entry is explicit. Available, rented or in a workshop
  // does not establish whether a machine works or is being repaired.
  return row.estado === 'En mantenimiento' ? 'En mantenimiento' : 'Pendiente de revisión';
}
export function administrativeState(row: Equipment): string {
  if (typeof row.estado_administrativo === 'string') return row.estado_administrativo;
  return administrativeStates.includes(row.estado as typeof administrativeStates[number]) ? String(row.estado) : '';
}
export function maintenanceState(row: Equipment): string {
  return maintenanceStates.includes(row.estado_mantenimiento as typeof maintenanceStates[number]) ? String(row.estado_mantenimiento) : 'Por revisar';
}
export function retiredEquipment(row: Equipment) { return row.fuera_de_flota === true || ['Vendido', 'Baja'].includes(administrativeState(row)); }
export function equipmentStatusValues(row: Equipment = {}): Record<string, string> {
  return { estado_operativo: operationalState(row), estado_administrativo: administrativeState(row), estado_mantenimiento: maintenanceState(row), motivo_estado: String(row.motivo_estado ?? '') };
}
export function equipmentStatusChanges(before: Equipment, after: Equipment) {
  const previous = equipmentStatusValues(before); const next = equipmentStatusValues(after);
  return Object.keys(next).filter(key => previous[key] !== next[key]);
}
export function filterEquipmentStatus(rows: EntityRecord[], status = 'Todos', maintenance = 'Todos', includeRetired = false) {
  return rows.filter(row => (includeRetired || !retiredEquipment(row)) && (status === 'Todos' || operationalState(row) === status) && (maintenance === 'Todos' || maintenanceState(row) === maintenance));
}
export function summarizeEquipment(rows: EntityRecord[]) {
  const counts = Object.fromEntries(operationalStates.map(state => [state, 0])) as Record<OperationalState, number>;
  for (const row of rows) counts[operationalState(row)]++;
  return { total: rows.length, counts, maintenancePending: rows.filter(row => maintenanceState(row) === 'Mantenimiento pendiente').length };
}
