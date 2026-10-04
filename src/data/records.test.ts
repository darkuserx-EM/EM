import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { LocalDataSource, STORAGE_KEY, type StorageAdapter } from './repository';
import { createSeed, demoUsers } from './seed';
import { makeBackup, parseBackup } from './excel';
const admin = demoUsers[0];
function fixture() {
  let value: string | null = null;
  const storage: StorageAdapter = { getItem: () => value, setItem: (_key, next) => { value = next; } };
  const source = new LocalDataSource(storage);
  return { source, storage, clients: source.repository('Cliente', admin), fleet: source.repository('Equipo', admin) };
}
const equipment = { marca: 'Marca de prueba', modelo: 'Modelo A', serie: 'SERIE-WEB-01', tipo: 'Reach', propiedad: 'Propio', estado: 'Disponible', horometro: 125.5 };

describe('captura web de clientes y equipos', () => {
  it('guarda clientes, datos opcionales y auditoría, y los conserva al reabrir', async () => {
    const { source, storage, clients } = fixture();
    const row = await clients.create({ nombre: 'Empresa de prueba', estado: 'Activo', nit: '000123-4', referencia_cliente: 'WEB-01', dia_facturacion: 15 });
    expect(row.codigo).toBe('CLI-007'); expect(row.creado_por).toBe(admin.id);
    await clients.update(row.id, { ubicacion: 'Villa Nueva', estado: 'Prospecto' });
    const reloaded = new LocalDataSource(storage);
    expect(await reloaded.repository('Cliente', admin).getById(row.id)).toMatchObject({ nit: '000123-4', ubicacion: 'Villa Nueva', estado: 'Prospecto' });
    expect(source.snapshot(admin).entities.Bitacora.at(-1)?.detalle).toContain('Activo → Prospecto');
  });
  it('rechaza nombre vacío, referencias duplicadas y día inválido sin cambios parciales', async () => {
    const { clients, source } = fixture(); const before = source.snapshot(admin);
    await expect(clients.create({ nombre: ' ', estado: 'Activo' })).rejects.toThrow('obligatorio');
    await expect(clients.create({ nombre: 'X', estado: 'Activo', dia_facturacion: 31.5 })).rejects.toThrow('entero');
    expect(source.snapshot(admin)).toEqual(before);
    await clients.create({ nombre: 'A', estado: 'Activo', referencia_cliente: 'C001' });
    await expect(clients.create({ nombre: 'B', estado: 'Activo', referencia_cliente: ' c001 ' })).rejects.toThrow('referencia');
  });
  it('asigna correlativos TCL y TCE separados y registra una primera lectura real', async () => {
    const { source, fleet } = fixture();
    const own = await fleet.create(equipment);
    const client = await fleet.create({ ...equipment, serie: 'CLIENTE-WEB', propiedad: 'De cliente', cliente_id: 'client-1' });
    expect(own.codigo).toBe('TCL-019'); expect(client.codigo).toBe('TCE-008');
    const baseline = source.snapshot(admin).entities.LecturaHorometro.filter(row => row.equipo_id === own.id);
    expect(baseline).toHaveLength(1);
    expect(baseline[0]).toMatchObject({ valor: 125.5, origen: 'Ingreso de equipo', registrado_por: admin.nombre });
    expect(source.snapshot(admin).entities.OrdenServicio.some(row => row.equipo_id === own.id)).toBe(false);
  });
  it('rechaza series repetidas, falta de cliente y referencias inexistentes sin guardar lecturas', async () => {
    const { source, fleet } = fixture(); const before = source.snapshot(admin);
    await expect(fleet.create({ ...equipment, serie: ' demo-yale-1001 ' })).rejects.toThrow('serie');
    await expect(fleet.create({ ...equipment, propiedad: 'De cliente' })).rejects.toThrow('Selecciona el cliente');
    await expect(fleet.create({ ...equipment, cliente_id: 'missing' })).rejects.toThrow('no existe');
    expect(source.snapshot(admin)).toEqual(before);
  });
  it('vincula contactos y sedes a su empresa y conserva referencias de ubicación', async () => {
    const { source } = fixture();
    const contact = await source.repository('Contacto', admin).create({ cliente_id: 'client-1', nombre: 'Contacto de prueba', telefono: '+502 0000 0000', correo: 'prueba@example.com' });
    const site = await source.repository('Sede', admin).create({ cliente_id: 'client-1', nombre: 'Bodega de prueba', referencia_ubicacion: 'Código de ejemplo' });
    expect(contact.codigo).toBe('CON-001'); expect(site.referencia_ubicacion).toBe('Código de ejemplo');
    await expect(source.repository('Contacto', admin).create({ cliente_id: 'missing', nombre: 'X' })).rejects.toThrow('no existe');
    await expect(source.repository('Contacto', admin).create({ cliente_id: 'client-1', nombre: 'X', correo: 'no-es-correo' })).rejects.toThrow('Correo');
  });
  it('impide vincular una sede de otro cliente y preserva lectura y propiedad al editar', async () => {
    const { source, fleet } = fixture();
    const site = await source.repository('Sede', admin).create({ cliente_id: 'client-2', nombre: 'Sede de otra empresa' });
    await expect(fleet.create({ ...equipment, cliente_id: 'client-1', sede_id: site.id })).rejects.toThrow('sede');
    const row = await fleet.create(equipment);
    await expect(fleet.update(row.id, { horometro: 1 })).rejects.toThrow('lecturas');
    await expect(fleet.update(row.id, { propiedad: 'De cliente', cliente_id: 'client-1' })).rejects.toThrow('corrección de propiedad');
    await fleet.update(row.id, { estado: 'En mantenimiento', notas: 'Revisar sistema hidráulico' });
    expect(await fleet.getById(row.id)).toMatchObject({ codigo: row.codigo, horometro: 125.5, notas: 'Revisar sistema hidráulico' });
  });
  it('no habilita escritura a otros perfiles ni importaciones incompletas', async () => {
    const { source } = fixture();
    for (const actor of demoUsers.slice(1)) for (const entity of ['Cliente','Equipo','Contacto','Sede'] as const) await expect(source.repository(entity, actor).create({})).rejects.toThrow('administración');
    await expect(source.repository('Equipo', admin).import([], source.getRevision())).rejects.toThrow('formulario web');
  });
  it('no modifica el almacenamiento si la persistencia de un alta falla', async () => {
    const { source, fleet, storage } = fixture(); const before = storage.getItem(STORAGE_KEY); const revision = source.getRevision();
    storage.setItem = () => { throw new Error('Quota'); };
    await expect(fleet.create(equipment)).rejects.toThrow('No se pudo guardar');
    expect(storage.getItem(STORAGE_KEY)).toBe(before); expect(source.getRevision()).toBe(revision);
  });
  it('conserva los datos nuevos y sus vínculos en un respaldo XLSX real', async () => {
    const { source, clients, fleet } = fixture();
    const client = await clients.create({ nombre: 'Empresa de prueba', estado: 'Activo', nit: '000123-4' });
    const site = await source.repository('Sede', admin).create({ cliente_id: client.id, nombre: 'Bodega', referencia_ubicacion: 'Referencia de prueba' });
    const row = await fleet.create({ ...equipment, cliente_id: client.id, sede_id: site.id });
    const data = parseBackup(XLSX.read(XLSX.write(makeBackup(source.snapshot(admin)), {bookType:'xlsx',type:'array'}), {type:'array'}));
    expect(data.entities.Cliente.find(item => item.id === client.id)?.nit).toBe('000123-4');
    expect(data.entities.Equipo.find(item => item.id === row.id)).toMatchObject({ cliente_id: client.id, sede_id: site.id, horometro: 125.5 });
    expect(data.entities.Sede[0].referencia_ubicacion).toBe('Referencia de prueba');
    expect(data.entities.Equipo).toHaveLength(createSeed().entities.Equipo.length + 1);
  });
});
