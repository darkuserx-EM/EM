import { describe, expect, it } from 'vitest';
import { monthlyUsage } from '../domain/monthly-usage';
import { seedRecord } from './seed';

const stamp = (date: string) => Date.parse(`${date}T00:00:00-06:00`);
const reading = (date: string, valor: number, estimated = false, id = date) => seedRecord(id, id, { equipo_id: 'test', fecha: `${date}T00:00:00-06:00`, valor, es_estimado: estimated });
const now = stamp('2026-10-09');
const compute = (rows: ReturnType<typeof reading>[], options = {}) => monthlyUsage('test', rows, { now, ...options });

describe('uso mensual estimado', () => {
  it('distribuye por días reales de mes, incluido febrero bisiesto, conservando la diferencia', () => {
    const rows = [reading('2024-01-01', 100), reading('2024-04-01', 282)];
    const original = structuredClone(rows);
    const result = compute(rows, { now: stamp('2024-04-01') });
    expect(result.months.map(month => month.hours)).toEqual([62, 58, 62]);
    expect(result.months.every(month => month.complete)).toBe(true);
    expect(result.months.reduce((sum, month) => sum + month.hours, 0)).toBe(182);
    expect(rows).toEqual(original);
  });
  it('respeta el límite de mes de Guatemala aunque la fecha UTC sea del mes siguiente', () => {
    const a = { ...reading('2026-01-01', 10), fecha: '2026-02-01T05:00:00Z' };
    const b = { ...reading('2026-02-02', 12), fecha: '2026-02-01T07:00:00Z' };
    const result = compute([a, b], { now: stamp('2026-02-02') });
    expect(result.months.map(month => month.hours)).toEqual([1, 1]);
    expect(result.months.every(month => !month.complete)).toBe(true);
  });
  it('usa lecturas exteriores al filtro, incluye el día Hasta y excluye otros equipos', () => {
    const result = compute([reading('2026-01-01', 100), reading('2026-02-01', 162), { ...reading('2026-01-16', 999), equipo_id: 'other' }], { from: '2026-01-10', to: '2026-01-19' });
    expect(result.months).toHaveLength(1);
    expect(result.months[0].hours).toBe(20);
    expect(result.months[0].coveredMs / 86_400_000).toBe(10);
    expect(result.months[0].complete).toBe(false);
    expect(result.baseline).toBeUndefined();
  });
  it('separa ausencia de datos de un contador sin incremento', () => {
    expect(compute([]).months).toEqual([]);
    const single = compute([reading('2026-09-01', 10)]);
    expect(single.months.every(month => month.coveredMs === 0 && month.projectedMs === 0)).toBe(true);
    const zero = compute([reading('2026-09-01', 10), reading('2026-10-01', 10)]);
    expect(zero.months[0]).toMatchObject({ hours: 0, complete: true });
  });
  it('no duplica horas ni conecta a través de lecturas simultáneas contradictorias', () => {
    const rows = [reading('2026-09-01', 10), reading('2026-09-11', 30), reading('2026-09-11', 30, false, 'duplicate'), reading('2026-09-21', 50)];
    expect(compute(rows).months[0].hours).toBe(40);
    rows.push(reading('2026-09-11', 31, false, 'conflict'));
    const conflict = compute(rows);
    expect(conflict.months[0].coveredMs).toBe(0);
    expect(conflict.rejectedIntervals).toBe(2);
    expect(conflict.projection).toBeUndefined();
  });
  it('interrumpe reinicios y saltos imposibles, sin modificar valores ni sumar cifras negativas', () => {
    const result = compute([reading('2026-09-01', 100), reading('2026-09-02', 1), reading('2026-09-03', 100), reading('2026-09-04', 102)]);
    expect(result.rejectedIntervals).toBe(2);
    expect(result.months[0].hours).toBe(2);
    expect(result.months[0].complete).toBe(false);
    expect(result.projection).toBeUndefined();
  });
  it('mantiene barreras ante valores inválidos y omite fechas inválidas/futuras', () => {
    const result = compute([reading('2026-09-01', 10), reading('2026-09-11', NaN), reading('2026-09-21', 50), reading('invalid', 60), reading('2026-11-01', 70)]);
    expect(result.invalidReadings).toBe(2);
    expect(result.futureReadings).toBe(1);
    expect(result.months[0].coveredMs).toBe(0);
    expect(result.projection).toBeUndefined();
  });
  it('marca solo los meses que dependen de una lectura estimada y los intervalos largos', () => {
    const result = compute([reading('2026-01-01', 10), reading('2026-04-01', 100, true), reading('2026-05-01', 130), reading('2026-06-01', 161)], { now: stamp('2026-06-01') });
    expect(result.months.map(month => month.usesEstimatedReading)).toEqual([true, true, true, true, false]);
    expect(result.months.map(month => month.longGap)).toEqual([true, true, true, false, false]);
  });
  it('proyecta solo hasta hoy y divide la proyección entre meses con una tasa reciente conocida', () => {
    const rows = [reading('2026-07-01', 100), reading('2026-08-01', 162), reading('2026-09-10', 242)];
    const result = compute(rows);
    expect(result.projection?.dailyRate).toBe(2);
    expect(result.projection?.to).toBe(now);
    expect(result.months.map(month => month.projectedHours)).toEqual([0, 0, 42, 16]);
    expect(result.months.at(-1)?.complete).toBe(false);
    expect(result.months.reduce((sum, month) => sum + month.hours + month.projectedHours, 0)).toBe(200);
    expect(result.recentAverage).toBeUndefined();
  });
  it('recorta también la proyección con los filtros y no proyecta meses anteriores', () => {
    const rows = [reading('2026-07-01', 100), reading('2026-08-01', 162), reading('2026-09-10', 242)];
    expect(compute(rows, { from: '2026-09-20', to: '2026-09-24' }).months[0].projectedHours).toBe(10);
    expect(compute(rows, { from: '2026-08-01', to: '2026-08-31' }).months[0]).toMatchObject({ hours: 62, projectedHours: 0, complete: true });
  });
  it('no proyecta con lecturas antiguas, insuficientes, muy próximas, estimadas o sin incremento', () => {
    expect(compute([reading('2026-06-01', 10), reading('2026-07-01', 40), reading('2026-08-01', 71)]).projectionReason).toBe('stale');
    expect(compute([reading('2026-09-01', 10), reading('2026-10-01', 40)]).projectionReason).toBe('sparse');
    expect(compute([reading('2026-10-01', 10), reading('2026-10-02', 11), reading('2026-10-03', 12)]).projectionReason).toBe('sparse');
    expect(compute([reading('2026-09-01', 10), reading('2026-09-15', 24), reading('2026-10-01', 40, true)]).projectionReason).toBe('unreliable');
    expect(compute([reading('2026-09-01', 10), reading('2026-09-15', 10), reading('2026-10-01', 10)]).projectionReason).toBe('zero');
  });
  it('permite proyectar al recuperar tres lecturas limpias tras un reinicio', () => {
    const result = compute([reading('2026-08-01', 100), reading('2026-09-01', 10), reading('2026-09-15', 24), reading('2026-10-01', 40)]);
    expect(result.projection?.dailyRate).toBe(1);
    expect(result.rejectedIntervals).toBe(1);
  });
  it('no usa estimaciones duplicadas ni lecturas antiguas para completar la muestra reciente', () => {
    const rows = [reading('2026-07-01', 100), reading('2026-08-01', 162), reading('2026-09-10', 242)];
    expect(compute([...rows, reading('2026-08-01', 162, true, 'duplicate-estimated')]).projection).toBeUndefined();
    expect(compute([...rows, reading('2026-12-01', 300)]).projectionReason).toBe('unreliable');
    expect(compute([reading('2025-07-01', 100), reading('2026-08-01', 162), reading('2026-09-10', 242)]).projectionReason).toBe('sparse');
  });
  it('calcula promedios solo con meses completos y recientes consecutivos', () => {
    const result = compute([reading('2025-12-15', 100), reading('2026-05-01', 374)], { now: stamp('2026-05-01') });
    expect(result.baseline).toBeUndefined(); // El primer año visible no tiene tres meses completos.
    expect(result.recentAverage?.hours).toBeCloseTo((28 + 31 + 30) * 2 / 3);
    const filtered = compute([reading('2025-12-15', 100), reading('2026-05-01', 374)], { from: '2026-01-01', now: stamp('2026-05-01') });
    expect(filtered.baseline?.hours).toBe(60);
    expect(filtered.baseline?.count).toBe(4);
  });
  it('limita meses visibles, recupera períodos anteriores y maneja un rango invertido', () => {
    const rows = [reading('2020-01-01', 100), reading('2026-10-01', 200)];
    const result = compute(rows);
    expect(result.months).toHaveLength(24);
    expect(result.omittedMonths).toBeGreaterThan(0);
    expect(compute(rows, { from: '2020-01-01', to: '2020-12-31' }).months[0].key).toBe('2020-01');
    expect(compute(rows, { from: '2026-10-01', to: '2026-09-01' }).months).toEqual([]);
  });
});
