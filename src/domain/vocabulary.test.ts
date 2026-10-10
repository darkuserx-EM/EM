import { describe, expect, it } from 'vitest';
import { isCompletedService, serviceKind } from './vocabulary';
import { completedService } from './equipment-findings';
import { orderClosed } from './dashboard';
import { planService } from './maintenance-plan';
import type { EntityRecord } from './model';

const row = (fields: Record<string, unknown>) => ({ id: 'x', codigo: 'X', creado_por: 't', actualizado_por: 't', fecha_creacion: '', fecha_actualizacion: '', ...fields }) as EntityRecord;

describe('vocabulario común de servicios', () => {
  it('clasifica los tipos de AppSheet y del portal sin importar mayúsculas, tildes ni espacios', () => {
    expect(['Preventivo', 'Mantenimiento Preventivo', 'mantenimiento  preventivo '].map(tipo => serviceKind({ tipo }))).toEqual(['Preventivo', 'Preventivo', 'Preventivo']);
    expect(['Mantenimiento Mayor', 'Mantenimiento mayor', 'MAYOR'].map(tipo => serviceKind({ tipo }))).toEqual(['Mayor', 'Mayor', 'Mayor']);
    expect(['Correctivo', 'Emergencia', 'Inspección', 'Inspeccion'].map(tipo => serviceKind({ tipo }))).toEqual(['Correctivo', 'Emergencia', 'Inspección', 'Inspección']);
    expect(['', 'Instalación', undefined].map(tipo => serviceKind({ tipo }))).toEqual(['Otro', 'Otro', 'Otro']);
  });
  it('reconoce como completados los estados de ambos orígenes y nada más', () => {
    for (const estado of ['Completada', 'Completado', 'Completado con observaciones', 'Cerrada', 'Cerrado', 'Finalizada', 'Finalizado', ' completada ']) expect(isCompletedService({ estado })).toBe(true);
    for (const estado of ['Pendiente', 'Pendiente de firma', 'Borrador', 'Programada', 'En proceso', 'En espera', 'Cancelada', '', undefined]) expect(isCompletedService({ estado })).toBe(false);
  });
  it('las reglas existentes usan la misma definición', () => {
    for (const estado of ['Completada', 'Completado', 'Cerrado', 'Pendiente', 'Cancelada']) {
      const record = row({ estado, tipo: 'Mantenimiento mayor', equipo_id: 'e' });
      expect(completedService(record)).toBe(isCompletedService(record));
      expect(orderClosed(record)).toBe(isCompletedService(record));
      expect(planService(record, 'e', 'Mayor')).toBe(isCompletedService(record));
    }
  });
});
