import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { LocalDataSource, STORAGE_KEY } from './repository';
import { createSeed, demoUsers } from './seed';
import { makeBackup, parseBackup } from './excel';
import { administrativeState, equipmentStatusValues, filterEquipmentStatus, maintenanceState, operationalState, summarizeEquipment } from '../domain/equipment-status';
import { filterVisible } from '../domain/permissions';
import type { EntityRecord } from '../domain/model';

const admin=demoUsers[0];
function fixture() {
  const db=createSeed(); let saved=JSON.stringify(db);
  const storage={getItem:()=>saved,setItem:(_key:string,value:string)=>{saved=value;}};
  const source=new LocalDataSource(storage,{demoHistory:false});
  return {source,storage,repo:source.repository('Equipo',admin)};
}
describe('estado operativo independiente de administración y mantenimiento',()=>{
  it('abre registros anteriores sin cambiarlos ni asumir que Disponible, En renta o En taller significa operativo',()=>{
    const {source,storage}=fixture(); const original=storage.getItem();
    for(const estado of ['Disponible','En renta','En tránsito','Vendido','Baja','En taller','Pendiente de revisión']) expect(operationalState({estado})).toBe('Pendiente de revisión');
    expect(operationalState({estado:'En mantenimiento'})).toBe('En mantenimiento');
    expect(administrativeState({estado:'Disponible'})).toBe('Disponible');
    expect(administrativeState({estado:'En taller'})).toBe('');
    expect(maintenanceState({estado:'Disponible'})).toBe('Por revisar');
    new LocalDataSource(storage,{demoHistory:false});
    expect(storage.getItem()).toBe(original); expect(source.snapshot(admin)).toEqual(JSON.parse(original));
  });
  it('cuenta cada equipo una vez y filtra el aviso por separado, excluyendo vendidos y bajas por defecto',()=>{
    const base=createSeed().entities.Equipo[0];
    const rows=[
      {...base,id:'1',estado_operativo:'Operativo',estado_mantenimiento:'Mantenimiento pendiente'},
      {...base,id:'2',estado_operativo:'No operativo',estado_mantenimiento:'Mantenimiento pendiente'},
      {...base,id:'3',estado_operativo:'En reparación'},
      {...base,id:'4',estado_operativo:'En mantenimiento'},
      {...base,id:'5',estado:'Disponible'},
      {...base,id:'6',estado_administrativo:'Vendido',estado_operativo:'Operativo'},
      {...base,id:'7',estado:'Baja'},
    ] as EntityRecord[];
    const scope=filterEquipmentStatus(rows); const summary=summarizeEquipment(scope);
    expect(scope).toHaveLength(5); expect(summary.total).toBe(5); expect(Object.values(summary.counts)).toEqual([1,1,1,1,1]); expect(summary.maintenancePending).toBe(2);
    expect(filterEquipmentStatus(rows,'Operativo','Mantenimiento pendiente').map(row=>row.id)).toEqual(['1']);
    expect(filterEquipmentStatus(rows,'En reparación','Mantenimiento pendiente')).toEqual([]);
    expect(filterEquipmentStatus(rows,'Todos','Todos',true)).toHaveLength(7);
  });
  it('guarda transiciones, motivo y autoría real sin alterar horas, propiedad, imágenes o datos administrativos',async()=>{
    const {source,repo}=fixture(); const before=(await repo.getAll())[0];
    const first=await repo.update(before.id,{estado_operativo:'Operativo',estado_mantenimiento:'Mantenimiento pendiente',motivo_estado:'Servicio preventivo por programar',estado_actualizado_por:'Autor falso',estado_actualizado_el:'2000-01-01T00:00:00.000Z'});
    expect(first.estado_actualizado_por).toBe(admin.nombre); expect(first.estado_actualizado_el).not.toBe('2000-01-01T00:00:00.000Z');
    expect(first).toMatchObject({estado:before.estado,horometro:before.horometro,propiedad:before.propiedad,serie:before.serie});
    expect(administrativeState(first)).toBe('En renta');
    const unchanged=await repo.update(before.id,{notas:'Complemento',...equipmentStatusValues(first)});
    expect(unchanged.estado_actualizado_el).toBe(first.estado_actualizado_el);
    expect(source.snapshot(admin).entities.Bitacora.filter(row=>row.accion==='Cambio de estado')).toHaveLength(1);
    await repo.update(before.id,{estado_operativo:'No operativo',motivo_estado:'Falla reportada'});
    await repo.update(before.id,{estado_operativo:'En reparación',motivo_estado:'Trabajo correctivo en curso'});
    const current=(await repo.getById(before.id))!;
    expect(maintenanceState(current)).toBe('Mantenimiento pendiente'); expect(administrativeState(current)).toBe('En renta');
    const events=source.snapshot(admin).entities.Bitacora.filter(row=>row.accion==='Cambio de estado');
    expect(events).toHaveLength(3); expect(events.at(-1)).toMatchObject({equipo_id:before.id,creado_por:admin.id,registrado_por:admin.nombre,motivo:'Trabajo correctivo en curso'});
    expect(events.at(-1)?.detalle).toContain('No operativo → En reparación');
  });
  it('valida opciones y cliente para En renta; no guarda estados parciales ni permite falsear autoría',async()=>{
    const {source,repo,storage}=fixture(); const before=source.snapshot(admin); const row=before.entities.Equipo.find(item=>item.propiedad==='Propio'&&!item.cliente_id)!;
    await expect(repo.update(row.id,{estado_operativo:'Inventado'})).rejects.toThrow('no permitido');
    await expect(repo.update(row.id,{estado_administrativo:'En renta'})).rejects.toThrow('Selecciona el cliente');
    expect(source.snapshot(admin)).toEqual(before);
    const blanked=await repo.update(row.id,{estado_administrativo:''}); expect(administrativeState(blanked)).toBe('');
    await repo.update(row.id,{estado_actualizado_por:'Falso',estado_actualizado_el:'2000-01-01T00:00:00.000Z'});
    expect((await repo.getById(row.id))?.estado_actualizado_por).not.toBe('Falso');
    const original=storage.getItem(); const writer=storage.setItem; storage.setItem=()=>{throw new Error('Quota');};
    await expect(repo.update(row.id,{estado_operativo:'Operativo'})).rejects.toThrow('No se pudo guardar');
    expect(storage.getItem()).toBe(original); storage.setItem=writer;
  });
  it('conserva los campos y el historial al reabrir y en respaldos, incluidos motivos largos',async()=>{
    const {source,repo,storage}=fixture();const row=(await repo.getAll())[0];
    const updated=await repo.update(row.id,{estado_operativo:'No operativo',estado_mantenimiento:'Sin pendientes reportados',motivo_estado:'A'.repeat(500)});
    const reloaded=new LocalDataSource(storage,{demoHistory:false});expect(await reloaded.repository('Equipo',admin).getById(row.id)).toEqual(updated);
    const restored=parseBackup(XLSX.read(XLSX.write(makeBackup(source.snapshot(admin)),{bookType:'xlsx',type:'array'}),{type:'array'}));
    expect(restored.entities.Equipo.find(item=>item.id===row.id)).toEqual(updated);
    expect(restored.entities.Bitacora.find(item=>item.accion==='Cambio de estado')?.motivo).toBe('A'.repeat(500));
    storage.setItem(STORAGE_KEY,JSON.stringify(restored)); expect(()=>new LocalDataSource(storage,{demoHistory:false})).not.toThrow();
  });
  it('el cliente solo consulta sus estados y avisos, sin administración interna ni escritura',async()=>{
    const {source,repo}=fixture(); const client=demoUsers[5]; const row=(await repo.getAll()).find(item=>item.cliente_id===client.cliente_id)!;
    await repo.update(row.id,{estado_operativo:'Operativo',estado_mantenimiento:'Mantenimiento pendiente'});
    const rows=await source.repository('Equipo',client).getAll();expect(rows.every(item=>item.cliente_id===client.cliente_id)).toBe(true);
    const visible=rows.find(item=>item.id===row.id)!;expect(visible.estado_operativo).toBe('Operativo');expect(visible.estado_mantenimiento).toBe('Mantenimiento pendiente');
    for(const key of ['estado','estado_administrativo','estado_actualizado_por']) expect(visible).not.toHaveProperty(key);
    for(const actor of demoUsers.slice(1)) await expect(source.repository('Equipo',actor).update(row.id,{estado_operativo:'No operativo'})).rejects.toThrow('administración');
    const retired=filterVisible(client,'Equipo',[{...row,estado_administrativo:'Baja'}]);expect(filterEquipmentStatus(retired)).toHaveLength(0);
    const legacyMaintenance=filterVisible(client,'Equipo',[{...row,estado:'En mantenimiento'}]);expect(operationalState(legacyMaintenance[0])).toBe('En mantenimiento');
  });
  it('detecta una edición concurrente y conserva el estado del otro administrador',async()=>{
    const {source,storage,repo}=fixture();const other=new LocalDataSource(storage,{demoHistory:false});const row=(await repo.getAll())[0];
    await other.repository('Equipo',admin).update(row.id,{estado_operativo:'En reparación'});
    await expect(repo.update(row.id,{estado_operativo:'Operativo'})).rejects.toThrow('otra pestaña');
    expect((await source.repository('Equipo',admin).getById(row.id))?.estado_operativo).toBe('En reparación');
  });
});
