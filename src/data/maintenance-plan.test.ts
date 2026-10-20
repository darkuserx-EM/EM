import { describe, it, expect } from 'vitest';
import { createSeed, demoUsers } from './seed';
import { LocalDataSource } from './repository';
import { makeBackup, parseBackup } from './excel';
import { addDays, currentPlan, planStatusLabel, projectPlan, planService } from '../domain/maintenance-plan';
import { validateDatabase } from '../domain/validation';
import type { EntityRecord, Scalar } from '../domain/model';

const admin = demoUsers[0];
const raw = { schema_plan:1, equipo_id:'equipment-1', tipo_plan:'Preventivo', criterio:'Horas', intervalo:250, estado_plan:'Activo', base_origen:'Base inicial', base_fecha:'2026-01-01', base_horas:1000, base_calidad:'Registrada', base_confirmada:true, motivo:'Base revisada de prueba' };
const row = (fields: Record<string, Scalar>): EntityRecord => ({id:crypto.randomUUID(),codigo:'TEST',creado_por:'test',actualizado_por:'test',fecha_creacion:'2026-01-01T12:00:00Z',fecha_actualizacion:'2026-01-01T12:00:00Z',...fields});
const plan = (fields: Record<string, Scalar> = {}) => row({...raw,...fields});
const reading = (date: string, value: number, fields: Record<string, Scalar> = {}) => row({equipo_id:'equipment-1',fecha:`${date}T12:00:00-06:00`,valor:value,...fields});
function fixture() { const db=createSeed(); let saved=JSON.stringify(db); const source=new LocalDataSource({getItem:()=>saved,setItem:(_k,v)=>{saved=v;}},{demoHistory:false}); return {source,repo:source.repository('PlanPM',admin)}; }

describe('planificación y calidad de la base',()=>{
  it('guarda intervalos personalizados por equipo con motivo y mantiene separados los ciclos',async()=>{
    const {source,repo}=fixture(); const before=source.snapshot(admin);
    const preventive=await repo.create({...raw,intervalo:500,motivo:'Intervalo revisado para la condición de uso de este equipo'});
    const major=await repo.create({...raw,tipo_plan:'Mayor',intervalo:3000,motivo:'Recomendación documentada para este equipo'});
    expect(projectPlan(preventive,[reading('2026-01-20',1400)],[],'2026-01-21')).toMatchObject({target:1500,remaining:100});
    expect(projectPlan(major,[reading('2026-01-20',1400)],[],'2026-01-21')).toMatchObject({target:4000,remaining:2600});
    const byDays=await repo.create({...raw,criterio:'Días',intervalo:45,base_horas:null,motivo:'Ciclo por días revisado'});
    expect(projectPlan(byDays,[],[],'2026-01-21').target).toBe('2026-02-15');
    expect(source.snapshot(admin).entities.Equipo).toEqual(before.entities.Equipo);
    expect(source.snapshot(admin).entities.LecturaHorometro).toEqual(before.entities.LecturaHorometro);
  });
  it('reconoce el tipo de mantenimiento de reportes históricos y de captura actual',()=>{
    for(const tipo of ['Mantenimiento Mayor','Mantenimiento mayor']) for(const estado of ['Completado','Completada']) expect(planService(row({equipo_id:'equipment-1',tipo,estado}),'equipment-1','Mayor')).toBe(true);
    for(const tipo of ['Preventivo','Mantenimiento Preventivo','Mantenimiento preventivo']) expect(planService(row({equipo_id:'equipment-1',tipo,estado:'Completado'}),'equipment-1','Preventivo')).toBe(true);
    expect(planService(row({equipo_id:'equipment-1',tipo:'Correctivo',estado:'Completado'}),'equipment-1','Mayor')).toBe(false);
  });
  it('una nueva orden completada sirve como base revisada de mayor y evidencia de hallazgo',async()=>{
    const {source,repo}=fixture(); const orders=source.repository('OrdenServicio',admin);
    const order=await orders.create({equipo_id:'equipment-1',cliente_id:'client-1',sintoma:'Inspección mayor',tipo:'Mantenimiento mayor',prioridad:'Media',estado:'Programada',fecha_programada:'2026-10-10',tecnico_id:'tech-1'});
    await orders.update(order.id,{estado:'En proceso'});
    const completed=await orders.update(order.id,{estado:'Completada',diagnostico:'Revisión de componentes',trabajo_realizado:'Servicio mayor realizado',pruebas_realizadas:'Prueba de elevación y freno',resultado_pruebas:'Satisfactoria',horometro:900});
    const major=await repo.create({...raw,tipo_plan:'Mayor',intervalo:2000,base_origen:'Servicio',base_orden_id:completed.id,motivo:'Base revisada después del mantenimiento mayor'});
    expect(major.base_horas).toBe(900); expect(major.base_orden_id).toBe(completed.id);
    const findings=source.repository('Hallazgo',admin);const finding=await findings.create({equipo_id:'equipment-1',descripcion:'Revisión de componentes antes de liberar',componente:'Hidráulico',prioridad:'Alta',estado:'Abierto'});
    const resolved=await findings.update(finding.id,{estado:'Resuelto',orden_resolucion_id:completed.id,detalle_resolucion:'Componentes revisados y prueba documentada.',nota_cambio:'Evidencia validada'});
    expect(resolved.estado).toBe('Resuelto');expect(resolved.orden_resolucion_id).toBe(completed.id);
  });
  it('calcula 250 h y 2,000 h sin mezclar ciclos y respeta el límite exacto',()=>{
    expect(projectPlan(plan(),[reading('2026-01-20',1249)],[],'2026-01-21')).toMatchObject({target:1250,remaining:1,status:'Por vencer'});
    expect(projectPlan(plan(),[reading('2026-01-20',1250)],[],'2026-01-21')).toMatchObject({remaining:0,status:'Vencido'});
    expect(projectPlan(plan({tipo_plan:'Mayor',intervalo:2000}),[reading('2026-01-20',1300)],[],'2026-01-21')).toMatchObject({target:3000,remaining:1700});
  });
  it.each([30,60,90])('calcula %i días calendario desde una base confirmada',intervalo=>{
    const result=projectPlan(plan({criterio:'Días',intervalo,base_fecha:'2026-01-31',base_horas:null}),[],[],'2026-02-01');
    expect(result.target).toBe(addDays('2026-01-31',intervalo)); expect(result.remaining).toBe(intervalo-1);
  });
  it('distingue fecha exacta, atraso, año bisiesto y día local de Guatemala',()=>{
    const p=plan({criterio:'Días',intervalo:30,base_fecha:'2024-01-31',base_horas:null});
    expect(projectPlan(p,[],[],'2024-03-01').status).toBe('Vence hoy');
    expect(projectPlan(p,[],[],'2024-03-02')).toMatchObject({status:'Vencido',remaining:-1});
    const midnight=reading('2026-01-20',1100,{fecha:'2026-01-21T02:00:00Z'});
    expect(projectPlan(plan(),[midnight],[],'2026-01-20').latestDay).toBe('2026-01-20');
  });
  it('no inventa base, lectura actual o vencimiento al pausar',()=>{
    expect(projectPlan(undefined,[]).status).toBe('Sin plan');
    expect(projectPlan(plan({base_origen:'Pendiente',base_fecha:'',base_horas:null}),[]).target).toBeUndefined();
    expect(projectPlan(plan({estado_plan:'Pausado'}),[]).status).toBe('En pausa');
    expect(projectPlan(plan(),[],[],'2026-02-10')).toMatchObject({status:'Actualizar lectura',latest:1000});
  });
  it('detecta disminución aunque luego se recupere, lecturas futuras y lecturas simultáneas distintas',()=>{
    for(const rows of [[reading('2026-01-02',1200),reading('2026-01-03',50),reading('2026-01-04',1300)],[reading('2026-02-02',1200)],[reading('2026-01-02',1100),reading('2026-01-02',1200)]]) {
      expect(projectPlan(plan(),rows,[],'2026-01-31')).toMatchObject({status:'Revisar lecturas'});
      expect(projectPlan(plan(),rows,[],'2026-01-31').target).toBeUndefined();
    }
  });
  it('conserva las estimaciones y nunca las proyecta como definitivas',()=>{
    expect(projectPlan(plan({base_calidad:'Estimada'}),[reading('2026-01-20',1200)],[],'2026-01-21')).toMatchObject({estimated:true,status:'Base o lectura estimada',tone:'warning'});
    const p=projectPlan(plan(),[reading('2026-01-02',1050),reading('2026-01-16',1100,{es_estimado:true}),reading('2026-01-30',1200)],[],'2026-01-31');
    expect(p.estimated).toBe(true);expect(p.forecast).toBeUndefined();
  });
  it('una estimación no oculta un vencimiento por horas ni por días',()=>{
    const byHours=projectPlan(plan({base_calidad:'Estimada'}),[reading('2026-01-20',1400)],[],'2026-01-21');
    expect(byHours).toMatchObject({estimated:true,status:'Vencido',tone:'danger',remaining:-150});
    expect(planStatusLabel(byHours)).toBe('Vencido · estimado');
    const estimatedReading=projectPlan(plan(),[reading('2026-01-20',1310,{es_estimado:true})],[],'2026-01-21');
    expect(estimatedReading).toMatchObject({estimated:true,status:'Vencido',tone:'danger'});
    const days=plan({criterio:'Días',intervalo:90,base_fecha:'2026-01-01',base_horas:null,base_calidad:'Estimada'});
    expect(projectPlan(days,[],[],'2026-04-15')).toMatchObject({estimated:true,status:'Vencido',tone:'danger'});
    expect(projectPlan(days,[],[],'2026-04-01')).toMatchObject({estimated:true,status:'Vence hoy'});
    expect(projectPlan(days,[],[],'2026-03-01')).toMatchObject({estimated:true,status:'Base estimada'});
    expect(planStatusLabel(projectPlan(plan(),[reading('2026-01-20',1300)],[],'2026-01-21'))).toBe('Vencido');
  });
  it('un vencimiento con lectura antigua sigue siendo vencido',()=>{
    expect(projectPlan(plan(),[reading('2026-01-20',1300)],[],'2026-03-01')).toMatchObject({status:'Vencido',tone:'danger'});
  });
  it('proyecta solo con tres lecturas recientes comparables y ritmo positivo',()=>{
    const rows=[reading('2026-01-02',1000),reading('2026-01-16',1100),reading('2026-01-30',1200)];
    expect(projectPlan(plan(),rows,[],'2026-01-31').forecast).toBe('2026-02-06');
    expect(projectPlan(plan(),rows.slice(1),[],'2026-01-31').forecast).toBeUndefined();
    expect(projectPlan(plan(),[rows[0],rows[0],rows[2]],[],'2026-01-31').forecast).toBeUndefined();
    expect(projectPlan(plan(),rows,[],'2026-03-03')).toMatchObject({status:'Actualizar lectura'});
    expect(projectPlan(plan(),rows,[],'2026-03-03').forecast).toBeUndefined();
    expect(projectPlan(plan(),rows.map(r=>({...r,valor:1000})),[],'2026-01-31').forecast).toBeUndefined();
  });
  it('guarda versiones independientes, autoría confiable y datos intactos',async()=>{
    const {source,repo}=fixture();const before=source.snapshot(admin);
    const first=await repo.create({...raw,version:99,confirmado_por:'Falso',vigente:false});
    const major=await repo.create({...raw,tipo_plan:'Mayor',intervalo:2000});
    const second=await repo.create({...raw,criterio:'Días',intervalo:60,base_horas:null,motivo:'Nuevo criterio'});
    const after=source.snapshot(admin);
    expect(first.version).toBe(1);expect(first.confirmado_por).toBe(admin.nombre);
    expect(second.version).toBe(2);expect(second.anterior_id).toBe(first.id);
    expect(after.entities.PlanPM.find(r=>r.id===first.id)?.vigente).toBe(false);
    expect(currentPlan(after.entities.PlanPM,'equipment-1','Mayor')?.id).toBe(major.id);
    expect(after.entities.Bitacora.filter(r=>r.entidad==='PlanPM')).toHaveLength(3);
    for(const entity of ['Equipo','LecturaHorometro','OrdenServicio'] as const) expect(after.entities[entity]).toEqual(before.entities[entity]);
    await expect(repo.update(first.id,{intervalo:90})).rejects.toThrow('nueva versión');
    await expect(repo.remove(first.id)).rejects.toThrow('Conserva');
  });
  it('rechaza planes incompletos y conserva la versión vigente ante un error',async()=>{
    const {source,repo}=fixture(); await repo.create(raw);const before=source.snapshot(admin);
    const changes: Record<string,Scalar>[]=[{equipo_id:'missing'},{intervalo:0},{intervalo:20001},{intervalo:2.5},{criterio:'Días',intervalo:3651},{base_fecha:'2026-02-30'},{base_fecha:'2099-01-01'},{base_horas:null},{base_confirmada:false},{tipo_plan:'Mayor',criterio:'Días',intervalo:30},{motivo:''},{schema_plan:2}];
    for(const change of changes) { await expect(repo.create({...raw,...change})).rejects.toThrow();expect(source.snapshot(admin)).toEqual(before); }
    await expect(repo.create({equipo_id:'equipment-1'})).rejects.toThrow('formulario');
  });
  it('base de servicio requiere equipo, tipo y estado correctos y conserva su estimación',async()=>{
    const db=createSeed();const service=db.entities.OrdenServicio[0];Object.assign(service,{fecha:'2026-01-01T12:00:00Z',tipo:'Mantenimiento Mayor',estado:'Completado',horometro:1234,horometro_estimado:true});let saved=JSON.stringify(db);
    const source=new LocalDataSource({getItem:()=>saved,setItem:(_k,v)=>{saved=v;}},{demoHistory:false});const repo=source.repository('PlanPM',admin);
    const candidate={...raw,equipo_id:service.equipo_id,base_origen:'Servicio',base_orden_id:service.id};
    await expect(repo.create(candidate)).rejects.toThrow('mismo equipo y tipo');
    const major=await repo.create({...candidate,tipo_plan:'Mayor',intervalo:2000});expect(major.base_horas).toBe(1234);expect(major.base_calidad).toBe('Estimada');
    await expect(repo.create({...candidate,tipo_plan:'Mayor',intervalo:2000,equipo_id:'equipment-2'})).rejects.toThrow();
  });
  it('respalda todas las versiones y restringe los planes a administración',async()=>{
    const {source,repo}=fixture();await repo.create(raw);await repo.create({...raw,estado_plan:'Pausado'});
    const backup=parseBackup(makeBackup(source.snapshot(admin)));expect(backup.entities.PlanPM).toHaveLength(2);
    for(const key of ['version','vigente','confirmado_por','confirmado_el','vigente_desde','anterior_id']) {
      const broken=structuredClone(backup);delete broken.entities.PlanPM[1][key];expect(()=>validateDatabase(broken)).toThrow();
    }
    const target=fixture();target.source.restore(admin,backup,target.source.getRevision());expect(target.source.snapshot(admin).entities.PlanPM).toEqual(source.snapshot(admin).entities.PlanPM);
    for(const actor of [demoUsers[1],demoUsers[2],demoUsers[5]]) {expect((await source.repository('PlanPM',actor).getAll()).length).toBe(actor.rol === 'Coordinador' ? 2 : 0);await expect(source.repository('PlanPM',actor).create(raw)).rejects.toThrow('administración');}
  });
});
