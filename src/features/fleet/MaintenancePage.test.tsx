import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { EntityName, EntityRecord } from '../../domain/model';
import MaintenancePage from './MaintenancePage';

const fixture = vi.hoisted(() => ({ role: 'Administrador', rows: {} as Partial<Record<EntityName, EntityRecord[]>>, enabled: [] as boolean[] }));
vi.mock('../../app/state', () => ({
  useActor: () => ({ rol: fixture.role }),
  useRows: (entity: EntityName, _keep: boolean, _query: unknown, enabled: boolean) => {
    fixture.enabled.push(enabled);
    return { rows: fixture.rows[entity] || [], ready: true, error: '' };
  },
}));
const record = (values: Record<string, unknown>) => ({ codigo: '', creado_por: '', fecha_creacion: '', actualizado_por: '', fecha_actualizacion: '', ...values }) as EntityRecord;
const render = () => renderToStaticMarkup(<MemoryRouter><MaintenancePage /></MemoryRouter>);
beforeEach(() => {
  fixture.role = 'Administrador'; fixture.enabled = [];
  fixture.rows = {
    Equipo: [record({ id: 'e1', codigo: 'QA-001', cliente_id: 'c1' })],
    Cliente: [record({ id: 'c1', nombre: 'Cliente de prueba' })],
    PlanPM: ['Preventivo', 'Mayor'].map(type => record({ id: type, equipo_id: 'e1', schema_plan: 1, vigente: true, tipo_plan: type, criterio: 'Horas', intervalo: 250, base_origen: 'Base inicial', base_confirmada: true, base_fecha: '2026-01-01', base_horas: 0, base_calidad: 'Registrada' })),
    LecturaHorometro: [record({ id:'reading', equipo_id:'e1', fecha:'2026-01-02T12:00:00Z', valor:300 })],
    OrdenServicio: [record({ id:'visit', codigo:'OS-QA', equipo_id:'e1', schema_operacion:1, tipo:'Preventivo', estado:'Programada', fecha_programada:'2026-10-23' })],
  };
});
it('muestra el mayor pendiente junto al preventivo programado sin ocultar el vencimiento', () => {
  const html = render();
  expect(html).toContain('Mayor · Sin programar');
  expect(html).toContain('Preventivo · OS-QA');
  expect(html).toContain('Vencido');
  expect(html).toContain('Avance del ciclo: 100 %');
});
it('un borrador no muestra el equipo como programado', () => {
  fixture.rows.OrdenServicio![0].estado = 'Borrador';
  const html = render();
  expect(html).toContain('Preventivo · Sin programar');
  expect(html).not.toContain('OS-QA');
});
it('no consulta ni muestra datos administrativos para otros roles', () => {
  for (const role of ['Coordinador', 'Técnico', 'Cliente']) {
    fixture.role = role; fixture.enabled = [];
    const html = render();
    expect(html).not.toContain('QA-001');
    expect(html).toContain('Abrir calendario');
    expect(fixture.enabled.every(value => !value)).toBe(true);
  }
});
