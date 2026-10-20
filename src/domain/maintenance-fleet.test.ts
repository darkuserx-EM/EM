import { describe, expect, it } from 'vitest';
import { isRentalEquipment, matchesMaintenanceFleet, maintenancePlanDefaults } from './maintenance-fleet';

describe('flota de mantenimiento', () => {
  const rental = { propiedad: 'Propio', estado_administrativo: 'En renta', cliente_id: 'customer' };
  it('separa renta, propiedad del cliente y patio sin inferir renta de la asignación', () => {
    expect(matchesMaintenanceFleet(rental, 'En renta')).toBe(true);
    expect(matchesMaintenanceFleet(rental, 'De clientes')).toBe(false);
    expect(matchesMaintenanceFleet({ ...rental, propiedad: 'De cliente' }, 'De clientes')).toBe(true);
    expect(isRentalEquipment({ ...rental, propiedad: 'De cliente' })).toBe(false);
    expect(isRentalEquipment({ ...rental, estado_administrativo: 'Disponible' })).toBe(false);
    expect(matchesMaintenanceFleet({ propiedad: 'Propio', estado: 'Disponible' }, 'Todos')).toBe(true);
  });
  it('reconoce renta anterior y respeta el estado administrativo actualizado', () => {
    expect(isRentalEquipment({ propiedad: 'Propio', estado: 'En renta' })).toBe(true);
    expect(isRentalEquipment({ propiedad: 'Propio', estado: 'En renta', estado_administrativo: 'Baja' })).toBe(false);
  });
  it('propone 30 días solo al preventivo en renta, sin inventar una base ni cambiar el mayor', () => {
    expect(maintenancePlanDefaults(rental, 'Preventivo')).toEqual({ criterio: 'Días', intervalo: 30 });
    expect(maintenancePlanDefaults(rental, 'Mayor')).toEqual({ criterio: 'Horas', intervalo: 2000 });
    expect(maintenancePlanDefaults({ propiedad: 'De cliente' }, 'Preventivo')).toEqual({ criterio: 'Horas', intervalo: 250 });
    expect(maintenancePlanDefaults({ propiedad: 'Propio', estado: 'Disponible' }, 'Preventivo')).toEqual({ criterio: 'Horas', intervalo: 250 });
  });
});
