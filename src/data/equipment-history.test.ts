import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createSeed, demoUsers, seedRecord } from './seed';
import { LocalDataSource, STORAGE_KEY, type StorageAdapter } from './repository';
import { equipmentHistory, inDateRange } from '../domain/equipment-history';
import { makeEquipmentHistoryWorkbook } from './excel';
import { validateDatabase } from '../domain/validation';
import type { Database, EntityRecord } from '../domain/model';

const admin = demoUsers[0];
function legacySeed() {
  const data = createSeed();
  data.entities.Bitacora = data.entities.Bitacora.filter(row => row.id !== 'log-equipment-history-v1');
  for (const name of ['OrdenServicio', 'LecturaHorometro', 'OTHoras', 'OTRepuesto'] as const) data.entities[name] = [];
  return data;
}
function memory(data: Database) {
  let value = JSON.stringify(data);
  const storage: StorageAdapter = { getItem: () => value, setItem: (_key, next) => { value = next; } };
  return storage;
}
function history(data = createSeed(), id = 'equipment-1', from = '', to = '') {
  return equipmentHistory(id, data.entities.OrdenServicio, data.entities.LecturaHorometro, data.entities.OTRepuesto, data.entities.OTHoras, from, to);
}

describe('actualización conservadora de la muestra', () => {
  it('conserva catálogos, aumenta revisión y añade historia solo una vez', () => {
    const old = legacySeed(); old.revision = 5;
    old.entities.Catalogos.push(seedRecord('user-catalog', 'CAT-500', { categoria: 'Marcas', nombre: 'Cambio del usuario', activo: false }));
    const storage = memory(old); const source = new LocalDataSource(storage); const upgraded = source.snapshot(admin);
    expect(upgraded.entities.Catalogos).toEqual(old.entities.Catalogos);
    expect(upgraded.entities.Equipo).toEqual(old.entities.Equipo);
    expect(upgraded.revision).toBe(6);
    expect(upgraded.entities.OrdenServicio).toHaveLength(75);
    expect(upgraded.entities.LecturaHorometro).toHaveLength(250);
    expect(new LocalDataSource(storage).snapshot(admin)).toEqual(upgraded);
  });
  it('no inventa historia para equipos modificados o con registros existentes', () => {
    const old = legacySeed(); old.entities.Equipo[0].serie = 'SERIE-DEL-USUARIO';
    old.entities.LecturaHorometro.push(seedRecord('reading-user', 'HOR-USER', { equipo_id: 'equipment-2', fecha: '2026-10-03T16:00:00Z', valor: 950 }));
    const upgraded = new LocalDataSource(memory(old)).snapshot(admin);
    expect(history(upgraded, 'equipment-1').repairs).toHaveLength(0);
    expect(history(upgraded, 'equipment-2').repairs).toHaveLength(0);
    expect(history(upgraded, 'equipment-2').usage).toHaveLength(1);
  });
  it('conserva íntegro el respaldo anterior si falla el guardado de la ampliación', () => {
    const storage = memory(legacySeed()); const before = storage.getItem(STORAGE_KEY);
    storage.setItem = () => { throw new Error('Sin espacio'); };
    expect(() => new LocalDataSource(storage)).toThrow('se conservaron');
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });
});

describe('historial y cálculo de uso', () => {
  it('vincula solamente las reparaciones, repuestos y horas del equipo seleccionado', () => {
    const result = history();
    expect(result.repairs.map(row => row.codigo)).toEqual(['OT-003', 'OT-002', 'OT-001']);
    expect(result.parts).toHaveLength(2); expect(result.labor).toHaveLength(3);
    expect(result.parts.every(row => row.equipo_id === 'equipment-1')).toBe(true);
    expect(result.hoursUsed).toBe(240);
    expect(result.usage.at(-1)?.row.valor).toBe(850);
    expect(result.labor.reduce((sum, row) => sum + Number(row.horas), 0)).toBe(7);
  });
  it('filtra fechas inclusivas y calcula uso solo entre lecturas seleccionadas', () => {
    const result = history(createSeed(), 'equipment-1', '2026-09-01', '2026-10-03');
    expect(result.repairs).toHaveLength(1); expect(result.parts).toHaveLength(0); expect(result.labor).toHaveLength(1);
    expect(result.usage).toHaveLength(3); expect(result.hoursUsed).toBe(35);
    // First displayed interval starts before the filter; excluded from the period total.
    expect(result.usage[0].delta).toBe(30);
    expect(result.usage[0].previous?.fecha).toBe('2026-08-31T16:00:00.000Z');
  });
  it('aplica las fechas según Guatemala, incluyendo las últimas horas del día', () => {
    const record = seedRecord('r', 'HOR-X', { fecha: '2026-10-04T02:00:00Z' });
    expect(inDateRange(record, '2026-10-03', '2026-10-03')).toBe(true);
    expect(inDateRange(record, '2026-10-04', '')).toBe(false);
  });
  it('no presenta cero horas cuando no se puede calcular y respeta equipos sin historia', () => {
    expect(history(createSeed(), 'equipment-1', '2026-10-03').hoursUsed).toBeNull();
    const empty = history(createSeed(), 'missing');
    expect(empty.repairs).toEqual([]); expect(empty.usage).toEqual([]); expect(empty.hoursUsed).toBeNull();
  });
  it('no interpreta una disminución del horómetro como uso negativo', () => {
    const data = createSeed(); data.entities.LecturaHorometro[8].valor = 1;
    const result = history(data);
    expect(result.usage[8].delta).toBeNull(); expect(result.hoursUsed).toBeNull();
  });
  it('identifica intervalos estimados sin convertir en estimación la diferencia entre extremos reportados', () => {
    const data = legacySeed();
    data.entities.LecturaHorometro = [
      seedRecord('r1','HOR-001',{equipo_id:'equipment-1',fecha:'2026-01-01T16:00:00Z',valor:100}),
      seedRecord('r2','HOR-002',{equipo_id:'equipment-1',fecha:'2026-01-10T16:00:00Z',valor:150,es_estimado:true,valor_original:5,nota_estimacion:'Interpolación; pendiente de confirmar.'}),
      seedRecord('r3','HOR-003',{equipo_id:'equipment-1',fecha:'2026-01-20T16:00:00Z',valor:200}),
    ];
    const all=history(data);
    expect(all.usage.map(item=>item.estimated)).toEqual([false,true,true]);
    expect(all.hoursUsed).toBe(100); expect(all.hoursUsedEstimated).toBe(false);
    const partial=history(data,'equipment-1','2026-01-10','2026-01-20');
    expect(partial.hoursUsed).toBe(50); expect(partial.hoursUsedEstimated).toBe(true);
    const workbook=makeEquipmentHistoryWorkbook(data.entities.Equipo[0],partial,'2026-01-10','2026-01-20');
    const exported=XLSX.utils.sheet_to_json<EntityRecord>(workbook.Sheets.Horometros);
    expect(exported[0]).toMatchObject({valor:150,valor_original:5,es_estimado:true});
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Información)).toContainEqual({campo:'Calidad del uso calculado',valor:'Estimado: uno de los extremos es una lectura estimada'});
  });
  it('rechaza órdenes cruzadas entre equipos y lecturas no numéricas en respaldos', () => {
    const data = createSeed(); data.entities.OTRepuesto[0].orden_id = 'service-2-0';
    expect(() => validateDatabase(data)).toThrow('no corresponde');
    const invalid = createSeed(); invalid.entities.LecturaHorometro[0].valor = 'muchas';
    expect(() => validateDatabase(invalid)).toThrow('número');
  });
});

describe('permisos y exportación del expediente', () => {
  it('excluye costos internos del repositorio de coordinación, técnico y cliente', async () => {
    const source = new LocalDataSource(memory(createSeed()));
    const published = (await source.repository('OrdenServicio', admin).getAll()).find(row => row.cliente_id === demoUsers[5].cliente_id)!;
    await source.repository('OrdenServicio', admin).update(published.id, { visible_cliente: true, expected_updated_at: published.fecha_actualizacion });
    for (const actor of [demoUsers[1], demoUsers[2], demoUsers[5]]) {
      const orders = await source.repository('OrdenServicio', actor).getAll();
      expect(orders.length).toBeGreaterThan(0);
      expect(orders.every(row => !Object.keys(row).some(key => key.startsWith('costo_')))).toBe(true);
      if (actor.rol === 'Cliente') { expect(orders.every(row => row.cliente_id === actor.cliente_id)).toBe(true); expect(orders.map(row => row.id)).toEqual([published.id]); }
      if (actor.rol === 'Técnico') expect(orders.every(row => row.tecnico_id === actor.tecnico_id)).toBe(true);
    }
    expect((await source.repository('OrdenServicio', admin).getAll())[0].costo_mano_obra).toBe(240);
  });
  it('exporta un XLSX administrativo solo con el equipo y fechas seleccionados', async () => {
    const source = new LocalDataSource(memory(createSeed())); const actor = admin;
    const services = await source.repository('OrdenServicio', actor).export();
    const readings = await source.repository('LecturaHorometro', actor).export();
    const parts = await source.repository('OTRepuesto', actor).export();
    const labor = await source.repository('OTHoras', actor).export();
    const filtered = equipmentHistory('equipment-1', services, readings, parts, labor, '2026-08-01', '2026-08-31');
    const workbook = makeEquipmentHistoryWorkbook(createSeed().entities.Equipo[0], filtered, '2026-08-01', '2026-08-31');
    const roundTrip = XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    const orders = XLSX.utils.sheet_to_json<EntityRecord>(roundTrip.Sheets.Reparaciones);
    expect(orders).toHaveLength(1); expect(orders[0].codigo).toBe('OT-002');
    expect(orders[0]).toHaveProperty('costo_mano_obra');
    const part = XLSX.utils.sheet_to_json<EntityRecord>(roundTrip.Sheets.Repuestos)[0];
    expect(part.equipo_id).toBe('equipment-1'); expect(part).toHaveProperty('costo_unitario');
    expect(XLSX.utils.sheet_to_json(roundTrip.Sheets.Horometros)).toHaveLength(2);
  });
});
