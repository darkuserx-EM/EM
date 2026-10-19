import type { Actor, Database, EntityName, EntityRecord } from './model';
import { ValidationError } from './errors';
import { formatDate, formatNumber } from './format';

/**
 * «Corregir equipo»: una solicitud (con todas sus órdenes) o una orden sin solicitud que se creó con la máquina equivocada
 * pasa a otro equipo del mismo cliente. Se mueven juntos la solicitud, sus órdenes, las lecturas, repuestos y horas de esas
 * órdenes y los hallazgos que nacieron en ellas. Adjuntos, fotos de la solicitud y firma siguen ligados a la orden o la solicitud.
 * Los reportes importados se corrigen con reviseImportedReport. `vista_previa` devuelve el resumen sin guardar nada.
 */
export interface EquipmentCorrection { ticket_id?: string; orden_id?: string; equipo_id: string; motivo?: string; vista_previa?: boolean }
export interface EquipmentCorrectionSummary {
  solicitud: string; ordenes: string[]; lecturas: { codigo: string; valor: number | null; fecha: string }[];
  repuestos: number; horas: number; hallazgos: number;
  equipo_anterior_id: string; equipo_nuevo_id: string; solo_administracion: boolean;
  ultima_lectura_destino: { valor: number; fecha: string } | null; avisos: string[]; aplicado: boolean;
}
export interface EquipmentCorrectionPlan {
  ticket?: EntityRecord; orders: EntityRecord[]; readings: EntityRecord[]; parts: EntityRecord[]; labor: EntityRecord[]; findings: EntityRecord[];
  source: EntityRecord; target: EntityRecord; adminOnly: boolean;
}

const forbidden = (message: string) => Object.assign(new ValidationError(message), { status: 403 });
const time = (row: EntityRecord) => Date.parse(String(row.fecha));
const reading = (row: EntityRecord) => `${row.codigo} (${formatNumber(Number(row.valor))} h del ${formatDate(String(row.fecha))})`;
const meterReadings = (entities: Database['entities'], equipmentId: string) => entities.LecturaHorometro
  .filter(row => row.equipo_id === equipmentId && typeof row.valor === 'number' && Number.isFinite(time(row)))
  .sort((a, b) => time(a) - time(b));
/** Nombre corto del equipo para mensajes y bitácora: ID interno del cliente y código del portal. */
export const machineName = (row: EntityRecord) => row.id_interno_cliente ? `${row.id_interno_cliente} (${row.codigo})` : String(row.codigo);
/** Con una orden completada o la solicitud resuelta, solo administración corrige el equipo. */
export const closedOperation = (ticket: EntityRecord | undefined, orders: EntityRecord[]) => ticket?.estado === 'Resuelto' || orders.some(row => row.estado === 'Completada');

/** Reúne lo que se moverá y comprueba todas las reglas. No modifica `entities`. */
export function planEquipmentCorrection(entities: Database['entities'], actor: Actor, input: EquipmentCorrection): EquipmentCorrectionPlan {
  if (!['Administrador', 'Coordinador'].includes(actor.rol)) throw forbidden('Solo coordinación o administración pueden corregir el equipo de una operación.');
  if (!input || typeof input.equipo_id !== 'string' || (typeof input.ticket_id === 'string') === (typeof input.orden_id === 'string')) throw new ValidationError('Indica la solicitud o la orden y el equipo correcto.');
  const order = input.orden_id === undefined ? undefined : entities.OrdenServicio.find(row => row.id === input.orden_id);
  if (input.orden_id !== undefined && !order) throw new ValidationError('No se encontró la orden.');
  // Una orden de una solicitud se corrige con toda la solicitud: la solicitud y sus órdenes comparten siempre el equipo.
  const ticket = order ? entities.Ticket.find(row => (!!order.ticket_id && row.id === order.ticket_id) || row.orden_id === order.id) : entities.Ticket.find(row => row.id === input.ticket_id);
  if (!order && !ticket) throw new ValidationError('No se encontró la solicitud.');
  const orders = ticket ? entities.OrdenServicio.filter(row => row.ticket_id === ticket.id || row.id === ticket.orden_id) : [order!];
  const operations = [...(ticket ? [ticket] : []), ...orders];
  if (operations.some(row => row.importado === true)) throw new ValidationError('Es un reporte importado del historial: corrígelo con «Corregir reporte importado».');
  if (operations.some(row => row.schema_operacion !== 1)) throw new ValidationError('Este reporte histórico conserva su información de origen; su equipo no se corrige desde aquí.');
  if (ticket?.estado === 'Cancelado' || orders.some(row => row.estado === 'Cancelada')) throw new ValidationError('La solicitud o una de sus órdenes está cancelada; su historial se conserva tal como quedó.');
  const source = entities.Equipo.find(row => row.id === operations[0].equipo_id);
  const clientId = String(operations[0].cliente_id || '');
  if (!source || operations.some(row => row.equipo_id !== source.id || String(row.cliente_id || '') !== clientId)) throw new ValidationError('La solicitud y sus órdenes no tienen el mismo equipo y cliente; requiere revisión.');
  const target = entities.Equipo.find(row => row.id === input.equipo_id);
  if (!target) throw new ValidationError('Selecciona el equipo correcto.');
  if (target.id === source.id) throw new ValidationError('Elige un equipo distinto del actual.');
  if (!clientId || String(target.cliente_id || '') !== clientId) throw new ValidationError('El equipo correcto debe ser del mismo cliente.');
  const adminOnly = closedOperation(ticket, orders);
  if (adminOnly && actor.rol !== 'Administrador') throw forbidden('La orden ya está completada o la solicitud resuelta: solo administración puede corregir su equipo.');

  const orderIds = new Set(orders.map(row => row.id));
  const linked = (row: EntityRecord) => orderIds.has(String(row.orden_id || ''));
  const readings = entities.LecturaHorometro.filter(linked), parts = entities.OTRepuesto.filter(linked), labor = entities.OTHoras.filter(linked);
  const findings = entities.Hallazgo.filter(row => orderIds.has(String(row.orden_origen_id || '')));
  const code = (id: unknown) => entities.OrdenServicio.find(row => row.id === id)?.codigo || 'otra orden';
  const split = findings.find(row => row.orden_resolucion_id && !orderIds.has(String(row.orden_resolucion_id)));
  if (split) throw new ValidationError(`El hallazgo ${split.codigo} nació en ${code(split.orden_origen_id)} pero se resolvió en ${code(split.orden_resolucion_id)}, que no se mueve. Revisa ese hallazgo antes de corregir el equipo.`);
  const resolvedHere = entities.Hallazgo.find(row => orderIds.has(String(row.orden_resolucion_id || '')) && !orderIds.has(String(row.orden_origen_id || '')));
  if (resolvedHere) throw new ValidationError(`El hallazgo ${resolvedHere.codigo} se resolvió en ${code(resolvedHere.orden_resolucion_id)} pero nació ${resolvedHere.orden_origen_id ? `en ${code(resolvedHere.orden_origen_id)}` : 'fuera de esta solicitud'}. Revisa su resolución antes de corregir el equipo.`);
  const plan = entities.PlanPM.find(row => orderIds.has(String(row.base_orden_id || '')));
  if (plan) throw new ValidationError(`El plan de mantenimiento ${plan.codigo} usa ${code(plan.base_orden_id)} como base. Guarda una nueva versión del plan antes de corregir el equipo.`);
  // Cualquier otro vínculo (una lectura aprobada desde un envío del cliente, otra solicitud…) quedaría con el equipo anterior.
  const moved = new Set([...operations, ...readings, ...parts, ...labor, ...findings].map(row => row.id));
  for (const [entity, rows] of Object.entries(entities) as [EntityName, EntityRecord[]][]) if (entity !== 'Bitacora') {
    const other = rows.find(row => !moved.has(row.id) && Object.entries(row).some(([key, value]) => key !== 'id' && typeof value === 'string' && moved.has(value)));
    if (other) throw new ValidationError(`${other.codigo} está vinculado a esta operación y no se mueve con ella; requiere revisión antes de corregir el equipo.`);
  }
  // Cada lectura movida debe caber en la secuencia del equipo correcto, entre su lectura anterior y la posterior.
  const targetReadings = meterReadings(entities, target.id);
  for (const row of readings) if (typeof row.valor === 'number' && Number.isFinite(time(row))) {
    const at = time(row);
    const same = targetReadings.find(item => time(item) === at && item.valor !== row.valor);
    if (same) throw new ValidationError(`La lectura ${reading(row)} coincide en fecha y hora con ${reading(same)} de ${machineName(target)} y tiene otro valor. Revisa esa lectura antes de corregir el equipo.`);
    const previous = targetReadings.filter(item => time(item) < at).at(-1), following = targetReadings.find(item => time(item) > at);
    if (previous && row.valor < Number(previous.valor)) throw new ValidationError(`La lectura ${reading(row)} es menor que la lectura anterior ${reading(previous)} de ${machineName(target)}. Revisa esa lectura antes de corregir el equipo.`);
    if (following && row.valor > Number(following.valor)) throw new ValidationError(`La lectura ${reading(row)} es mayor que la lectura posterior ${reading(following)} de ${machineName(target)}. Revisa esa lectura antes de corregir el equipo.`);
  }
  return { ticket, orders, readings, parts, labor, findings, source, target, adminOnly };
}

/** Resumen para la ventana de confirmación; se calcula antes de mover nada. */
export function equipmentCorrectionSummary(plan: EquipmentCorrectionPlan, entities: Database['entities']): EquipmentCorrectionSummary {
  const last = meterReadings(entities, plan.target.id).at(-1);
  // Una orden abierta con horómetro capturado y sin lectura todavía: el cierre lo rechazará si queda por debajo.
  const avisos = last ? plan.orders.filter(row => row.estado !== 'Completada' && typeof row.horometro === 'number' && row.horometro < Number(last.valor) && !plan.readings.some(item => item.orden_id === row.id && item.valor === row.horometro))
    .map(row => `${row.codigo} tiene capturado un horómetro de ${formatNumber(Number(row.horometro))} h, menor que los ${formatNumber(Number(last.valor))} h de la última lectura de ${machineName(plan.target)}. Corrígelo al continuar la atención.`) : [];
  return {
    solicitud: String(plan.ticket?.codigo || ''), ordenes: plan.orders.map(row => String(row.codigo)),
    lecturas: plan.readings.map(row => ({ codigo: String(row.codigo), valor: typeof row.valor === 'number' ? row.valor : null, fecha: String(row.fecha || '') })),
    repuestos: plan.parts.length, horas: plan.labor.length, hallazgos: plan.findings.length,
    equipo_anterior_id: plan.source.id, equipo_nuevo_id: plan.target.id, solo_administracion: plan.adminOnly,
    ultima_lectura_destino: last ? { valor: Number(last.valor), fecha: String(last.fecha) } : null, avisos, aplicado: false,
  };
}
