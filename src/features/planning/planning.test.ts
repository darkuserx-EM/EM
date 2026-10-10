import { describe, it, expect } from 'vitest';
import { boardMoveAllowed, calendarRange, monthGrid, operationalOrders, planningEvents, shiftCalendar, weekStart } from '../../domain/planning';
import { localDay } from '../../domain/equipment-history';
import type { EntityRecord } from '../../domain/model';

const row = (fields: Partial<EntityRecord> = {}): EntityRecord => ({ id: 'row', codigo: 'OS-001', creado_por: 'test', actualizado_por: 'test', fecha_creacion: '2026-10-10T12:00:00Z', fecha_actualizacion: '2026-10-10T12:00:00Z', ...fields });
describe('calendario operativo en Guatemala', () => {
  it('usa lunes y cubre semanas que cruzan año sin desfase UTC', () => {
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
    expect(calendarRange('2027-01-03', 'week')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    const today = localDay('2026-10-11T02:30:00Z');
    expect(today).toBe('2026-10-10');
    expect(calendarRange(today, 'week').to).toBe('2026-10-11');
  });
  it('navega meses de 28, 29 y 31 días y mantiene rangos de año', () => {
    expect(shiftCalendar('2026-01-31', 'month', 1)).toBe('2026-02-01');
    expect(calendarRange('2024-02-01', 'month').to).toBe('2024-02-29');
    expect(calendarRange('2026-02-01', 'month').to).toBe('2026-02-28');
    expect(shiftCalendar('2026-12-31', 'month', 1)).toBe('2027-01-01');
    expect(calendarRange('2026-10-10', 'year')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    const grid = monthGrid('2026-02-12');
    expect(grid).toHaveLength(42); expect(grid[0]).toBe('2026-01-26'); expect(grid.at(-1)).toBe('2026-03-08');
  });
  it('excluye históricos y borradores de citas; no supone fecha a órdenes sin agenda', () => {
    const orders = [row({ id: 'historical', importado: true, fecha_programada: '2026-10-10', estado: 'Pendiente' }), row({ id: 'draft', schema_operacion: 1, fecha_programada: '2026-10-10', estado: 'Borrador' }), row({ id: 'none', schema_operacion: 1, estado: 'En espera' }), row({ id: 'scheduled', schema_operacion: 1, fecha_programada: '2026-10-10', hora_programada: '08:30', estado: 'Programada' })];
    expect(operationalOrders(orders)).toHaveLength(3);
    expect(planningEvents(orders, [], [], [], '2026-10-10').map(event => event.id)).toEqual(['order-scheduled']);
  });
  it('diferencia vencimiento del plan y cita confirmada y descarta planes sin base o equipos dados de baja', () => {
    const machine = row({ id: 'eq', codigo: 'TCE-001', marca: 'Crown', modelo: 'FC', cliente_id: 'client', estado_administrativo: 'Activo' });
    const plan = row({ id: 'plan', equipo_id: 'eq', schema_plan: 1, vigente: true, tipo_plan: 'Preventivo', estado_plan: 'Activo', criterio: 'Días', intervalo: 30, base_origen: 'Base inicial', base_confirmada: true, base_fecha: '2026-10-01', base_calidad: 'Registrada' });
    const events = planningEvents([], [machine], [plan], [], '2026-10-10');
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ day: '2026-10-31', kind: 'plan', technicianId: '', projected: false, clientId: 'client' });
    expect(planningEvents([], [machine], [{ ...plan, base_confirmada: false }], [], '2026-10-10')).toHaveLength(0);
    expect(planningEvents([], [{ ...machine, estado_administrativo: 'Baja' }], [plan], [], '2026-10-10')).toHaveLength(0);
  });
  it('ofrece movimientos según rol y mantiene cerrado el histórico y los terminales', () => {
    const order = row({ schema_operacion: 1, estado: 'Programada' });
    expect(boardMoveAllowed(order, 'En proceso', 'Técnico')).toBe(true);
    expect(boardMoveAllowed(order, 'Borrador', 'Técnico')).toBe(false);
    expect(boardMoveAllowed(order, 'En proceso', 'Cliente')).toBe(false);
    expect(boardMoveAllowed({ ...order, estado: 'Completada' }, 'Borrador', 'Administrador')).toBe(false);
    expect(boardMoveAllowed({ ...order, importado: true }, 'En proceso', 'Administrador')).toBe(false);
  });
});
