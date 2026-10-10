import { describe, expect, it } from 'vitest';
import { dashboardOrders, monthlyServices, orderDay } from './dashboard';
import type { EntityRecord } from './model';
const row = (fields: Partial<EntityRecord> = {}): EntityRecord => ({id:'order',codigo:'OS-001',creado_por:'qa',actualizado_por:'qa',fecha_creacion:'2026-10-11T02:00:00Z',fecha_actualizacion:'2026-10-11T02:00:00Z',...fields});
const filter = {from:'',to:'',client:'',equipment:'',origin:''};
describe('fechas y filtros del dashboard',()=>{
 it('conserva como sin fecha el histórico ausente o inválido y no interrumpe los gráficos',()=>{
   const rows=[row(),row({id:'invalid',fecha:'valor inválido'}),row({id:'impossible',fecha:'2026-02-30T12:00:00Z'}),row({id:'good',fecha:'2026-10-11T02:00:00Z'})];
   expect(rows.map(orderDay)).toEqual(['','','','2026-10-10']);
   expect(dashboardOrders(rows,filter)).toHaveLength(4);
   expect(monthlyServices(rows)).toEqual([{month:'2026-10',count:1}]);
   expect(dashboardOrders(rows,{...filter,to:'2026-10-31'})).toHaveLength(1);
 });
 it('usa fecha civil de agenda y reserva fecha de creación como respaldo de operación actual',()=>{
   expect(orderDay(row({schema_operacion:1,fecha_programada:'2026-10-12',fecha:'2026-10-11T02:00:00Z'}))).toBe('2026-10-12');
   expect(orderDay(row({schema_operacion:1}))).toBe('2026-10-10');
   expect(orderDay(row({schema_operacion:1,fecha_programada:'2026-02-30'}))).toBe('2026-10-10');
   expect(orderDay(row({fecha:'2026-10-10'}))).toBe('2026-10-10');
 });
});
