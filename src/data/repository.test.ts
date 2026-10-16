import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { LocalDataSource, STORAGE_KEY, type StorageAdapter } from './repository';
import { createSeed, demoUsers } from './seed';
import { validateDatabase } from '../domain/validation';
import { canAccessModule } from '../domain/permissions';
import { makeBackup, makeTemplate, parseBackup, parseImport } from './excel';
import { formatDate, formatMoney, formatTime } from '../domain/format';

class MemoryStorage implements StorageAdapter {
  values = new Map<string, string>(); fail = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error('Quota exceeded'); this.values.set(key, value); }
}
const admin = demoUsers[0];
const catalog = { categoria: 'Marcas', nombre: 'Marca de prueba', activo: true };
function fixture() { const storage = new MemoryStorage(); const source = new LocalDataSource(storage); return { storage, source, repo: source.repository('Catalogos', admin) }; }

describe('estructura y persistencia', () => {
  it('carga una muestra coherente con 25 equipos y 6 clientes', () => { const data = createSeed(); expect(() => validateDatabase(data)).not.toThrow(); expect(data.entities.Equipo).toHaveLength(25); expect(data.entities.Cliente).toHaveLength(6); });
  it('conserva cambios, autoría e historial al recargar', async () => { const { storage, source, repo } = fixture(); const row = await repo.create(catalog); await repo.update(row.id, { activo: false }); const reloaded = new LocalDataSource(storage); expect(await reloaded.repository('Catalogos', admin).getById(row.id)).toMatchObject({ nombre: catalog.nombre, activo: false, creado_por: admin.id, actualizado_por: admin.id }); expect(source.snapshot(admin).entities.Bitacora.at(-1)?.detalle).toContain('true → false'); });
  it('rechaza duplicados por nombre y categoría normalizados', async () => { const { repo } = fixture(); await expect(repo.create({ ...catalog, nombre: '  YALE  ' })).rejects.toThrow('ya existe'); });
  it('no cambia la memoria ni los datos si falla el guardado', async () => { const { source, storage, repo } = fixture(); const original = source.snapshot(admin); storage.fail = true; await expect(repo.create(catalog)).rejects.toThrow('No se pudo guardar'); expect(source.snapshot(admin)).toEqual(original); });
  it('no sobrescribe almacenamiento dañado al iniciar', () => { const storage = new MemoryStorage(); storage.setItem(STORAGE_KEY, '{corrupto'); expect(() => new LocalDataSource(storage)).toThrow('se conservaron'); expect(storage.getItem(STORAGE_KEY)).toBe('{corrupto'); });
  it('detecta cambios de otra pestaña antes de sobrescribirlos', async () => { const { storage, source, repo } = fixture(); const other = new LocalDataSource(storage); await other.repository('Catalogos', admin).create(catalog); await expect(repo.create({ ...catalog, nombre: 'Otro' })).rejects.toThrow('otra pestaña'); expect(source.getRevision()).toBe(other.getRevision()); });
});
describe('roles simulados', () => {
  it('bloquea escrituras y respaldos a perfiles no administradores', async () => { const { source } = fixture(); for (const actor of demoUsers.slice(1)) { await expect(source.repository('Catalogos', actor).create(catalog)).rejects.toThrow('administración'); expect(() => source.snapshot(actor)).toThrow('administración'); } });
  it('filtra la flota y clientes de la empresa del cliente', async () => { const { source } = fixture(); const actor = demoUsers[5]; const rows = await source.repository('Equipo', actor).getAll(); expect(rows.length).toBeGreaterThan(0); expect(rows.every(row => row.cliente_id === actor.cliente_id)).toBe(true); expect(await source.repository('Cliente', actor).getAll()).toHaveLength(1); expect(await source.repository('Bitacora', actor).getAll()).toHaveLength(0); });
  it('entrega equipos activos y conserva restricciones de configuración', async () => { const { source } = fixture(); const actor = demoUsers[2]; const orders = await source.repository('OrdenServicio', actor).getAll(); const ids = new Set(orders.map(row => row.equipo_id)); const equipment = await source.repository('Equipo', actor).getAll(); expect(equipment.length).toBeGreaterThan(0); expect(equipment.every(row => ids.has(row.id) || !row.fuera_de_flota)).toBe(true); expect(canAccessModule(demoUsers[1], 'catalogos')).toBe(false); expect(canAccessModule(actor, 'datos')).toBe(false); expect(canAccessModule(demoUsers[5], 'inicio')).toBe(false); });
});
describe('Excel y restauración', () => {
  it('valida la plantilla y convierte el booleano en español', () => { const preview = parseImport('Catalogos', makeTemplate('Catalogos'), createSeed().entities.Catalogos); expect(preview[0].errors).toEqual([]); expect(preview[0].values.fields.activo).toBe(true); });
  it('detecta duplicados internos y categorías inválidas antes de confirmar', () => { const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ categoria: 'Marcas', nombre: 'Nueva', activo: 'Sí' }, { categoria: 'Marcas', nombre: 'nueva', activo: 'Sí' }, { categoria: 'No existe', nombre: 'X', activo: 'Sí' }]), 'Catalogos'); const preview = parseImport('Catalogos', workbook, []); expect(preview[0].errors).toEqual([]); expect(preview[1].errors.join()).toContain('ya existe'); expect(preview[2].errors.join()).toContain('no permitido'); });
  it('importa todos los registros o ninguno', async () => { const { source, repo } = fixture(); const before = source.snapshot(admin); await expect(repo.import([{ fields: catalog }, { fields: { ...catalog, nombre: 'Yale' } }], source.getRevision())).rejects.toThrow('ya existe'); expect(source.snapshot(admin)).toEqual(before); });
  it('permite actualizar por ID manteniendo código y fecha de creación', async () => { const { source, repo } = fixture(); const existing = (await repo.getAll())[0]; await repo.import([{ id: existing.id, fields: { categoria: existing.categoria, nombre: 'Nombre ajustado', activo: true } }], source.getRevision()); expect(await repo.getById(existing.id)).toMatchObject({ codigo: existing.codigo, fecha_creacion: existing.fecha_creacion, nombre: 'Nombre ajustado' }); });
  it('rechaza una importación si los datos cambiaron desde la vista previa', async () => { const { source, repo } = fixture(); const revision = source.getRevision(); await repo.create(catalog); await expect(repo.import([{ fields: { ...catalog, nombre: 'Otra' } }], revision)).rejects.toThrow('vista previa'); });
  it('recupera todas las entidades desde un archivo Excel real', () => { const data = createSeed(); const binary = XLSX.write(makeBackup(data), { bookType: 'xlsx', type: 'array' }); const reloaded = parseBackup(XLSX.read(binary, { type: 'array' })); expect(reloaded).toEqual(data); });
  it('rechaza respaldos incompletos y referencias rotas sin cambiar datos', () => { const { source } = fixture(); const before = source.snapshot(admin); const incomplete = makeBackup(before); delete incomplete.Sheets.Equipo; expect(() => parseBackup(incomplete)).toThrow('Falta la hoja'); const invalid = structuredClone(before); invalid.entities.Equipo[0].cliente_id = 'missing'; expect(() => source.restore(admin, invalid, source.getRevision())).toThrow('no existe'); expect(source.snapshot(admin)).toEqual(before); });
  it('restaura una copia y registra la restauración', async () => { const { source, repo } = fixture(); const backup = source.snapshot(admin); await repo.create(catalog); source.restore(admin, backup, source.getRevision()); expect((await repo.getAll()).some(row => row.nombre === catalog.nombre)).toBe(false); expect(source.snapshot(admin).entities.Bitacora.at(-1)?.accion).toBe('Restauración'); });
});
describe('importación aditiva de equipos e historial', () => {
  it('agrega el equipo, órdenes y lecturas sin modificar filas previas y omite repetidos', () => {
    const { source } = fixture(); const before = source.snapshot(admin); const client = before.entities.Cliente[0];
    const payload = { cliente_id: client.id, sede_id: '', equipos: [{ serie: 'SERIE-IMPORT-1', id_interno_cliente: 'FC#1', marca: 'Crown', modelo: 'FC4500' }], reportes: [{ origen_id: 'source-report-1', orden_origen: 'OS-21', serie: 'SERIE-IMPORT-1', fecha: '2025-02-08T20:00:00.000Z', fecha_fin: '', estado: 'Completado', prioridad: 'Programada', tipo: 'Correctivo', diagnostico: 'Hidráulica', trabajo: 'Cambio de manguera', notas_seguridad: '', tecnicos: 'Raul Perez', recibido_por: 'Cliente', inspector: 'admin@example.com', horometro: 100, odometro_millas: 125, ubicacion: 'Ubicación enviada por el navegador', insumos_origen: 'Wipe', repuestos_origen: 'Manguera', adjuntos_referencias: 'Foto Antes: antes.jpg', firma_cliente_referencia: '', checklist_origen: '', bocina_origen: '', mes_origen: 'febrero', semana_origen: 'Semana 6', dia_origen: 'sábado', ubicacion_coordenadas: '14.6, -90.4' }] };
    const result = source.importHistoricalReports(admin, payload, source.getRevision());
    expect(result).toEqual({ equipos: 1, reportes: 1, lecturas: 1, lecturas_repetidas: 0, repetidos: 0 });
    const after = source.snapshot(admin);
    expect(after.entities.Cliente).toEqual(before.entities.Cliente);
    expect(after.entities.Equipo).toHaveLength(before.entities.Equipo.length + 1);
    expect(after.entities.OrdenServicio).toHaveLength(before.entities.OrdenServicio.length + 1);
    expect(after.entities.LecturaHorometro).toHaveLength(before.entities.LecturaHorometro.length + 1);
    expect(after.entities.OrdenServicio.at(-1)).toMatchObject({ importado: true, origen_id: 'source-report-1', orden_origen: 'OS-21', horometro: 100, odometro_millas: 125 });
    expect(after.entities.LecturaHorometro.at(-1)).toMatchObject({ valor: 100, orden_id: after.entities.OrdenServicio.at(-1)?.id, es_estimado: false });
    expect(after.entities.Equipo.at(-1)).toMatchObject({ propiedad: 'De cliente', estado_operativo: 'Pendiente de revisión', cliente_id: client.id, sede_id: '', marca: 'Crown', tipo: 'Clasificación pendiente' });
    // Sin sede elegida no hay ubicación, aunque el navegador envíe una.
    expect(after.entities.OrdenServicio.at(-1)?.ubicacion).toBe('');
    expect(after.entities.LecturaHorometro.at(-1)?.ubicacion).toBe('');
    expect(source.importHistoricalReports(admin, { ...payload, equipos: [] }, source.getRevision())).toEqual({ equipos: 0, reportes: 0, lecturas: 0, lecturas_repetidas: 0, repetidos: 1 });
    expect(source.snapshot(admin).entities.OrdenServicio).toHaveLength(before.entities.OrdenServicio.length + 1);
  });
  it('usa el nombre de la sede elegida como ubicación y la marca del archivo', async () => {
    const { source } = fixture(); const client = source.snapshot(admin).entities.Cliente[0];
    const site = await source.repository('Sede', admin).create({ cliente_id: client.id, nombre: 'Planta de prueba' });
    const report = { origen_id: 'source-report-2', orden_origen: 'OS-22', serie: 'SERIE-IMPORT-2', fecha: '2025-02-09T20:00:00.000Z', fecha_fin: '', estado: 'Pendiente', prioridad: '', tipo: 'Preventivo', diagnostico: '', trabajo: '', notas_seguridad: '', tecnicos: '', recibido_por: '', inspector: '', horometro: 250, odometro_millas: null, insumos_origen: '', repuestos_origen: '', adjuntos_referencias: '', firma_cliente_referencia: '', checklist_origen: '', bocina_origen: '', mes_origen: '', semana_origen: '', dia_origen: '', ubicacion_coordenadas: '' };
    expect(source.importHistoricalReports(admin, { cliente_id: client.id, sede_id: site.id, equipos: [{ serie: 'SERIE-IMPORT-2', id_interno_cliente: '', marca: 'Yale', modelo: 'ERP 050' }], reportes: [report] }, source.getRevision())).toEqual({ equipos: 1, reportes: 1, lecturas: 1, lecturas_repetidas: 0, repetidos: 0 });
    const after = source.snapshot(admin);
    expect(after.entities.Equipo.at(-1)).toMatchObject({ marca: 'Yale', tipo: 'Clasificación pendiente', sede_id: site.id });
    expect(after.entities.OrdenServicio.at(-1)).toMatchObject({ ubicacion: 'Planta de prueba', estado: 'Pendiente' });
    expect(after.entities.LecturaHorometro.at(-1)).toMatchObject({ ubicacion: 'Planta de prueba', valor: 250 });
    expect(() => source.importHistoricalReports(admin, { cliente_id: client.id, sede_id: '', equipos: [{ serie: 'SERIE-IMPORT-3', id_interno_cliente: '', marca: '', modelo: 'ERP 050' }], reportes: [] }, source.getRevision())).toThrow('obligatorio');
    expect(source.snapshot(admin)).toEqual(after);
  });
  it('no duplica lecturas conservadas: la de ingreso con el mismo valor y otra del mismo día', async () => {
    const { source } = fixture(); const client = source.snapshot(admin).entities.Cliente[0];
    const machine = await source.repository('Equipo', admin).create({ marca: 'Yale', modelo: 'ERP 050', serie: 'SERIE-LECTURAS-1', tipo: 'Contrabalanceado eléctrico', propiedad: 'De cliente', estado: 'Disponible', cliente_id: client.id, horometro: 1500 });
    const before = source.snapshot(admin).entities.LecturaHorometro;
    const intake = before.find(row => row.equipo_id === machine.id);
    expect(intake).toMatchObject({ origen: 'Ingreso de equipo', valor: 1500 });
    const blank = { fecha_fin: '', estado: 'Completado', prioridad: '', tipo: 'Preventivo', diagnostico: '', trabajo: '', notas_seguridad: '', tecnicos: '', recibido_por: '', inspector: '', odometro_millas: null, insumos_origen: '', repuestos_origen: '', adjuntos_referencias: '', firma_cliente_referencia: '', checklist_origen: '', bocina_origen: '', mes_origen: '', semana_origen: '', dia_origen: '', ubicacion_coordenadas: '' };
    const report = (id: string, fecha: string, horometro: number) => ({ ...blank, origen_id: id, orden_origen: id, serie: 'SERIE-LECTURAS-1', fecha, horometro });
    const payload = { cliente_id: client.id, sede_id: '', equipos: [], reportes: [
      report('L-1', '2025-05-01T15:00:00.000Z', 1400),
      report('L-2', '2025-05-01T22:00:00.000Z', 1400),
      report('L-3', '2025-05-02T15:00:00.000Z', 1400),
      report('L-4', '2025-06-01T15:00:00.000Z', 1500),
    ] };
    expect(source.importHistoricalReports(admin, payload, source.getRevision())).toEqual({ equipos: 0, reportes: 4, lecturas: 2, lecturas_repetidas: 2, repetidos: 0 });
    const after = source.snapshot(admin);
    expect(after.entities.LecturaHorometro.filter(row => row.equipo_id === machine.id).map(row => [row.origen, row.valor, row.fecha])).toEqual([
      ['Ingreso de equipo', 1500, intake?.fecha],
      ['Orden de servicio', 1400, '2025-05-01T15:00:00.000Z'],
      ['Orden de servicio', 1400, '2025-05-02T15:00:00.000Z'],
    ]);
    expect(after.entities.LecturaHorometro.find(row => row.id === intake?.id)).toEqual(intake);
    expect(after.entities.OrdenServicio.filter(row => row.importado === true && row.equipo_id === machine.id)).toHaveLength(4);
    expect(after.entities.Bitacora.at(-1)?.detalle).toContain('0 reportes ya existentes y 2 lecturas ya registradas omitidos');
    expect(source.importHistoricalReports(admin, payload, source.getRevision())).toEqual({ equipos: 0, reportes: 0, lecturas: 0, lecturas_repetidas: 0, repetidos: 4 });
    expect(source.snapshot(admin).entities.LecturaHorometro).toHaveLength(after.entities.LecturaHorometro.length);
  });
  it('rechaza errores sin guardar parcialmente', () => {
    const { source } = fixture(); const before = source.snapshot(admin); const client = before.entities.Cliente[0];
    expect(() => source.importHistoricalReports(admin, { cliente_id: client.id, sede_id: '', equipos: [{ serie: 'SERIE-IMPORT-1', id_interno_cliente: '', marca: 'Crown', modelo: 'FC4500' }], reportes: [{ origen_id: 'invalid-report', orden_origen: 'X', serie: 'OTHER', fecha: 'bad', fecha_fin: '', estado: 'Completado', prioridad: '', tipo: 'Correctivo', diagnostico: '', trabajo: '', notas_seguridad: '', tecnicos: '', recibido_por: '', inspector: '', horometro: null, odometro_millas: null, insumos_origen: '', repuestos_origen: '', adjuntos_referencias: '', firma_cliente_referencia: '', checklist_origen: '', bocina_origen: '', mes_origen: '', semana_origen: '', dia_origen: '', ubicacion_coordenadas: '' }] }, source.getRevision())).toThrow('No hay equipo');
    expect(source.snapshot(admin)).toEqual(before);
  });
});
describe('formato de Guatemala', () => {
  it('usa quetzales y la zona horaria correcta', () => { expect(formatMoney(1234.5)).toBe('Q 1,234.50'); expect(formatDate('2026-10-05T01:15:00Z')).toBe('04/10/2026'); expect(formatTime('2026-10-05T01:15:00Z')).toBe('19:15'); });
});


it('restaurar conserva toda la auditoría actual sin aceptar alteraciones de la bitácora del respaldo', async () => {
  const {source,repo} = fixture(); const backup=source.snapshot(admin);
  await repo.create(catalog); const before=source.snapshot(admin);
  backup.entities.Bitacora=[];
  source.restore(admin,backup,source.getRevision(),'2026-10-08T12:00:00.000Z');
  const after=source.snapshot(admin);
  expect(after.entities.Bitacora.slice(0,-1)).toEqual(before.entities.Bitacora);
  expect(after.entities.Bitacora.at(-1)?.detalle).toContain(`Respaldo revisión ${backup.revision}`);
  expect(after.entities.Bitacora.at(-1)?.detalle).toContain('2026-10-08T12:00:00.000Z');
  expect(after.revision).toBe(before.revision+1);
  source.restore(admin,backup,source.getRevision());
  expect(source.snapshot(admin).entities.Bitacora).toHaveLength(before.entities.Bitacora.length+2);
  const stable=source.snapshot(admin);
  expect(()=>source.restore(admin,backup,source.getRevision(),'invalid')).toThrow('fecha');
  expect(source.snapshot(admin)).toEqual(stable);
});
