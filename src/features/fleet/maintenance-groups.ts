import type { EntityRecord } from '../../domain/model';
import { validDay, type PlanProjection } from '../../domain/maintenance-plan';
import { serviceKind } from '../../domain/vocabulary';
import { clientDisplayName } from '../../domain/client-profile';

export interface MaintenanceCycle { type: 'Preventivo' | 'Mayor'; plan?: EntityRecord; projection: PlanProjection }
export interface MaintenanceRow { equipment: EntityRecord; client?: EntityRecord; plans: MaintenanceCycle[] }

/** Ciclos que ya alcanzaron su objetivo o están por alcanzarlo: son los que hay que programar. */
export const dueStates = ['Vencido', 'Vence hoy', 'Por vencer'];
const urgencyRank = (status: string) => ['Vencido', 'Vence hoy'].includes(status) ? 0 : status === 'Por vencer' ? 1 : ['Sin plan', 'En pausa'].includes(status) ? 4 : status === 'Al día' ? 3 : 2;

/**
 * Orden programada o en ejecución, con fecha válida (excluye borradores) del mismo equipo y tipo de mantenimiento.
 * Es la visita que atiende el ciclo: si existe, el ciclo está programado.
 */
export function scheduledOrder(equipmentId: string, type: MaintenanceCycle['type'], orders: EntityRecord[]) {
  return orders.filter(row => row.equipo_id === equipmentId && row.schema_operacion === 1 && ['Programada', 'En proceso', 'En espera'].includes(String(row.estado)) && validDay(row.fecha_programada) && serviceKind(row) === type)
    .sort((a, b) => String(a.fecha_programada || '9999').localeCompare(String(b.fecha_programada || '9999')))[0];
}

/** Urgencia del equipo: su ciclo más apremiante y, a igual estado, el que tiene menos margen. */
export function rowUrgency(row: MaintenanceRow): [number, number] {
  return row.plans.map(item => [urgencyRank(item.projection.status), item.projection.remaining ?? Number.MAX_SAFE_INTEGER] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])[0] ?? [5, 0];
}
const byUrgency = (a: MaintenanceRow, b: MaintenanceRow) => { const [ra, ma] = rowUrgency(a), [rb, mb] = rowUrgency(b); return ra - rb || ma - mb || String(a.equipment.id_interno_cliente || a.equipment.codigo).localeCompare(String(b.equipment.id_interno_cliente || b.equipment.codigo), 'es'); };

export interface MaintenanceSite { id: string; name: string; rows: MaintenanceRow[] }
export interface MaintenanceGroup {
  id: string; name: string; sites: MaintenanceSite[]; unconfigured: MaintenanceRow[]; equipmentCount: number;
  due: number; upcoming: number; scheduled: number; unscheduled: number; withoutPlan: number; configured: number; cycles: number;
}

/**
 * Agrupa la flota por cliente y sede para programar visitas por lugar.
 * Clientes con ciclos vencidos primero, luego los que tienen más ciclos por vencer; dentro de cada sede, por urgencia.
 * Los equipos sin ningún plan también se enumeran en `unconfigured` para poder resumirlos sin perder su sede.
 */
export function maintenanceGroups(rows: MaintenanceRow[], sites: EntityRecord[], orders: EntityRecord[]): MaintenanceGroup[] {
  const groups = new Map<string, MaintenanceGroup>();
  for (const row of rows) {
    const id = String(row.equipment.cliente_id || '');
    const group = groups.get(id) ?? { id, name: row.client ? clientDisplayName(row.client) : 'Patio EMSA · sin cliente', sites: [], unconfigured: [], equipmentCount: 0, due: 0, upcoming: 0, scheduled: 0, unscheduled: 0, withoutPlan: 0, configured: 0, cycles: 0 };
    groups.set(id, group); group.equipmentCount++;
    for (const item of row.plans) {
      group.cycles++;
      if (!item.plan) { group.withoutPlan++; continue; }
      group.configured++;
      if (['Vencido', 'Vence hoy'].includes(item.projection.status)) group.due++;
      if (item.projection.status === 'Por vencer') group.upcoming++;
      if (dueStates.includes(item.projection.status)) { if (scheduledOrder(String(row.equipment.id), item.type, orders)) group.scheduled++; else group.unscheduled++; }
    }
    if (row.plans.every(item => !item.plan)) group.unconfigured.push(row);
    const siteId = String(row.equipment.sede_id || '');
    let site = group.sites.find(item => item.id === siteId);
    if (!site) { site = { id: siteId, name: String(sites.find(item => item.id === siteId)?.nombre || 'Sin sede asignada'), rows: [] }; group.sites.push(site); }
    site.rows.push(row);
  }
  for (const group of groups.values()) {
    for (const site of group.sites) site.rows.sort(byUrgency);
    group.sites.sort((a, b) => byUrgency(a.rows[0], b.rows[0]) || a.name.localeCompare(b.name, 'es'));
    group.unconfigured.sort((a, b) => String(a.equipment.id_interno_cliente || a.equipment.codigo).localeCompare(String(b.equipment.id_interno_cliente || b.equipment.codigo), 'es'));
  }
  return [...groups.values()].sort((a, b) => b.due - a.due || b.upcoming - a.upcoming || b.configured - a.configured || a.name.localeCompare(b.name, 'es'));
}

/** Avance del ciclo en porcentaje (0–100), si el plan tiene objetivo y margen calculados. */
export function cyclePercent(cycle: MaintenanceCycle) {
  const interval = Number(cycle.plan?.intervalo);
  if (!cycle.plan || !Number.isFinite(cycle.projection.remaining) || cycle.projection.remaining === undefined || !Number.isFinite(interval) || interval <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((interval - cycle.projection.remaining) / interval * 100)));
}
