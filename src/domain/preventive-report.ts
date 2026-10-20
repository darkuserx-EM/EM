import type { EntityRecord } from './model';
import { currentPlan, projectPlan } from './maintenance-plan';
import { orderDay } from './dashboard';
import { isCompletedService, serviceKind } from './vocabulary';

/** Operates only on the rows already authorized for the viewer. Dates use Guatemala. */
export function preventiveReport(equipment: EntityRecord[], plans: EntityRecord[], readings: EntityRecord[], orders: EntityRecord[], from: string, to: string, today: string) {
  const ids = new Set(equipment.map(row => row.id));
  const completed = new Set(orders.filter(row => ids.has(String(row.equipo_id)) && serviceKind(row) === 'Preventivo' && isCompletedService(row) && !!row.fecha && orderDay(row) >= from && orderDay(row) <= to).map(row => row.equipo_id));
  const pending = equipment.map(machine => {
    const plan = currentPlan(plans, machine.id, 'Preventivo');
    const projection = projectPlan(plan, readings, orders, today);
    const scheduled = orders.filter(row => row.equipo_id === machine.id && serviceKind(row) === 'Preventivo' && row.schema_operacion === 1 && ['Programada','En proceso','En espera'].includes(String(row.estado)) && row.fecha_programada).sort((a,b) => String(a.fecha_programada).localeCompare(String(b.fecha_programada)))[0];
    return { machine, projection, scheduled };
  }).filter(row => row.projection.status !== 'En pausa').sort((a,b) => {
    const due = (s: string) => ['Vencido','Vence hoy'].includes(s) ? 0 : 1;
    return due(a.projection.status)-due(b.projection.status) || String(typeof a.projection.target === 'string' ? a.projection.target : '9999').localeCompare(String(typeof b.projection.target === 'string' ? b.projection.target : '9999')) || String(a.machine.codigo).localeCompare(String(b.machine.codigo));
  });
  return { completed: completed.size, coverage: equipment.length ? Math.round(completed.size / equipment.length * 100) : null, pending, overdue: pending.filter(row => ['Vencido','Vence hoy'].includes(row.projection.status)).length, unknown: pending.filter(row => row.projection.target === undefined).length };
}
