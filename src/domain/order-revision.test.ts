import type { Scalar } from './model';
import { expect, it } from 'vitest';
import { LocalDataSource } from '../data/repository';
import { createSeed, demoUsers } from '../data/seed';
const [admin,coord,tech,,,client]=demoUsers;
function fixture(){let data=JSON.stringify(createSeed());return new LocalDataSource({getItem:()=>data,setItem:(_key,value)=>{data=value;}},{demoHistory:false});}
const complete={estado:'Completada',diagnostico:'Diagnóstico original',trabajo_realizado:'Trabajo original',pruebas_realizadas:'Prueba original',resultado_pruebas:'Resultado correcto'};
it('corrige con motivo y versiones completas; conserva cierre, lecturas y permisos',async()=>{
 const source=fixture(),repo=source.repository('OrdenServicio',admin);
 let order=await repo.create({equipo_id:'equipment-1',tecnico_id:tech.tecnico_id!,estado:'En proceso',sintoma:'Prueba de corrección'});
 order=await repo.update(order.id,complete);
 for(const actor of [tech,client])await expect(source.repository('OrdenServicio',actor).update(order.id,{revision_accion:'corregir',revision_motivo:'Corrección de diagnóstico',diagnostico:'Nuevo',expected_updated_at:order.fecha_actualizacion})).rejects.toThrow();
 for(const fields of [{revision_motivo:''},{horometro:123},{fecha_fin:'2026-10-14T00:00:00.000Z'},{tecnico_id:'tech-2'},{estado:'En proceso'}] as Record<string,Scalar>[])await expect(repo.update(order.id,{revision_accion:'corregir',revision_motivo:'Corrección de diagnóstico',expected_updated_at:order.fecha_actualizacion,...fields})).rejects.toThrow();
 const changed=await source.repository('OrdenServicio',coord).update(order.id,{revision_accion:'corregir',revision_motivo:'Se precisa el diagnóstico',diagnostico:'Diagnóstico precisado',expected_updated_at:order.fecha_actualizacion});
 expect(changed.estado).toBe('Completada');expect(changed.fecha_fin).toBe(order.fecha_fin);expect(changed.revision_accion).toBeUndefined();
 const log=source.snapshot(admin).entities.Bitacora.at(-1)!;expect(JSON.parse(String(log.version_anterior))).toEqual(order);expect(JSON.parse(String(log.version_nueva))).toEqual(changed);expect(log.registrado_rol).toBe('Coordinador');
 await expect(repo.update(order.id,{revision_accion:'corregir',revision_motivo:'Versión anterior del reporte',diagnostico:'Otro',expected_updated_at:order.fecha_actualizacion})).rejects.toThrow('cambió');
});
it('reabre y vuelve a cerrar sin duplicar lectura; recupera la solicitud y conserva identidad',async()=>{
 const source=fixture(),repo=source.repository('OrdenServicio',admin);
 const ticket=await source.repository('Ticket',admin).create({equipo_id:'equipment-1',titulo:'Falla de prueba',descripcion:'Servicio de prueba'});
 let order=await repo.create({equipo_id:'equipment-1',ticket_id:ticket.id,tecnico_id:tech.tecnico_id!,estado:'En proceso',sintoma:'Prueba',horometro:99999});
 order=await repo.update(order.id,{...complete,visible_cliente:true});
 expect(source.snapshot(admin).entities.Ticket.find(row=>row.id===ticket.id)?.estado).toBe('Resuelto');
 for(const actor of [tech,client])await expect(source.repository('OrdenServicio',actor).update(order.id,{revision_accion:'reabrir',revision_motivo:'Trabajo pendiente detectado',expected_updated_at:order.fecha_actualizacion})).rejects.toThrow();
 const reopened=await source.repository('OrdenServicio',coord).update(order.id,{revision_accion:'reabrir',revision_motivo:'Falta una comprobación final',expected_updated_at:order.fecha_actualizacion});
 expect(reopened).toMatchObject({id:order.id,estado:'En proceso',fecha_fin:'',visible_cliente:false});
 expect(source.snapshot(admin).entities.Ticket.find(row=>row.id===ticket.id)?.estado).toBe('En revisión');
 await repo.update(order.id,{...complete,expected_updated_at:reopened.fecha_actualizacion});
 expect(source.snapshot(admin).entities.LecturaHorometro.filter(row=>row.orden_id===order.id)).toHaveLength(1);
 expect(source.snapshot(admin).entities.Ticket.find(row=>row.id===ticket.id)?.estado).toBe('Resuelto');
});
