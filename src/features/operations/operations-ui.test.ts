import { describe, expect, it } from 'vitest';
import type { EntityRecord } from '../../domain/model';
import { dateTimeInput, emptyOperationFilters, filterOperations, fromDateTimeInput, operationDay, optionalMeterFields } from './operations-ui';
const record = (values: Record<string, unknown>) => ({ id: 'a', codigo: 'OS-1', creado_por: '', fecha_creacion: '', actualizado_por: '', fecha_actualizacion: '', ...values }) as EntityRecord;
describe('operational date and report filters', () => {
  it('keeps Guatemala dates across UTC midnight and round trips field times', () => {
    expect(operationDay('2026-10-11T02:15:00Z')).toBe('2026-10-10');
    expect(dateTimeInput('2026-10-11T02:15:00Z')).toBe('2026-10-10T20:15');
    expect(fromDateTimeInput('2026-10-10T20:15')).toBe('2026-10-11T02:15:00.000Z');
    expect(operationDay('bad')).toBe('');
  });
  it('does not count historical pending orders as current work', () => {
    const rows = [record({ id: 'history', estado: 'Pendiente', importado: true }), record({ id: 'new', schema_operacion: 1, estado: 'Borrador' })];
    expect(filterOperations(rows, { ...emptyOperationFilters, origin: 'actual' }, [], []).map(row => row.id)).toEqual(['new']);
  });
  it('combines client, assignment and inclusive civil-date filters', () => {
    const rows = [record({ cliente_id: 'c', tecnico_id: 't', fecha: '2026-10-11T02:15:00Z' }), record({ id: 'b', cliente_id: 'other', tecnico_id: 't', fecha: '2026-10-10T20:15:00Z' })];
    expect(filterOperations(rows, { ...emptyOperationFilters, client: 'c', technician: 't', from: '2026-10-10', to: '2026-10-10' }, [], []).map(row => row.id)).toEqual(['a']);
  });
  it('keeps optional readings absent in create and edit requests while preserving explicit zero', () => {
    expect(optionalMeterFields({ horometro: '', odometro_millas: '  ' })).toEqual({});
    expect(optionalMeterFields({ horometro: '', odometro_millas: '' }, record({ estado: 'En proceso' }))).toEqual({});
    expect(optionalMeterFields({ horometro: '0', odometro_millas: '51.5' })).toEqual({ horometro: 0, odometro_millas: 51.5 });
  });
  it('does not silently erase an existing reading or accept an invalid number', () => {
    expect(() => optionalMeterFields({ horometro: '', odometro_millas: '' }, record({ horometro: 1234 }))).toThrow('Conserva el horómetro');
    expect(() => optionalMeterFields({ horometro: '-2' })).toThrow('mayor o igual a cero');
  });
});
