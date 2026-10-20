import {expect,it} from 'vitest';
import {fleetContextLink,fleetFilter,updateFleetParams} from './fleet-navigation';
import {canAccessModule} from './permissions';
import type {Actor} from './model';
it('conserva contexto y filtros propios en el recorrido completo, sin IDs de ficha',()=>{
 const source='?fleet=En+renta&client=c1&from=2026-09-01&to=2026-09-30&cycle=Mayor&fleetSearch=Crown&equipo=private&vista=mantenimiento';
 const next=fleetContextLink('/reportes','/flota',source);
 const params=new URL(next,'https://portal.invalid').searchParams;
 expect(params.get('fleet')).toBe('En renta');expect(params.get('client')).toBe('c1');expect(params.get('cycle')).toBe('Mayor');expect(params.has('equipo')).toBe(false);expect(params.has('vista')).toBe(false);
 const back=fleetContextLink('/preventivos','/reportes',new URL(next,'https://portal.invalid').search);
 expect(new URL(back,'https://portal.invalid').searchParams.get('from')).toBe('2026-09-01');
 expect(new URL(fleetContextLink('/flota','/preventivos',new URL(back,'https://portal.invalid').search),'https://portal.invalid').searchParams.get('fleetSearch')).toBe('Crown');
});
it('preserva destino explícito, no exporta contexto a otras rutas ni sitios',()=>{
 expect(fleetContextLink('/ordenes','/flota','?client=c1')).toBe('/ordenes');
 expect(fleetContextLink('https://example.com/flota','/flota','?client=c1')).toBe('https://example.com/flota');
 const to=new URL(fleetContextLink('/flota?equipo=e&client=c2&vista=mantenimiento','/reportes','?client=c1&token=secret'),'https://portal.invalid');
 expect(to.searchParams.get('client')).toBe('c2');expect(to.searchParams.get('equipo')).toBe('e');expect(to.searchParams.has('token')).toBe(false);
});
it('cambiar alcance quita el equipo específico; limpiar no borra historial ni otro contexto',()=>{
 const original=new URLSearchParams('fleet=En+renta&client=c&equipment=e&from=2026-09-01');
 const next=updateFleetParams(original,{client:'',fleet:''});
 expect(next.get('from')).toBe('2026-09-01');expect(next.has('equipment')).toBe(false);expect(original.get('equipment')).toBe('e');
 expect(fleetFilter(new URLSearchParams('fleet=otro'))).toBe('Todos');
});
for(const rol of ['Administrador','Coordinador','Cliente','Técnico'] as const){
 it(`el contexto no amplía rutas del perfil ${rol}`,()=>{
 const actor={id:'qa',nombre:'QA',rol} as Actor;
 for(const page of ['flota','preventivos','reportes']){
 const url=fleetContextLink('/'+page,'/reportes','?fleet=En+renta&client=ajeno');
 expect(canAccessModule(actor,new URL(url,'https://portal.invalid').pathname.slice(1))).toBe(canAccessModule(actor,page));
 }
 if(rol==='Cliente'||rol==='Técnico')expect(canAccessModule(actor,'preventivos')).toBe(false);
 });
}
