import { select } from './sql.mjs';
import { filterVisible } from './generated/domain.mjs';

/** @param {import('./contracts.js').SqlConnection} pool @param {'Ticket'|'OrdenServicio'} entity @param {unknown} id */
async function record(pool, entity, id) {
  if (typeof id !== 'string' || !id || id.length > 128) return undefined;
  /** @type {{payload:string}[]} */
  const rows = await select(pool,'SELECT payload FROM em_records WHERE entity=? AND id=?',[entity,id]);
  /** @type {import('../src/domain/model.js').EntityRecord|undefined} */
  const row = rows[0] ? JSON.parse(rows[0].payload) : undefined;
  return row?.id === id ? row : undefined;
}

/** The assigned order grants access to its initial evidence, not to other tickets or files.
 * @param {import('./contracts.js').SqlConnection} pool
 * @param {import('../src/domain/model.js').Actor} actor
 * @param {unknown} ticketId
 * @param {unknown} [orderId]
 */
export async function authorizeTicketEvidence(pool, actor, ticketId, orderId) {
  const unavailable = () => Object.assign(new Error('Solicitud o fotografía no disponible.'),{status:404,expose:true});
  let order;
  if (orderId !== undefined) {
    order = await record(pool,'OrdenServicio',orderId);
    if (!order || !filterVisible(actor,'OrdenServicio',[order]).length || !order.ticket_id || (ticketId && ticketId !== order.ticket_id)) throw unavailable();
    ticketId = order.ticket_id;
  }
  const ticket = await record(pool,'Ticket',ticketId);
  if (!ticket || (order ? order.cliente_id !== ticket.cliente_id || order.equipo_id !== ticket.equipo_id : !filterVisible(actor,'Ticket',[ticket]).length)) throw unavailable();
  return ticket;
}
