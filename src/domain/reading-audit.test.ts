import { it, expect } from 'vitest';
import { createSeed, demoUsers } from '../data/seed';
import { LocalDataSource } from '../data/repository';
import { latestEquipmentReading } from './equipment-history';
import { formatHourMeter } from './format';

it.each([
  ['2026-10-01T10:00:00Z', '2026-10-01T05:00:00-06:00', true],
  ['2026-10-01T10:00:00-06:00', '2026-10-01T12:00:00Z', false],
  ['2026-10-01T10:00:00Z', '2026-10-01T04:00:00-06:00', false],
])('compara instantes reales: %s → %s', async (previous, next, accepted) => {
  const db = createSeed();
  db.entities.LecturaHorometro = [{ ...db.entities.Equipo[0], id: 'reading-a', codigo: 'HOR-001', equipo_id: 'equipment-1', fecha: previous, valor: 100 }];
  let saved = JSON.stringify(db);
  const source = new LocalDataSource({ getItem: () => saved, setItem: (_k, v) => { saved = v; } }, { demoHistory: false });
  const before = source.snapshot(demoUsers[0]);
  const result = source.repository('LecturaHorometro', demoUsers[0]).create({ equipo_id: 'equipment-1', fecha: next, valor: 101 });
  if (accepted) expect((await result).fecha).toBe(next);
  else { await expect(result).rejects.toThrow('posterior'); expect(source.snapshot(demoUsers[0])).toEqual(before); }
});

it('selecciona la lectura más reciente en lista y ficha sin sobrescribir el equipo', () => {
  const db = createSeed(); const eq = db.entities.Equipo[0];
  const readings = [
    { ...eq, id: 'b', equipo_id: eq.id, fecha: '2026-10-01T12:00:00Z', valor: 860 },
    { ...eq, id: 'a', equipo_id: eq.id, fecha: '2026-10-01T10:00:00-06:00', valor: 870, es_estimado: true },
    { ...eq, id: 'other', equipo_id: 'other', fecha: '2026-10-02T10:00:00Z', valor: 9999 },
  ];
  expect(latestEquipmentReading(eq.id, readings)).toMatchObject({ id: 'a', valor: 870, es_estimado: true });
  expect(latestEquipmentReading(eq.id, [])).toBeUndefined();
  expect(formatHourMeter(0)).toBe('0 h');
  for (const absent of [null, undefined, '', NaN]) expect(formatHourMeter(absent)).toBe('Pendiente');
});
