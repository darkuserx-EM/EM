import { describe, expect, it } from 'vitest';
import type { EntityRecord } from './model';
import { currentWork, equipmentAttention, filterAttention, latestReading, matchingFleet, recentHomeActivity } from './home-overview';
const row = (id: string, fields: Record<string, string | number | boolean | null> = {}): EntityRecord => ({id, codigo:id, creado_por:'admin', actualizado_por:'admin', fecha_creacion:'2026-10-10T12:00:00Z', fecha_actualizacion:'2026-10-10T12:00:00Z', ...fields});
const today = '2026-10-10';
const equipment = [row('TCE-1', {marca:'Crown', modelo:'RD', serie:'S123', cliente_id:'c1', estado_operativo:'Operativo'}), row('TCE-2', {cliente_id:'c2', estado_operativo:'Pendiente de revisión'})];
const plan = (equipmentId: string, fields = {}) => row(`plan-${equipmentId}`, {schema_plan:1, equipo_id:equipmentId, tipo_plan:'Preventivo', vigente:true, estado_plan:'Activo', base_confirmada:true, base_origen:'Base inicial', base_fecha:'2026-10-01', base_calidad:'Registrada', criterio:'Días', intervalo:30, ...fields});
describe('inicio operativo', () => {
  it('busca por ID, serie y nombre comercial sin mezclar clientes ni equipos retirados', () => {
    const fleet = [...equipment, row('retired', {serie:'S123', estado_administrativo:'Baja'})];
    const clients = [row('c1', {nombre:'Empresa', nombre_comercial:'Logística'})];
    expect(matchingFleet(fleet, clients, '', 'logistica').map(row => row.id)).toEqual(['TCE-1']);
    expect(matchingFleet(fleet, clients, '', 's123').map(row => row.id)).toEqual(['TCE-1']);
    expect(matchingFleet(fleet, clients, 'c2', 's123')).toEqual([]);
  });
  it('separa desconocido, sin lectura y sin plan; no presume que todo equipo está operativo', () => {
    const readings = [row('meter', {equipo_id:'TCE-1', valor:0, fecha:'2026-10-09T10:00:00Z'})];
    const result = equipmentAttention(equipment, readings, [plan('TCE-1')], [], [], true, today);
    expect(filterAttention(result, 'unknown').map(row => row.equipment.id)).toEqual(['TCE-2']);
    expect(filterAttention(result, 'missingReading').map(row => row.equipment.id)).toEqual(['TCE-2']);
    expect(filterAttention(result, 'missingPlan')).toHaveLength(1);
    expect(result.find(row => row.equipment.id === 'TCE-1')?.reasons).toEqual([]);
  });
  it('no confunde planes ocultos por permisos con planes faltantes', () => {
    const result = equipmentAttention(equipment, [], [], [], [], false, today);
    expect(filterAttention(result, 'missingPlan')).toEqual([]);
    expect(result.every(row => row.projection === undefined)).toBe(true);
  });
  it('ordena un hallazgo crítico antes de captura pendiente y excluye hallazgos resueltos', () => {
    const result = equipmentAttention(equipment, [], [], [], [row('open', {equipo_id:'TCE-1', prioridad:'Crítica', estado:'Abierto'}), row('closed', {equipo_id:'TCE-2', prioridad:'Crítica', estado:'Resuelto'})], true, today);
    expect(result[0].equipment.id).toBe('TCE-1');
    expect(filterAttention(result, 'critical')).toHaveLength(1);
  });
  it('mantiene visible el mantenimiento mayor vencido aunque el preventivo esté al día', () => {
    const result = equipmentAttention([equipment[0]], [], [plan('TCE-1'), plan('TCE-1', {id:'major', tipo_plan:'Mayor', criterio:'Horas', base_horas:0, intervalo:2000})], [], [], true, today);
    expect(result[0].overdue).toBe(false);
    const readings = [row('meter', {equipo_id:'TCE-1', valor:2100, fecha:'2026-10-09T10:00:00Z'})];
    const overdue = equipmentAttention([equipment[0]], readings, [plan('TCE-1'), plan('TCE-1', {id:'major', tipo_plan:'Mayor', criterio:'Horas', base_horas:0, intervalo:2000})], [], [], true, today);
    expect(overdue[0].reasons).toContain('Mantenimiento mayor: vencido');
    expect(filterAttention(overdue, 'overdue')).toHaveLength(1);
  });
  it('la agenda excluye importados, borradores y canceladas; las cerradas no son atrasadas', () => {
    const orders = [row('historical', {fecha_programada:today, estado:'Pendiente'}), row('draft', {schema_operacion:1, fecha_programada:today, estado:'Borrador'}), row('cancelled', {schema_operacion:1, fecha_programada:today, estado:'Cancelada'}), row('done', {schema_operacion:1, fecha_programada:'2026-10-09', estado:'Completada'}), row('late', {schema_operacion:1, fecha_programada:'2026-10-09', estado:'En espera'}), row('today', {schema_operacion:1, fecha_programada:today, estado:'Programada'})];
    expect(currentWork(orders, today).late.map(row => row.id)).toEqual(['late']);
    expect(currentWork(orders, today).today.map(row => row.id)).toEqual(['today']);
    expect(currentWork(orders, today).open).toHaveLength(3);
  });
  it('elige la lectura por instante, tolera fecha inválida y conserva cero', () => {
    const readings = [row('bad', {equipo_id:'TCE-1', fecha:'n/a', valor:100}), row('zero', {equipo_id:'TCE-1', fecha:'2026-10-09T12:00:00Z', valor:0})];
    expect(latestReading(readings, 'TCE-1')?.id).toBe('zero');
    expect(latestReading(readings, 'TCE-2')).toBeUndefined();
  });
  it('actividad reciente usa registros de operación actual y no revela estados internos al técnico', () => {
    const machines = [row('eq', {estado_actualizado_el:'2026-10-10T13:00:00Z', estado_operativo:'Operativo'})];
    const orders = [row('history', {equipo_id:'eq', estado:'Completado'}), row('current', {equipo_id:'eq', schema_operacion:1, estado:'Programada'})];
    const readings = [row('import', {equipo_id:'eq', valor:3}), row('manual', {equipo_id:'eq', valor:5, schema_operacion:1})];
    expect(recentHomeActivity(machines, orders, readings).map(row => row.id)).toEqual(['state-eq','order-current','reading-manual']);
    expect(recentHomeActivity(machines, orders, readings, true).map(row => row.id)).toEqual(['order-current']);
    const projectedReading = row('scoped', {equipo_id:'eq', orden_id:'current', valor:6});
    expect(recentHomeActivity(machines, orders, [projectedReading], true).map(row => row.id)).toContain('reading-scoped');
  });
});
