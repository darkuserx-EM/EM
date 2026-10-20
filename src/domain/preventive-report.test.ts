import {expect,it} from 'vitest';
import {preventiveReport} from './preventive-report';
import type {EntityRecord} from './model';
import {filterVisible} from './permissions';
import {matchesMaintenanceFleet} from './maintenance-fleet';
const row=(v:Record<string,unknown>)=>v as EntityRecord;
const machines=[row({id:'a',codigo:'A'}),row({id:'b',codigo:'B'})];
const plan=(id:string,date:string)=>row({id:'p'+id,equipo_id:id,schema_plan:1,vigente:true,tipo_plan:'Preventivo',criterio:'Días',intervalo:30,base_origen:'Base inicial',base_confirmada:true,base_fecha:date,base_calidad:'Registrada',estado_plan:'Activo'});
it('cuenta cada equipo una vez y excluye citas, cancelaciones, otros servicios y equipos ajenos',()=>{
 const orders=[row({id:'1',equipo_id:'a',tipo:'Preventivo',estado:'Completada',fecha:'2026-10-01'}),row({id:'2',equipo_id:'a',tipo:'Mantenimiento preventivo',estado:'Completado',fecha:'2026-10-02'}),row({equipo_id:'b',tipo:'Preventivo',estado:'Programada',fecha_programada:'2026-10-01'}),row({equipo_id:'other',tipo:'Preventivo',estado:'Completada',fecha:'2026-10-02'}),row({equipo_id:'b',tipo:'Correctivo',estado:'Completada',fecha:'2026-10-02'})];
 const result=preventiveReport(machines,[],[],orders,'2026-10-01','2026-10-31','2026-10-20');expect(result.completed).toBe(1);expect(result.coverage).toBe(50);expect(result.unknown).toBe(2);
});
it('ordena vencidos antes de futuros y no inventa fecha para bases pendientes',()=>{
 const result=preventiveReport([...machines,row({id:'c',codigo:'C'})],[plan('a','2026-10-01'),plan('b','2026-09-01')],[],[],'2026-10-01','2026-10-31','2026-10-20');expect(result.pending.map(x=>x.machine.id)).toEqual(['b','a','c']);expect(result.overdue).toBe(1);expect(result.pending[2].projection.target).toBeUndefined();
});
it('no confunde horas con fecha y conserva pausados sin alertas',()=>{
 const paused={...plan('b','2026-09-01'),estado_plan:'Pausado'};const hours={...plan('a','2026-09-01'),criterio:'Horas',base_horas:100,intervalo:250};const r=preventiveReport(machines,[paused,hours],[],[],'2026-10-01','2026-10-31','2026-10-20');expect(r.pending).toHaveLength(1);expect(r.pending[0].projection.target).toBe(350);
});
it('un borrador no cuenta como programación y vacío no es 0% de cumplimiento',()=>{
 const r=preventiveReport(machines,[],[],[row({equipo_id:'a',tipo:'Preventivo',schema_operacion:1,estado:'Borrador',fecha_programada:'2026-10-25'})],'2026-10-01','2026-10-31','2026-10-20');expect(r.pending[0].scheduled).toBeUndefined();expect(preventiveReport([],[],[],[],'','','2026-10-20').coverage).toBeNull();
});
it('el cliente recibe solo clasificación de renta de sus equipos, nunca planes ni estado administrativo',()=>{
 const actor={id:'u',nombre:'QA',rol:'Cliente' as const,cliente_id:'c'};const equipment=[row({id:'a',cliente_id:'c',propiedad:'Propio',estado_administrativo:'En renta'}),row({id:'b',cliente_id:'other',propiedad:'Propio',estado_administrativo:'En renta'})];
 const entities={Equipo:equipment} as Parameters<typeof filterVisible>[3];const visible=filterVisible(actor,'Equipo',equipment,entities);expect(visible).toHaveLength(1);expect(matchesMaintenanceFleet(visible[0],'En renta')).toBe(true);expect(visible[0].estado_administrativo).toBeUndefined();expect(filterVisible(actor,'PlanPM',[plan('a','2026-09-01')],entities)).toEqual([]);
});

it('distingue una base pendiente de un plan inexistente sin inventar vencimientos',()=>{
 const pending={...plan('a','2026-09-01'),base_origen:'Pendiente',base_confirmada:false,base_fecha:''};
 const r=preventiveReport(machines,[pending],[],[],'2026-10-01','2026-10-31','2026-10-20');
 expect(r.basePending).toBe(1);expect(r.unknown).toBe(2);expect(r.overdue).toBe(0);
});
it('aplica el mismo conjunto de reportes al indicador y conserva programación fuera del período',()=>{
 const historic=row({id:'old',equipo_id:'a',tipo:'Preventivo',estado:'Completada',fecha:'2026-10-02'});
 const scheduled=row({id:'next',equipo_id:'a',tipo:'Preventivo',estado:'Programada',schema_operacion:1,fecha_programada:'2026-11-02'});
 const r=preventiveReport(machines,[],[],[historic,scheduled],'2026-10-01','2026-10-31','2026-10-20',[]);
 expect(r.completed).toBe(0);expect(r.pending[0].scheduled?.id).toBe('next');
});
