import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {PreventiveReport} from './PreventiveReport';
import {canViewMaintenance,filterVisible} from '../../domain/permissions';
import type {Actor,EntityRecord} from '../../domain/model';

const equipment=[{id:'own',cliente_id:'c',codigo:'VISIBLE'},{id:'other',cliente_id:'other',codigo:'AJENO'}] as unknown as EntityRecord[];
const plan={id:'p',equipo_id:'own',schema_plan:1,vigente:true,tipo_plan:'Preventivo',criterio:'Días',intervalo:30,base_origen:'Pendiente',base_confirmada:false,estado_plan:'Activo'} as unknown as EntityRecord;
for(const rol of ['Administrador','Coordinador','Cliente','Técnico'] as const){
 it(`respeta la visibilidad de bases para ${rol}`,()=>{
  const actor:Actor={id:'qa',nombre:'QA',rol,cliente_id:'c',tecnico_id:'t'};
  const context={Equipo:equipment,OrdenServicio:[]} as Parameters<typeof filterVisible>[3];
  const visible=filterVisible(actor,'Equipo',equipment,context);
  const plans=filterVisible(actor,'PlanPM',[plan],context);
  const markup=renderToStaticMarkup(<MemoryRouter><PreventiveReport equipment={visible} plans={plans} readings={[]} orders={[]} periodOrders={[]} from="2026-10-01" to="2026-10-31" today="2026-10-20" canViewPlans={canViewMaintenance(actor)} loading={false}/></MemoryRouter>);
  if(rol==='Administrador'||rol==='Coordinador'){
   expect(markup).toContain('con base pendiente');expect(markup).toContain('No equivalen a equipos al día');expect(markup).toContain('Ver plan');
  }else{
   expect(markup).not.toContain('Ver plan');expect(markup).not.toContain('con base pendiente');
   expect(plans).toEqual([]);expect(markup).not.toContain('AJENO');
  }
  expect(markup).toContain('2026-10-01');expect(markup).toContain('2026-10-31');
 });
}
