import {beforeAll,expect,it} from 'vitest';
import {IncrementalValidation} from './incremental-validation';
import {validateDatabase} from './validation';
import {createSeed,demoUsers} from '../data/seed';
import {LocalDataSource} from '../data/repository';
import {entityNames,type Database,type EntityRecord,type Scalar} from './model';

const actor=demoUsers[0];
function row(id:string,fields:Record<string,Scalar>):EntityRecord {
  return {id,codigo:id,creado_por:actor.id,actualizado_por:actor.id,fecha_creacion:'2026-01-01T12:00:00.000Z',fecha_actualizacion:'2026-01-01T12:00:00.000Z',...fields};
}
async function fixture() {
  let saved=JSON.stringify(createSeed());const source=new LocalDataSource({getItem:()=>saved,setItem:(_key,value)=>{saved=value;}},{demoHistory:false});
  const contact=await source.repository('Contacto',actor).create({nombre:'Contacto',cliente_id:'client-1'});
  const site=await source.repository('Sede',actor).create({nombre:'Sede',cliente_id:'client-1',autoriza_contacto_id:contact.id});
  await source.repository('Equipo',actor).update('equipment-1',{sede_id:site.id});
  const ticket=await source.repository('Ticket',actor).create({equipo_id:'equipment-1',titulo:'Revisión',descripcion:'Prueba',responsable_id:'tech-1'});
  const orders=source.repository('OrdenServicio',actor);
  let order=await orders.create({equipo_id:'equipment-1',ticket_id:ticket.id,sintoma:'Inspección',tipo:'Preventivo',estado:'Programada',fecha_programada:'2026-10-10',tecnico_id:'tech-1'});
  order=await orders.update(order.id,{estado:'En proceso'});
  order=await orders.update(order.id,{estado:'Completada',diagnostico:'Revisión',trabajo_realizado:'Servicio',pruebas_realizadas:'Elevación',resultado_pruebas:'Satisfactoria',horometro:900});
  const planFields={schema_plan:1,equipo_id:'equipment-1',tipo_plan:'Preventivo',criterio:'Horas',intervalo:250,estado_plan:'Activo',base_origen:'Servicio',base_orden_id:order.id,base_confirmada:true,motivo:'Prueba'};
  await source.repository('PlanPM',actor).create(planFields);
  await source.repository('PlanPM',actor).create({...planFields,intervalo:500});
  const finding=await source.repository('Hallazgo',actor).create({equipo_id:'equipment-1',descripcion:'Revisión',componente:'Hidráulico',prioridad:'Alta',estado:'Abierto'});
  await source.repository('Hallazgo',actor).update(finding.id,{estado:'Resuelto',orden_resolucion_id:order.id,detalle_resolucion:'Verificado',nota_cambio:'Prueba'});
  const db=source.snapshot(actor);
  for(const entity of ['OTRepuesto','OTHoras'] as const)db.entities[entity].push(row(entity,{equipo_id:'equipment-1',cliente_id:'client-1',orden_id:order.id,cantidad:1,horas:1}));
  db.entities.Cliente[0].referencia_cliente='QA-1';
  validateDatabase(db);
  return db;
}
const accepts=(fn:()=>unknown)=>{try{fn();return true;}catch{return false;}};
let baseline:Database;
beforeAll(async()=>{baseline=await fixture();});
it('rechaza los mismos cambios inválidos, incluidas las dependencias inversas',async()=>{
  const db=await fixture(),checker=IncrementalValidation.create(db);
  const changes:((db:Database)=>void)[]=[
    d=>{d.entities.Equipo[1].serie=' '+String(d.entities.Equipo[0].serie).toLowerCase()+' ';},
    d=>{d.entities.Cliente[1].referencia_cliente=' qa-1 ';},
    d=>{d.entities.Catalogos[1]={...d.entities.Catalogos[0],id:d.entities.Catalogos[1].id,codigo:d.entities.Catalogos[1].codigo};},
    d=>{d.entities.Equipo[0].creado_por='';},
    d=>{d.entities.Equipo[0].fecha_actualizacion='ayer';},
    d=>{d.entities.Equipo[0].capacidad_lb=-1;},
    d=>{d.entities.Cliente=d.entities.Cliente.filter(r=>r.id!=='client-1');},
    d=>{d.entities.Contacto[0].cliente_id='client-2';},
    d=>{d.entities.Sede[0].autoriza_contacto_id='missing';},
    d=>{d.entities.Sede[0].cliente_id='client-2';},
    d=>{d.entities.Equipo[0].cliente_id='client-2';},
    d=>{d.entities.Tecnico.find(r=>r.id==='tech-1')!.activo=false;},
    d=>{d.entities.Ticket[0].equipo_id='equipment-2';},
    d=>{d.entities.OrdenServicio.at(-1)!.estado='Cancelada';},
    d=>{d.entities.OrdenServicio.at(-1)!.horometro=901;},
    d=>{d.entities.OrdenServicio=[];},
    d=>{d.entities.LecturaHorometro.at(-1)!.valor=-1;},
    d=>{d.entities.OTRepuesto[0].orden_id='missing';},
    d=>{d.entities.OTHoras[0].cliente_id='missing';},
    d=>{d.entities.Hallazgo[0].orden_resolucion_id='missing';},
    d=>{d.entities.PlanPM[0].vigente=true;},
    d=>{d.entities.PlanPM[0].version=8;},
    d=>{d.entities.PlanPM=d.entities.PlanPM.slice(1);},
    d=>{d.entities.Bitacora[0].codigo=d.entities.Bitacora[1].codigo;},
    d=>{d.entities.Catalogos[0].categoria='Categoría inexistente';},
  ];
  for(const change of changes) {
    const candidate=structuredClone(db);change(candidate);
    expect(accepts(()=>validateDatabase(candidate)),String(change)).toBe(false);
    expect(accepts(()=>checker.check(candidate)),String(change)).toBe(false);
  }
});
it.each(entityNames)('equivalencia de %s ante cambios, adiciones y eliminación',(entity)=>{
  const db=baseline,checker=IncrementalValidation.create(db);
    for(const original of db.entities[entity].slice(0,2)) {
      const missing=structuredClone(db);missing.entities[entity]=missing.entities[entity].filter(r=>r.id!==original.id);
      expect(accepts(()=>checker.check(missing)),entity+' eliminación').toBe(accepts(()=>validateDatabase(missing)));
      for(const [field,value] of Object.entries(original))for(const replacement of [null,'',typeof value==='number'?-1:'missing',value]) {
        const next=structuredClone(db);next.entities[entity].find(r=>r.id===original.id)![field]=replacement;
        expect(accepts(()=>checker.check(next)),entity+'.'+field+'='+replacement).toBe(accepts(()=>validateDatabase(next)));
      }
      const copy=structuredClone(db);copy.entities[entity].push({...original,id:original.id+'-copy',codigo:original.codigo+'-copy'});
      expect(accepts(()=>checker.check(copy)),entity+' adición').toBe(accepts(()=>validateDatabase(copy)));
    }
});
it('un cambio aislado no vuelve a validar miles de filas sin relación',()=>{
  const db=createSeed();for(let i=0;i<5000;i++)db.entities.Catalogos.push(row('CAT-QA-'+i,{categoria:'Marcas',nombre:'Marca '+i,activo:true}));
  const checker=IncrementalValidation.create(db),next=structuredClone(db);
  next.entities.Catalogos.at(-1)!.nombre='Marca corregida';
  expect(checker.check(next).checkedRows).toBe(1);
  const checked=checker.check(next);next.entities.Catalogos.at(-1)!.nombre='Marca final';
  expect(checked.check(next).checkedRows).toBe(1);
  validateDatabase(next);
});
it('un contexto inválido o metadatos manipulados nunca se convierten en base confiable',()=>{
  const db=createSeed();db.entities.Equipo[0].serie=db.entities.Equipo[1].serie;
  expect(()=>IncrementalValidation.create(db)).toThrow();
  const checker=IncrementalValidation.create(createSeed());
  for(const value of [null,{}, {...createSeed(),revision:-1},{...createSeed(),schemaVersion:8}])expect(()=>checker.check(value)).toThrow();
  const optional=createSeed();optional.entities.Equipo[0].anio=null;
  const optionalChecker=IncrementalValidation.create(optional);
  for(const invalid of [NaN,Infinity]) {
    const candidate=structuredClone(optional);candidate.entities.Equipo[0].anio=invalid;
    expect(()=>validateDatabase(candidate)).toThrow();expect(()=>optionalChecker.check(candidate)).toThrow();
  }
  const omitted=structuredClone(optional);Object.assign(omitted.entities.Equipo[0],{oculto:undefined});
  expect(()=>optionalChecker.check(omitted)).toThrow();
  // A caller mutating an old input cannot mutate the trusted context.
  const original=structuredClone(optional);optional.entities.Cliente[0].nombre='';
  original.entities.Equipo[0].notas='Cambio válido';
  expect(()=>optionalChecker.check(original)).not.toThrow();
});
