import { describe, expect, it } from 'vitest';
import type { EntityRecord } from '../../domain/model';
import type { PlanProjection } from '../../domain/maintenance-plan';
import { cyclePercent, maintenanceGroups, scheduledOrder, type MaintenanceRow } from './maintenance-groups';

const record = (values: Record<string, unknown>) => ({ codigo: '', creado_por: '', fecha_creacion: '', actualizado_por: '', fecha_actualizacion: '', ...values }) as EntityRecord;
const projection = (status: string, remaining?: number, tone: PlanProjection['tone'] = 'neutral'): PlanProjection => ({ status, tone, detail: '', remaining });
const plan = (intervalo = 250) => record({ id: `plan-${intervalo}`, intervalo, criterio: 'Horas' });
const row = (id: string, cliente: string, sede: string, preventive: PlanProjection, major: PlanProjection = projection('Sin plan'), withPlans = true): MaintenanceRow => ({
  equipment: record({ id, codigo: id.toUpperCase(), id_interno_cliente: id.toUpperCase(), cliente_id: cliente, sede_id: sede }),
  client: record({ id: cliente, nombre: cliente === 'c1' ? 'LAMFER' : 'Distelsa' }),
  plans: [{ type: 'Preventivo', plan: withPlans && preventive.status !== 'Sin plan' ? plan() : undefined, projection: preventive }, { type: 'Mayor', plan: withPlans && major.status !== 'Sin plan' ? plan(2000) : undefined, projection: major }],
});
const sites = [record({ id: 's1', nombre: 'B12 · Producto terminado' }), record({ id: 's2', nombre: 'B5 · Materia prima' }), record({ id: 's3', nombre: 'Unisur 4' })];

describe('mantenimiento agrupado por cliente y sede', () => {
  const rows = [
    row('rd11', 'c1', 's1', projection('Vencido', -12, 'danger')),
    row('sp04', 'c1', 's1', projection('Por vencer', 30, 'warning')),
    row('tce010', 'c1', 's2', projection('Por vencer', 11, 'warning')),
    row('sp02', 'c1', 's2', projection('Sin plan')),
    row('rd09', 'c2', 's3', projection('Al día', 111, 'good')),
    row('rd06', 'c2', 's3', projection('Sin plan')),
  ];
  const orders = [record({ id: 'o1', codigo: 'OS-131', equipo_id: 'sp04', schema_operacion: 1, estado: 'Programada', tipo: 'Preventivo', fecha_programada: '2026-10-23' }), record({ id: 'o2', codigo: 'OS-90', equipo_id: 'rd11', schema_operacion: 1, estado: 'Completada', tipo: 'Preventivo' })];
  const groups = maintenanceGroups(rows, sites, orders);

  it('ordena los clientes por urgencia y cuenta vencidos, por vencer, programados y sin programar', () => {
    expect(groups.map(group => group.name)).toEqual(['LAMFER', 'Distelsa']);
    expect(groups[0]).toMatchObject({ equipmentCount: 4, due: 1, upcoming: 2, scheduled: 1, unscheduled: 2, configured: 3, cycles: 8, withoutPlan: 5 });
  });
  it('separa por sede y ordena los equipos por urgencia; los equipos sin plan van aparte', () => {
    expect(groups[0].sites.map(site => [site.name, site.rows.map(item => item.equipment.id)])).toEqual([['B12 · Producto terminado', ['rd11', 'sp04']], ['B5 · Materia prima', ['tce010', 'sp02']]]);
    expect(groups[0].unconfigured.map(item => item.equipment.id)).toEqual(['sp02']);
    expect(groups[1].unconfigured.map(item => item.equipment.id)).toEqual(['rd06']);
  });
  it('una orden abierta del mismo equipo y tipo cuenta como visita programada; una completada no', () => {
    expect(scheduledOrder('sp04', 'Preventivo', orders)?.codigo).toBe('OS-131');
    expect(scheduledOrder('sp04', 'Mayor', orders)).toBeUndefined();
    expect(scheduledOrder('rd11', 'Preventivo', orders)).toBeUndefined();
  });
  it('calcula el avance del ciclo sin pasar de 0 a 100', () => {
    expect(cyclePercent(rows[1].plans[0])).toBe(88);
    expect(cyclePercent(rows[0].plans[0])).toBe(100);
    expect(cyclePercent(rows[3].plans[0])).toBeUndefined();
  });
});

 it('excluye borradores, fechas inválidas, otros equipos y servicios cerrados', () => {
   const order = record({ id: 'visit', equipo_id: 'e1', schema_operacion: 1, tipo: 'Preventivo', estado: 'Programada', fecha_programada: '2026-10-23' });
   for (const change of [{estado:'Borrador'}, {estado:'Completado'}, {estado:'Cancelada'}, {fecha_programada:''}, {fecha_programada:'2026-02-30'}, {equipo_id:'e2'}, {tipo:'Mayor'}, {schema_operacion:undefined}]) {
     expect(scheduledOrder('e1','Preventivo',[record({...order,...change})])).toBeUndefined();
   }
   expect(scheduledOrder('e1','Preventivo',[order])?.id).toBe('visit');
 });
 it('conserva sedes aunque todos sus equipos carezcan de plan', () => {
   const groups = maintenanceGroups([row('e1','c1','s1',projection('Sin plan')), row('e2','c1','s2',projection('Sin plan'))], sites, []);
   expect(groups[0].sites).toHaveLength(2);
   expect(groups[0].unconfigured).toHaveLength(2);
 });
 it('un preventivo programado no cubre el mayor vencido', () => {
   const groups = maintenanceGroups([row('e1','c1','s1',projection('Vencido',-1),projection('Vencido',-2))], sites, [record({id:'o1',equipo_id:'e1',schema_operacion:1,tipo:'Preventivo',estado:'Programada',fecha_programada:'2026-10-23'})]);
   expect(groups[0]).toMatchObject({due:2,scheduled:1,unscheduled:1});
 });
