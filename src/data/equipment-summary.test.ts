import { describe, expect, it } from 'vitest';
import { seedRecord } from './seed';
import { equipmentHistory } from '../domain/equipment-history';
import { meterSegments, summarizeEquipment } from '../domain/equipment-summary';

const report = (id: string, fecha: string, tipo: string, estado = 'Completado', equipo_id = 'test-equipment') => seedRecord(id, id, { equipo_id, fecha, tipo, estado, importado: true });
const reading = (id: string, day: number, valor: number, estimated = false) => seedRecord(id, id, { equipo_id: 'test-equipment', fecha: `2026-01-${String(day).padStart(2, '0')}T12:00:00-06:00`, valor, es_estimado: estimated });

describe('resumen del equipo con datos históricos', () => {
  it('respeta equipo y fechas, agrupa todos los tipos sin convertir pendientes en fallas actuales', () => {
    const history = equipmentHistory('test-equipment', [
      report('old', '2025-12-31', 'Correctivo'),
      report('other', '2026-01-04', 'Correctivo', 'Completado', 'another-equipment'),
      report('pm', '2026-01-05', 'Mantenimiento Preventivo'),
      report('pending-pm', '2026-01-10', 'Preventivo', 'Pendiente'),
      report('major', '2026-01-08', 'Mantenimiento Mayor'),
      report('inspection', '2026-01-06', 'Inspección'),
    ], [], [], [], '2026-01-01', '2026-01-31');
    const summary = summarizeEquipment(history);
    expect(summary.serviceTypes.reduce((sum, group) => sum + group.count, 0)).toBe(4);
    expect(summary.serviceTypes.find(group => group.label === 'Inspecciones')?.count).toBe(1);
    expect(summary.serviceTypes.find(group => group.label === 'Otros')).toBeUndefined();
    expect(summary.pendingReports).toBe(1);
    expect(summary.lastPreventive?.id).toBe('pm');
    expect(summary.lastMajor?.id).toBe('major');
  });
  it('cuenta las órdenes cerradas en el portal con su vocabulario («Completada», «Mantenimiento mayor»)', () => {
    const history = equipmentHistory('test-equipment', [
      report('portal-major', '2026-01-09', 'Mantenimiento mayor', 'Completada'),
      report('portal-pm', '2026-01-07', 'Preventivo', 'Completada'),
      report('unknown', '2026-01-03', 'Instalación', 'Completada'),
      report('draft', '2026-01-08', 'Mantenimiento mayor', 'Borrador'),
    ], [], [], [], '2026-01-01', '2026-01-31');
    const summary = summarizeEquipment(history);
    expect(summary.serviceTypes.find(group => group.label === 'Mayores')?.count).toBe(2);
    expect(summary.serviceTypes.find(group => group.label === 'Otros')?.count).toBe(1);
    expect(summary.lastMajor?.id).toBe('portal-major');
    expect(summary.lastPreventive?.id).toBe('portal-pm');
  });
  it('no supone mantenimiento completado cuando falta confirmación en el reporte', () => {
    const history = equipmentHistory('test-equipment', [report('pm', '2026-01-05', 'Preventivo', 'Pendiente de firma'), report('major', '2026-01-06', 'Mantenimiento Mayor', 'Pendiente')], [], [], []);
    expect(summarizeEquipment(history).lastPreventive).toBeUndefined();
    expect(summarizeEquipment(history).lastMajor).toBeUndefined();
  });
  it('conserva vacíos y una sola lectura sin inventar uso ni un próximo mantenimiento', () => {
    const empty = equipmentHistory('test-equipment', [], [], [], []);
    expect(empty.hoursUsed).toBeNull();
    expect(summarizeEquipment(empty).estimatedReadings).toBe(0);
    expect(meterSegments(empty.usage)).toEqual([]);
    const single = equipmentHistory('test-equipment', [], [reading('first', 1, 150)], [], []);
    expect(single.hoursUsed).toBeNull();
    expect(meterSegments(single.usage)).toEqual([]);
  });
  it('corta la gráfica al bajar el contador y marca solo los tramos que dependen de una estimación', () => {
    const rows = [reading('first', 1, 100), reading('estimated', 2, 120, true), reading('third', 3, 140), reading('reset', 4, 10), reading('fifth', 5, 30)];
    const original = structuredClone(rows);
    const history = equipmentHistory('test-equipment', [], rows, [], []);
    expect(history.hoursUsed).toBeNull();
    expect(summarizeEquipment(history).estimatedReadings).toBe(1);
    expect(meterSegments(history.usage)).toEqual([
      { from: 0, to: 1, estimated: true }, { from: 1, to: 2, estimated: true }, { from: 3, to: 4, estimated: false },
    ]);
    expect(rows).toEqual(original);
  });
  it('no dibuja fuera de las fechas filtradas ni conecta lecturas no consecutivas', () => {
    const rows = [reading('first', 1, 100), reading('second', 2, 120), reading('third', 3, 150)];
    const filtered = equipmentHistory('test-equipment', [], rows, [], [], '2026-01-02', '2026-01-03');
    expect(filtered.hoursUsed).toBe(30);
    expect(meterSegments(filtered.usage)).toEqual([{ from: 0, to: 1, estimated: false }]);
    const all = equipmentHistory('test-equipment', [], rows, [], []);
    expect(meterSegments([all.usage[0], all.usage[2]])).toEqual([]);
  });
});
