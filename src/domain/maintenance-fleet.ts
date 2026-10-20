import type { EntityRecord } from './model';
import { administrativeState } from './equipment-status';

export const maintenanceFleetFilters = ['Todos', 'En renta', 'De clientes'] as const;
export type MaintenanceFleetFilter = typeof maintenanceFleetFilters[number];

/** Rental is an administrative state, not the presence of an assigned client. */
export function isRentalEquipment(equipment: Partial<EntityRecord>) {
  return equipment.propiedad === 'Propio' && administrativeState(equipment) === 'En renta';
}

export function matchesMaintenanceFleet(equipment: Partial<EntityRecord>, filter: MaintenanceFleetFilter) {
  return filter === 'Todos' || (filter === 'En renta' ? isRentalEquipment(equipment) : equipment.propiedad === 'De cliente');
}

/** Defaults only: never replace a saved plan or assume a confirmed starting date. */
export function maintenancePlanDefaults(equipment: Partial<EntityRecord>, type: string) {
  return type === 'Preventivo' && isRentalEquipment(equipment)
    ? { criterio: 'Días', intervalo: 30 }
    : { criterio: 'Horas', intervalo: type === 'Mayor' ? 2000 : 250 };
}
