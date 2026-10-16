import { describe, expect, it } from 'vitest';
import { seedRecord } from '../data/seed';
import { historicalReadingAuthor, planHistoricalReadingCleanup } from './historical-readings';

const order = (id: string, origen: string, orden: string, cliente = 'client-1') => seedRecord(id, `OS-H-${id}`, { importado: true, origen_id: origen, orden_origen: orden, cliente_id: cliente, equipo_id: 'equipment-1' });
const imported = (id: string, orderId: string, fecha: string, valor: number) => seedRecord(id, `HOR-H-${id}`, { equipo_id: 'equipment-1', cliente_id: 'client-1', orden_id: orderId, fecha, valor, origen: 'Orden de servicio', registrado_por: historicalReadingAuthor, es_estimado: false });
const kept = (id: string, fields: Record<string, string | number | boolean>) => seedRecord(id, `HOR-${id}`, { equipo_id: 'equipment-1', cliente_id: 'client-1', orden_id: '', registrado_por: 'Administración', es_estimado: false, ...fields });

describe('depuración de lecturas de la importación histórica', () => {
  const orders = [order('o1', 'A1', '101'), order('o2', 'A2', '102'), order('o3', 'A3', '103'), order('o4', 'A4', '104'), order('o5', 'A5', '105'), order('o9', 'Z9', '901', 'client-2')];
  const readings = [
    kept('k1', { fecha: '2026-10-01T15:00:00.000Z', valor: 500, origen: 'Ingreso de equipo' }),
    kept('k2', { fecha: '2025-03-01T22:00:00.000Z', valor: 300, valor_original: 280, es_estimado: true, origen: 'Lectura manual' }),
    kept('k3', { fecha: '2025-04-01T22:00:00.000Z', valor: 999, origen: 'Lectura manual' }),
    imported('i1', 'o1', '2025-05-01T15:00:00.000Z', 500),
    imported('i2', 'o2', '2025-03-01T15:00:00.000Z', 280),
    imported('i3', 'o3', '2025-04-01T15:00:00.000Z', 400),
    imported('i4', 'o4', '2025-04-01T20:00:00.000Z', 400),
    imported('i5', 'o5', '2025-04-15T15:00:00.000Z', 450),
    { ...imported('i9', 'o9', '2025-04-01T15:00:00.000Z', 500), cliente_id: 'client-2' },
    { ...imported('m1', 'o3', '2025-04-01T15:00:00.000Z', 400), registrado_por: 'Administración' },
  ];

  it('propone solo lecturas importadas que repiten una conservada, otra importada o son de un reporte excluido', () => {
    const plan = planHistoricalReadingCleanup({ OrdenServicio: orders, LecturaHorometro: readings }, 'client-1', [' 105 ']);
    expect(plan.map(item => [item.reading.id, item.reason, item.kept?.id ?? null, item.order.orden_origen])).toEqual([
      ['i2', 'Repite una lectura conservada', 'k2', '102'],
      ['i3', 'Repite una lectura conservada', 'm1', '103'],
      ['i4', 'Repite una lectura conservada', 'm1', '104'],
      ['i5', 'Reporte excluido', null, '105'],
      ['i1', 'Repite una lectura conservada', 'k1', '101'],
    ]);
  });
  it('entre lecturas importadas del mismo día conserva la primera', () => {
    const plan = planHistoricalReadingCleanup({ OrdenServicio: orders, LecturaHorometro: readings.filter(row => row.id !== 'm1') }, 'client-1');
    expect(plan.find(item => item.reading.id === 'i4')).toMatchObject({ reason: 'Repite otra lectura importada', kept: { id: 'i3' } });
    expect(plan.some(item => item.reading.id === 'i3' || item.reading.id === 'i5')).toBe(false);
  });
  it('no toca lecturas de otros clientes, sin orden importada o registradas por otra persona', () => {
    const plan = planHistoricalReadingCleanup({ OrdenServicio: orders, LecturaHorometro: readings }, 'client-1', ['A1', 'A2', 'A3', 'A4', 'A5', '901']);
    expect(plan.map(item => item.reading.id).sort()).toEqual(['i1', 'i2', 'i3', 'i4', 'i5']);
    expect(planHistoricalReadingCleanup({ OrdenServicio: orders, LecturaHorometro: readings }, 'client-3')).toEqual([]);
  });
});
