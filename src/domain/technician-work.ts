import type { Actor, Database, EntityRecord } from './model';
import { retiredEquipment } from './equipment-status';

export function enabledEquipment(technician?: EntityRecord): string[] {
  if (!technician?.equipos_habilitados) return [];
  try {
    const ids: unknown = JSON.parse(String(technician.equipos_habilitados));
    return Array.isArray(ids) && ids.length <= 500 && ids.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)) ? [...new Set(ids)] : [];
  } catch { return []; }
}
export function validEquipmentGrant(value: unknown) {
  if (value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;
  try {
    const ids: unknown = JSON.parse(value);
    return Array.isArray(ids) && ids.length <= 500 && ids.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)) && new Set(ids).size === ids.length;
  } catch { return false; }
}
type WorkScope = Pick<Database['entities'], 'Equipo' | 'Tecnico'>;
export function technicianEquipmentIds(actor: Actor, entities: WorkScope): Set<string> {
  const technician = entities.Tecnico.find(row => row.id === actor.tecnico_id && row.activo !== false);
  if (actor.rol !== 'Técnico' || !actor.tecnico_id || !technician) return new Set();
  return new Set(entities.Equipo.filter(row => !retiredEquipment(row) && row.activo !== false).map(row => row.id));
}
export function ticketHasOrder(ticket: EntityRecord, orders: EntityRecord[] = []) {
  return !!ticket.orden_id || ticket.tiene_orden === true || orders.some(order => order.ticket_id === ticket.id);
}
export function canAttendTicket(actor: Actor, ticket: EntityRecord) {
  return ['Administrador', 'Coordinador'].includes(actor.rol) || actor.rol === 'Técnico' && !!actor.tecnico_id && actor.tecnico_id === ticket.responsable_id;
}
export function canCreateTicketOrder(actor: Actor, ticket: EntityRecord, orders: EntityRecord[] = []) {
  return canAttendTicket(actor, ticket) && ticket.schema_operacion === 1 && !ticket.importado && !['Resuelto', 'Cancelado'].includes(String(ticket.estado)) && !ticketHasOrder(ticket, orders);
}
export function canReopenTicket(actor: Actor, ticket: EntityRecord, orders: EntityRecord[] = []) {
  return canAttendTicket(actor, ticket) && ticket.schema_operacion === 1 && !ticket.importado && ticket.estado === 'Resuelto' && !ticketHasOrder(ticket, orders);
}
