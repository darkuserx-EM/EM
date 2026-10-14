import { orderTechnicians } from './order-team';
import type { Actor, EntityRecord } from './model';
import { currentPlan, planTypes, projectPlan, validDay, addDays, todayGT } from './maintenance-plan';
import { administrativeState } from './equipment-status';
import { allowedOperationStates } from './operations';

export type CalendarView = 'year' | 'month' | 'week';
export type PlanningKind = 'service' | 'ticket' | 'plan';
export interface PlanningEvent {
  id: string;
  day: string;
  time: string;
  kind: PlanningKind;
  title: string;
  equipmentId: string;
  clientId: string;
  technicianId: string;
  technicianIds?: string[];
  state: string;
  detail: string;
  href: string;
  projected: boolean;
  priority: string;
  ticketHref?: string;
  ticketCode?: string;
}

const utcDay = (day: string) => new Date(`${day}T12:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
export function monthStart(day: string) { return `${day.slice(0, 7)}-01`; }
export function weekStart(day: string) {
  const weekday = utcDay(day).getUTCDay();
  return addDays(day, -(weekday === 0 ? 6 : weekday - 1));
}
export function shiftCalendar(day: string, view: CalendarView, delta: number) {
  if (view === 'week') return addDays(day, delta * 7);
  // Navigate to the first day, avoiding overflow from Jan 31 into March.
  const date = utcDay(monthStart(day));
  if (view === 'year') date.setUTCFullYear(date.getUTCFullYear() + delta);
  else date.setUTCMonth(date.getUTCMonth() + delta);
  return iso(date);
}
export function calendarRange(day: string, view: CalendarView): { from: string; to: string } {
  if (view === 'year') return { from: `${day.slice(0, 4)}-01-01`, to: `${day.slice(0, 4)}-12-31` };
  if (view === 'week') { const from = weekStart(day); return { from, to: addDays(from, 6) }; }
  const from = monthStart(day);
  return { from, to: addDays(shiftCalendar(from, 'month', 1), -1) };
}
export function monthGrid(day: string) {
  const start = weekStart(monthStart(day));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}
export function calendarLabel(day: string, options: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }) {
  return new Intl.DateTimeFormat('es-GT', { ...options, timeZone: 'UTC' }).format(utcDay(day));
}
export const operationalOrders = (rows: EntityRecord[]) => rows.filter(row => row.schema_operacion === 1 && row.importado !== true);
export const planningEquipmentLabel = (equipment?: EntityRecord) => equipment ? `${equipment.id_interno_cliente || equipment.codigo} · ${equipment.marca || ''} ${equipment.modelo || ''}`.trim() : 'Equipo pendiente';

export const closedTicket = (row: EntityRecord) => ['Resuelto', 'Cancelado'].includes(String(row.estado));
/** Resolve links before any date, state or user-facing filter, including private orders. */
export function standaloneTickets(tickets: EntityRecord[], orders: EntityRecord[]) {
  const linked = new Set(orders.map(row => row.ticket_id).filter(Boolean));
  return operationalOrders(tickets).filter(row => !row.orden_id && row.tiene_orden !== true && !linked.has(row.id));
}
export function ticketsToSchedule(tickets: EntityRecord[], orders: EntityRecord[]) {
  const priority: Record<string, number> = { Crítica: 0, Alta: 1, Media: 2, Baja: 3 };
  return standaloneTickets(tickets, orders).filter(row => !validDay(row.fecha_programada) && !closedTicket(row))
    .sort((a, b) => (priority[String(a.prioridad)] ?? 4) - (priority[String(b.prioridad)] ?? 4) || a.fecha_creacion.localeCompare(b.fecha_creacion) || a.id.localeCompare(b.id));
}

/** A linked order owns the appointment. Maintenance plans remain suggestions. */
export function planningEvents(orders: EntityRecord[], equipment: EntityRecord[], plans: EntityRecord[], readings: EntityRecord[], today = todayGT(), tickets: EntityRecord[] = []): PlanningEvent[] {
  const equipmentMap = new Map(equipment.map(row => [row.id, row]));
  const events: PlanningEvent[] = operationalOrders(orders).filter(row => validDay(row.fecha_programada) && !['Borrador', 'Cancelada'].includes(String(row.estado))).map(row => {
    const machine = equipmentMap.get(String(row.equipo_id));
    const ticket = tickets.find(ticket => ticket.id === row.ticket_id || ticket.orden_id === row.id);
    return {
      id: `order-${row.id}`, day: String(row.fecha_programada), time: /^\d{2}:\d{2}$/.test(String(row.hora_programada)) ? String(row.hora_programada) : '', kind: 'service',
      title: `${row.codigo} · ${row.tipo || 'Servicio'}`, equipmentId: String(row.equipo_id || ''), clientId: String(row.cliente_id || machine?.cliente_id || ''), technicianId: String(row.tecnico_id || ''), technicianIds: orderTechnicians(row),
      state: String(row.estado), detail: planningEquipmentLabel(machine), href: `/ordenes?orden=${encodeURIComponent(row.id)}`, projected: false, priority: String(row.prioridad || ''),
      ...(ticket ? { ticketHref: `/tickets?ticket=${encodeURIComponent(ticket.id)}`, ticketCode: ticket.codigo } : {}),
    };
  });
  for (const ticket of standaloneTickets(tickets, orders)) {
    if (!validDay(ticket.fecha_programada)) continue;
    events.push({
      id: `ticket-${ticket.id}`, day: ticket.fecha_programada, time: '', kind: 'ticket',
      title: `${ticket.codigo} · ${ticket.titulo || 'Solicitud'}`, equipmentId: String(ticket.equipo_id || ''), clientId: String(ticket.cliente_id || ''), technicianId: String(ticket.responsable_id || ''),
      state: String(ticket.estado), detail: planningEquipmentLabel(equipmentMap.get(String(ticket.equipo_id))), href: `/tickets?ticket=${encodeURIComponent(ticket.id)}`, projected: false, priority: String(ticket.prioridad || ''),
    });
  }
  for (const machine of equipment) {
    if (['Vendido', 'Baja'].includes(administrativeState(machine))) continue;
    for (const type of planTypes) {
      const plan = currentPlan(plans, machine.id, type);
      if (!plan || plan.estado_plan !== 'Activo') continue;
      const projection = projectPlan(plan, readings, orders, today);
      const day = typeof projection.target === 'string' ? projection.target : projection.forecast;
      if (!validDay(day)) continue;
      events.push({
        id: `plan-${plan.id}`, day, time: '', kind: 'plan', title: `${type} · ${machine.id_interno_cliente || machine.codigo}`, equipmentId: machine.id,
        clientId: String(machine.cliente_id || ''), technicianId: '', state: projection.status,
        detail: `${plan.criterio === 'Horas' ? `Proyección a ${projection.target} h` : `Vencimiento cada ${plan.intervalo} días`}${projection.estimated ? ' · base estimada' : ''}. Requiere programar una visita.`,
        href: `/flota?equipo=${encodeURIComponent(machine.id)}&vista=mantenimiento`, projected: plan.criterio === 'Horas' || projection.estimated === true, priority: '',
      });
    }
  }
  return events.sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
}

export function eventsInRange(events: PlanningEvent[], range: { from: string; to: string }) { return events.filter(event => event.day >= range.from && event.day <= range.to); }
export function matchesPlanningState(event: PlanningEvent, state: string) {
  return state ? event.state === state : event.kind !== 'ticket' || !['Resuelto', 'Cancelado'].includes(event.state);
}

export const boardStates = ['Borrador', 'Programada', 'En proceso', 'En espera', 'Completada'] as const;
export type BoardState = typeof boardStates[number];
export function boardMoveAllowed(row: EntityRecord, state: BoardState, role: string) {
  if (!operationalOrders([row]).length || ['Completada', 'Cancelada'].includes(String(row.estado)) || row.estado === state) return false;
  if (!['Administrador', 'Coordinador', 'Técnico'].includes(role)) return false;
  return allowedOperationStates('OrdenServicio', row, { id: '', nombre: '', rol: role as Actor['rol'] }).includes(state);
}
