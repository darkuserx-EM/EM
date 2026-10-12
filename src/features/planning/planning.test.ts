import { describe, it, expect } from 'vitest';
import { boardMoveAllowed, calendarRange, monthGrid, operationalOrders, planningEvents, shiftCalendar, weekStart, ticketsToSchedule, matchesPlanningState } from '../../domain/planning';
import { filterVisible } from '../../domain/permissions';
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

describe('solicitudes en la agenda', () => {
  const ticket = row({ id: 'ticket', codigo: 'TKT-1', schema_operacion: 1, equipo_id: 'eq', cliente_id: 'a', responsable_id: 'tech-a', estado: 'Programado', fecha_programada: '2026-10-13', prioridad: 'Alta', titulo: 'Revisar frenos' });
  const order = row({ id: 'order', schema_operacion: 1, ticket_id: ticket.id, equipo_id: 'eq', cliente_id: 'a', tecnico_id: 'tech-a', estado: 'Programada', fecha_programada: '2026-10-14', hora_programada: '09:00', visible_cliente: true });
  it('muestra fecha, prioridad, equipo y responsable sin inventar una hora', () => {
    expect(planningEvents([], [], [], [], '2026-10-12', [ticket])[0]).toMatchObject({ id: 'ticket-ticket', kind: 'ticket', day: '2026-10-13', time: '', technicianId: 'tech-a', clientId: 'a', priority: 'Alta', href: '/tickets?ticket=ticket' });
  });
  it.each(['ticket_id', 'orden_id'])('resuelve %s y conserva solo la fecha de la orden, con ambos enlaces', direction => {
    const request = direction === 'orden_id' ? { ...ticket, orden_id: order.id } : ticket;
    const service = direction === 'orden_id' ? { ...order, ticket_id: '' } : order;
    const events = planningEvents([service], [], [], [], '2026-10-12', [request]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ day: '2026-10-14', time: '09:00', href: '/ordenes?orden=order', ticketHref: '/tickets?ticket=ticket' });
    expect(ticketsToSchedule([{ ...request, fecha_programada: '' }], [service])).toEqual([]);
  });
  it.each(['Borrador', 'Cancelada', 'Completada'])('no revive el ticket de una orden %s aunque cambie la fecha o el estado', estado => {
    const events = planningEvents([{ ...order, estado, fecha_programada: '' }], [], [], [], '2026-10-12', [ticket]);
    expect(events).toEqual([]);
  });
  it('separa pendientes, ordena por prioridad y antigüedad, y no cambia los originales', () => {
    const rows = [row({ ...ticket, id: 'low', prioridad: 'Baja', fecha_programada: '' }), row({ ...ticket, id: 'new', fecha_programada: '' }), row({ ...ticket, id: 'old', fecha_programada: '', fecha_creacion: '2026-10-01T00:00:00Z' }), row({ ...ticket, id: 'critical', prioridad: 'Crítica', fecha_programada: '' }), { ...ticket, id: 'closed', fecha_programada: '', estado: 'Resuelto' }, { ...ticket, id: 'canceled', fecha_programada: '', estado: 'Cancelado' }, { ...ticket, id: 'linked', fecha_programada: '', tiene_orden: true }, ticket];
    const before = structuredClone(rows);
    expect(ticketsToSchedule(rows, []).map(row => row.id)).toEqual(['critical', 'old', 'new', 'low']);
    expect(rows).toEqual(before);
    expect(planningEvents([], [], [], [], '2026-10-12', rows).map(event => event.id)).toEqual(['ticket-ticket']);
  });
  it('conserva resueltos/cancelados para consulta explícita, fuera de la agenda pendiente', () => {
    for (const estado of ['Resuelto', 'Cancelado']) {
      const event = planningEvents([], [], [], [], '2026-10-12', [{ ...ticket, estado }])[0];
      expect(matchesPlanningState(event, '')).toBe(false);
      expect(matchesPlanningState(event, estado)).toBe(true);
    }
  });
  it.each(['Administrador', 'Coordinador', 'Cliente', 'Técnico'] as const)('respeta el alcance de %s antes de construir la agenda', rol => {
    const actor = { id: 'actor', nombre: 'QA', rol, cliente_id: 'a', tecnico_id: 'tech-a' };
    const requests = [ticket, { ...ticket, id: 'foreign', cliente_id: 'b', responsable_id: 'tech-b' }];
    const entities = { Equipo: [], OrdenServicio: [{ ...order, visible_cliente: false, tecnico_id: 'tech-b' }], Ticket: requests };
    const scoped = filterVisible(actor, 'Ticket', requests, entities);
    const orders = filterVisible(actor, 'OrdenServicio', entities.OrdenServicio, entities);
    const events = planningEvents(orders, [], [], [], '2026-10-12', scoped);
    expect(events.some(event => event.id === 'ticket-ticket')).toBe(false);
    expect(events.some(event => event.id === 'order-order')).toBe(['Administrador', 'Coordinador'].includes(rol));
    expect(events.some(event => event.id === 'ticket-foreign')).toBe(['Administrador', 'Coordinador'].includes(rol));
    if (rol === 'Cliente' || rol === 'Técnico') { expect(scoped[0].tiene_orden).toBe(true); expect(scoped[0]).not.toHaveProperty('orden_id'); }
  });
});
