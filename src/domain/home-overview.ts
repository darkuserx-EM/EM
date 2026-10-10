import type { EntityRecord } from './model';
import { clientDisplayName } from './client-profile';
import { findingClosed } from './equipment-findings';
import { maintenanceState, operationalState, retiredEquipment } from './equipment-status';
import { currentPlan, planStatusLabel, projectPlan, todayGT, validDay, type PlanProjection } from './maintenance-plan';
import { operationalOrders } from './planning';

export const normalizeSearch = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
export function matchingFleet(equipment: EntityRecord[], clients: EntityRecord[], clientId: string, search: string) {
  const query = normalizeSearch(search).trim();
  const names = new Map(clients.map(row => [row.id, `${clientDisplayName(row)} ${row.nombre}`]));
  return equipment.filter(row => !retiredEquipment(row) && (!clientId || row.cliente_id === clientId) &&
    normalizeSearch(`${row.codigo} ${row.id_interno_cliente || ''} ${row.marca} ${row.modelo} ${row.serie} ${names.get(String(row.cliente_id)) || ''}`).includes(query));
}
export function latestReading(readings: EntityRecord[], equipmentId: string) {
  return readings.filter(row => row.equipo_id === equipmentId && typeof row.valor === 'number' && Number.isFinite(row.valor) && row.valor >= 0 && Number.isFinite(Date.parse(String(row.fecha))))
    .sort((a, b) => Date.parse(String(b.fecha)) - Date.parse(String(a.fecha)))[0];
}
export type AttentionFilter = 'attention' | 'all' | 'unknown' | 'missingReading' | 'missingPlan' | 'critical' | 'overdue';
export interface EquipmentAttention {
  equipment: EntityRecord; reading?: EntityRecord; projection?: PlanProjection; unknown: boolean; missingReading: boolean;
  missingPlan: boolean; critical: boolean; overdue: boolean; reasons: string[]; rank: number;
}
export function equipmentAttention(equipment: EntityRecord[], readings: EntityRecord[], plans: EntityRecord[], orders: EntityRecord[], findings: EntityRecord[], showPlans: boolean, today = todayGT()): EquipmentAttention[] {
  return equipment.map(machine => {
    const state = operationalState(machine), reading = latestReading(readings, machine.id);
    const plan = showPlans ? currentPlan(plans, machine.id, 'Preventivo') : undefined;
    const projection = showPlans ? projectPlan(plan, readings, orders, today) : undefined;
    const majorPlan = showPlans ? currentPlan(plans, machine.id, 'Mayor') : undefined;
    const major = majorPlan ? projectPlan(majorPlan, readings, orders, today) : undefined;
    const unknown = state === 'Pendiente de revisión';
    const missingReading = !reading;
    const missingPlan = showPlans && (!plan || plan.base_confirmada !== true || plan.base_origen === 'Pendiente');
    const critical = findings.some(row => row.equipo_id === machine.id && !findingClosed(row) && row.estado !== 'Por confirmar' && row.prioridad === 'Crítica');
    const overdue = projection?.status === 'Vencido' || major?.status === 'Vencido';
    const reasons: string[] = [];
    if (critical) reasons.push('Hallazgo crítico abierto');
    if (state === 'No operativo') reasons.push('Equipo no operativo');
    if (projection?.status === 'Vencido') reasons.push(projection.estimated ? 'Preventivo vencido · estimado' : 'Preventivo vencido');
    if (major && !['Al día', 'En pausa'].includes(major.status)) reasons.push(`Mantenimiento mayor: ${planStatusLabel(major).toLocaleLowerCase('es')}`);
    if (state === 'En reparación' || state === 'En mantenimiento') reasons.push(state);
    if (maintenanceState(machine) === 'Mantenimiento pendiente') reasons.push('Mantenimiento pendiente');
    if (projection && ['Vence hoy', 'Por vencer', 'Revisar lecturas', 'Revisar base', 'Actualizar lectura', 'Base estimada', 'Base o lectura estimada'].includes(projection.status)) reasons.push(projection.status);
    if (unknown) reasons.push('Estado por confirmar');
    if (missingReading) reasons.push('Sin lectura registrada');
    if (missingPlan) reasons.push(plan ? 'Base del plan pendiente' : 'Sin plan preventivo');
    const rank = critical ? 0 : state === 'No operativo' ? 1 : overdue ? 2 : reasons.some(reason => !['Estado por confirmar', 'Sin lectura registrada', 'Base del plan pendiente', 'Sin plan preventivo'].includes(reason)) ? 3 : unknown ? 4 : reasons.length ? 5 : 6;
    return { equipment: machine, reading, projection, unknown, missingReading, missingPlan, critical, overdue, reasons, rank };
  }).sort((a, b) => a.rank - b.rank || a.equipment.codigo.localeCompare(b.equipment.codigo, 'es', { numeric: true }));
}
export function filterAttention(rows: EquipmentAttention[], filter: AttentionFilter) {
  return rows.filter(row => filter === 'all' || (filter === 'attention' ? row.reasons.length > 0 : row[filter]));
}
export function currentWork(orders: EntityRecord[], today = todayGT()) {
  const current = operationalOrders(orders);
  const open = current.filter(row => !['Completada', 'Cancelada'].includes(String(row.estado)));
  return {
    open,
    late: open.filter(row => validDay(row.fecha_programada) && row.fecha_programada < today),
    today: current.filter(row => row.fecha_programada === today && !['Borrador', 'Cancelada'].includes(String(row.estado)))
      .sort((a, b) => String(a.hora_programada || '99').localeCompare(String(b.hora_programada || '99'))),
  };
}
export interface HomeActivity { id: string; title: string; detail: string; at: string; href: string }
/** Use scoped operational records. Import timestamps and the full audit log are not an activity feed. */
export function recentHomeActivity(equipment: EntityRecord[], orders: EntityRecord[], readings: EntityRecord[], technician = false): HomeActivity[] {
  const machines = new Map(equipment.map(row => [row.id, row]));
  const label = (id: unknown) => { const row = machines.get(String(id)); return String(row?.id_interno_cliente || row?.codigo || 'Equipo'); };
  const items: HomeActivity[] = operationalOrders(orders).filter(row => machines.has(String(row.equipo_id))).map(row => ({
    id: `order-${row.id}`, title: `${row.codigo} · ${row.estado}`, detail: `${label(row.equipo_id)} · ${row.tipo}`, at: row.fecha_actualizacion, href: `/ordenes?orden=${encodeURIComponent(row.id)}`,
  }));
  for (const row of readings) if ((row.schema_operacion === 1 || technician && operationalOrders(orders).some(order => order.id === row.orden_id)) && machines.has(String(row.equipo_id)) && (!technician || orders.some(order => order.id === row.orden_id))) items.push({
    id: `reading-${row.id}`, title: `${label(row.equipo_id)} · ${Number(row.valor).toLocaleString('es-GT')} h`, detail: 'Lectura registrada', at: row.fecha_creacion,
    href: technician ? `/ordenes?orden=${encodeURIComponent(String(row.orden_id))}` : `/flota?equipo=${encodeURIComponent(String(row.equipo_id))}`,
  });
  if (!technician) for (const row of equipment) if (row.estado_actualizado_el) items.push({
    id: `state-${row.id}`, title: `${label(row.id)} · ${operationalState(row)}`, detail: 'Estado actualizado', at: String(row.estado_actualizado_el), href: `/flota?equipo=${encodeURIComponent(row.id)}`,
  });
  return items.filter(row => Number.isFinite(Date.parse(row.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
}
