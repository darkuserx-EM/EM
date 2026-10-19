import { describe, expect, it } from 'vitest';
import type { EntityRecord } from '../../domain/model';
import { changedFields, dateTimeInput, emptyOperationFilters, filterOperations, fromDateTimeInput, meterWarning, operationDay, optionalMeterFields, orderAssignmentFields, orderExecutionFields, orderNotStarted, savedFormValues } from './operations-ui';
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

describe('guardar avance en la orden (ServiceOrderForm)', () => {
  const formValues = (row: EntityRecord) => ({ ...Object.fromEntries([...orderAssignmentFields, ...orderExecutionFields].map(key => [key, String(row[key] ?? '')])), fecha: dateTimeInput(row.fecha), fecha_fin: dateTimeInput(row.fecha_fin), visible_cliente: row.visible_cliente === true ? 'true' : 'false' });
  const fieldsOf = (values: Record<string, string>) => ({ ...Object.fromEntries(orderExecutionFields.filter(key => !['horometro', 'odometro_millas'].includes(key)).map(key => [key, ['fecha', 'fecha_fin'].includes(key) ? fromDateTimeInput(values[key]) : values[key]])), ...optionalMeterFields(values) });
  it('envía solo lo que cambió y, tras cada guardado, parte de la orden que devolvió el servidor', () => {
    const order = record({ estado: 'En proceso', tecnico_id: 't1', fecha: '2026-10-13T16:34:50.000Z', diagnostico: 'Cadena floja', horometro: 4206, visible_cliente: false });
    const initial = formValues(order);
    // Iniciar atención / primer avance: solo el diagnóstico y el trabajo que se escribieron.
    const first = { ...initial, diagnostico: 'Cadena floja y desgastada', trabajo_realizado: 'Ajuste de cadenas' };
    expect(changedFields(fieldsOf(first), first, initial)).toEqual({ diagnostico: 'Cadena floja y desgastada', trabajo_realizado: 'Ajuste de cadenas' });
    // El servidor devuelve la orden guardada: ese es el nuevo punto de partida, campo por campo.
    const saved = record({ ...order, diagnostico: first.diagnostico, trabajo_realizado: first.trabajo_realizado, fecha_actualizacion: '2026-10-13T17:00:00.000Z' });
    const baseline = savedFormValues(saved, first);
    for (const key of [...orderAssignmentFields, ...orderExecutionFields].filter(key => !['fecha', 'fecha_fin'].includes(key))) expect(baseline[key]).toBe(String(saved[key] ?? ''));
    expect(baseline.fecha).toBe('2026-10-13T10:34');
    // Guardar avance otra vez sin cambios no envía nada; un cambio nuevo viaja solo.
    expect(changedFields(fieldsOf(baseline), baseline, baseline)).toEqual({});
    const second = { ...baseline, resultado_pruebas: 'Funciona correctamente', horometro: '4207' };
    expect(changedFields(fieldsOf(second), second, baseline)).toEqual({ resultado_pruebas: 'Funciona correctamente', horometro: 4207 });
    // Completar: el cambio de estado y el final viajan con lo demás que cambió.
    const closing = { ...second, estado: 'Completada', fecha_fin: '2026-10-13T11:45' };
    expect(changedFields(fieldsOf(closing), closing, baseline)).toEqual({ estado: 'Completada', fecha_fin: '2026-10-13T17:45:00.000Z', resultado_pruebas: 'Funciona correctamente', horometro: 4207 });
  });
});

describe('horómetro capturado en la orden', () => {
  const last = { valor: 21142, fecha: '2026-04-09T18:36:00.000Z' };
  const now = new Date('2026-05-14T18:49:00.000Z');
  it('avisa al capturar una lectura menor que la última: el servidor no dejaría completar la orden', () => {
    expect(meterWarning('8059', last, now)).toMatch(/^Es menor que la última lectura del equipo \(21,142 h el 09\/04\/2026\)\. Con este dato no se podrá completar la orden/);
  });
  it('avisa si supera lo que el equipo pudo trabajar desde la última lectura', () => {
    // 35 días: como máximo 24 h por día más un día de margen.
    expect(meterWarning('21234', last, now)).toBe('');
    expect(meterWarning(String(21142 + 24 * 36), last, now)).toBe('');
    expect(meterWarning('212340', last, now)).toMatch(/^Supera en 191,198 h la última lectura/);
  });
  it('no avisa sin lectura previa, sin dato o con un valor que no es número', () => {
    expect(meterWarning('100', undefined, now)).toBe('');
    expect(meterWarning('', last, now)).toBe('');
    expect(meterWarning('abc', last, now)).toBe('');
  });
  it('tras guardar, una orden que aún no empieza no muestra inicio', () => {
    expect(orderNotStarted('Programada')).toBe(true); expect(orderNotStarted('En espera')).toBe(false);
    expect(savedFormValues(record({ estado: 'Programada', fecha: '2026-10-13T16:30:00Z' }), {}).fecha).toBe('');
    expect(savedFormValues(record({ estado: 'En proceso', fecha: '2026-10-13T16:30:00Z' }), {}).fecha).toBe('2026-10-13T10:30');
  });
});
