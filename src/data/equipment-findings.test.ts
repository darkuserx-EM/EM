import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createSeed, demoUsers } from './seed';
import { LocalDataSource } from './repository';
import { makeBackup, parseBackup } from './excel';
import { findingSummary, recommendationReports } from '../domain/equipment-findings';
import type { Database, Scalar } from '../domain/model';

const admin = demoUsers[0];
function fixture(initial: unknown = createSeed()) {
  let saved = JSON.stringify(initial);
  return new LocalDataSource({ getItem: () => saved, setItem: (_key, value) => { saved = value; } }, { demoHistory: false });
}
const fields = { equipo_id: 'equipment-1', descripcion: 'Revisar rueda de tracción', componente: 'Llantas y rodos', prioridad: 'Por definir', estado: 'Por confirmar', orden_origen_id: '' };

describe('seguimiento de hallazgos', () => {
  it('abre espacios anteriores sin crear hallazgos a partir de notas históricas', () => {
    const db = createSeed(); db.entities.OrdenServicio[0].notas_seguridad = 'Revisar rueda';
    const legacy = structuredClone(db) as unknown as { entities: Record<string, unknown> }; delete legacy.entities.Hallazgo;
    const source = fixture(legacy); const current = source.snapshot(admin);
    expect(current.entities.Hallazgo).toEqual([]);
    expect(current.entities.OrdenServicio).toEqual(db.entities.OrdenServicio);
    expect(recommendationReports(current.entities.OrdenServicio, 'equipment-1')).toHaveLength(1);
    expect(findingSummary(current.entities.Hallazgo, 'equipment-1').active).toBe(0);
  });
  it('crea, programa y cierra con evidencia del mismo equipo, sin cambiar su estado ni sus lecturas', async () => {
    const data = createSeed(); data.entities.OrdenServicio.find(row => row.id === 'service-1-2')!.estado = 'Completado';
    const source = fixture(data); const repo = source.repository('Hallazgo', admin);
    const before = source.snapshot(admin);
    const row = await repo.create({ ...fields, orden_origen_id: 'service-1-0', actualizado_nombre: 'Nombre falso', cerrado_el: '2000-01-01' });
    expect(row.actualizado_nombre).toBe(admin.nombre); expect(row.cerrado_el).toBe('');
    const scheduled = await repo.update(row.id, { estado: 'Programado', prioridad: 'Alta', responsable: 'Responsable de prueba', fecha_programada: '2026-10-15', nota_cambio: 'Visita acordada' });
    expect(scheduled.estado).toBe('Programado');
    const closed = await repo.update(row.id, { estado: 'Resuelto', orden_resolucion_id: 'service-1-2', detalle_resolucion: 'Rueda sustituida y verificada.', nota_cambio: 'Trabajo confirmado' });
    expect(closed.cerrado_el).toMatch(/^\d{4}-/);
    const after = source.snapshot(admin);
    expect(after.entities.Equipo).toEqual(before.entities.Equipo); expect(after.entities.LecturaHorometro).toEqual(before.entities.LecturaHorometro); expect(after.entities.OrdenServicio).toEqual(before.entities.OrdenServicio);
    expect(after.entities.Bitacora.filter(log => log.hallazgo_id === row.id).map(log => log.estado_nuevo)).toEqual(['Por confirmar', 'Programado', 'Resuelto']);
    expect(findingSummary(after.entities.Hallazgo, 'equipment-1')).toMatchObject({ active: 0, closed: 1 });
    await repo.update(row.id, { estado: 'Abierto', orden_resolucion_id: '', detalle_resolucion: '', nota_cambio: 'Reapertura por revisión adicional' });
    expect((await repo.getById(row.id))?.cerrado_el).toBe('');
  });
  it('rechaza relaciones cruzadas, duplicados, fechas inválidas y programación incompleta sin escrituras parciales', async () => {
    const source = fixture(); const repo = source.repository('Hallazgo', admin);
    const original = source.snapshot(admin);
    for (const change of [
      { equipo_id: 'missing' }, { orden_origen_id: 'service-2-0' }, { estado: 'Abierto' },
      { estado: 'Programado', prioridad: 'Alta' }, { fecha_programada: '2026-02-30' }, { estado: 'Descartado' },
      { estado: 'Resuelto', prioridad: 'Alta', detalle_resolucion: 'Reparado', orden_resolucion_id: 'service-1-2' },
    ] as Record<string, Scalar>[]) {
      await expect(repo.create({ ...fields, ...change })).rejects.toThrow();
      expect(source.snapshot(admin)).toEqual(original);
    }
    const row = await repo.create(fields);
    await expect(repo.create({ ...fields, descripcion: '  REVISAR RUEDA DE TRACCIÓN ' })).rejects.toThrow('Ya existe');
    await expect(repo.update(row.id, { equipo_id: 'equipment-2' })).rejects.toThrow('se conservan');
    await expect(repo.update(row.id, { estado: 'Abierto', prioridad: 'Alta' })).rejects.toThrow('motivo');
    await expect(repo.remove(row.id)).rejects.toThrow('Conserva');
  });
  it('exige un servicio completado posterior al origen y conserva la evidencia de descarte', async () => {
    const db = createSeed(); db.entities.OrdenServicio.forEach(row => { row.estado = 'Completado'; });
    const source = fixture(db); const repo = source.repository('Hallazgo', admin);
    const row = await repo.create({ ...fields, prioridad: 'Alta', orden_origen_id: 'service-1-2' });
    await expect(repo.update(row.id, { estado: 'Resuelto', orden_resolucion_id: 'service-1-0', detalle_resolucion: 'Reparado', nota_cambio: 'Cierre' })).rejects.toThrow('anterior');
    await expect(repo.update(row.id, { estado: 'Resuelto', orden_resolucion_id: 'service-2-2', detalle_resolucion: 'Reparado', nota_cambio: 'Cierre' })).rejects.toThrow('no corresponde');
    await repo.update(row.id, { estado: 'Descartado', detalle_resolucion: 'Duplicado de otra inspección revisada.', nota_cambio: 'Revisión del historial' });
    expect((await repo.getById(row.id))?.detalle_resolucion).toContain('Duplicado');
  });
  it('mantiene lectura y escritura de hallazgos solo para administración', async () => {
    const source = fixture(); await source.repository('Hallazgo', admin).create(fields);
    for (const actor of [demoUsers[1], demoUsers[2], demoUsers[5]]) {
      expect(await source.repository('Hallazgo', actor).getAll()).toEqual([]);
      await expect(source.repository('Hallazgo', actor).create(fields)).rejects.toThrow('administración');
    }
  });
  it('exporta/restaura hallazgos y distingue una hoja nueva perdida de un respaldo antiguo', async () => {
    const source = fixture(); await source.repository('Hallazgo', admin).create(fields);
    const data = source.snapshot(admin); const workbook = makeBackup(data);
    expect(parseBackup(workbook).entities.Hallazgo[0].descripcion).toBe(fields.descripcion);
    const target = fixture(); target.restore(admin, parseBackup(workbook), target.getRevision());
    expect(target.snapshot(admin).entities.Hallazgo).toEqual(data.entities.Hallazgo);
    delete workbook.Sheets.Hallazgo;
    expect(() => parseBackup(workbook)).toThrow('Falta la hoja Hallazgo');
    const old = makeBackup(createSeed()); delete old.Sheets.Hallazgo;
    old.Sheets._metadata = XLSX.utils.json_to_sheet([{schemaVersion:1,revision:0,aplicacion:'Portal EM'}]);
    expect(parseBackup(old).entities.Hallazgo).toEqual([]);
    const legacy = createSeed() as Database; delete (legacy.entities as Partial<Database['entities']>).Hallazgo;
    const restored = fixture(); restored.restore(admin, legacy, restored.getRevision());
    expect(restored.snapshot(admin).entities.Hallazgo).toEqual([]);
  });
});
