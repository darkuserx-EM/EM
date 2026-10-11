import { it, expect } from 'vitest';
import { dashboardOrders } from '../../domain/dashboard';
import { createSeed, demoUsers } from '../../data/seed';
import { filterVisible } from '../../domain/permissions';
import { filterOperations, operationFiltersFromParams, orderListLink } from './operations-ui';

it('el detalle conserva los filtros y las mismas órdenes del indicador para cada perfil', () => {
  const db = createSeed(); const base = db.entities.Equipo[0];
  db.entities.OrdenServicio = [
    { ...base, id: 'one', equipo_id: 'equipment-1', cliente_id: 'client-1', tecnico_id: 'tech-1', fecha: '2026-08-31T23:00:00-06:00', fecha_programada: '2026-09-02', schema_operacion: 1, visible_cliente: true },
    { ...base, id: 'two', equipo_id: 'equipment-1', cliente_id: 'client-1', tecnico_id: 'tech-1', fecha: '2026-09-02T00:00:00-06:00', schema_operacion: 1, visible_cliente: true },
    { ...base, id: 'other', equipo_id: 'equipment-2', cliente_id: 'client-2', tecnico_id: 'tech-2', fecha: '2026-08-01T12:00:00Z', schema_operacion: 1, visible_cliente: true },
  ];
  const filter = { from: '2026-08-01', to: '2026-08-31', client: 'client-1', equipment: 'equipment-1', origin: 'Actual' };
  const url = new URL(orderListLink({ ...filter, origin: 'actual' }, 'one'), 'https://test.invalid');
  const parsed = operationFiltersFromParams(url.searchParams);
  expect(parsed).toMatchObject({ ...filter, origin: 'actual' });
  for (const actor of [demoUsers[0], demoUsers[2], demoUsers[5]]) {
    const visible = filterVisible(actor, 'OrdenServicio', db.entities.OrdenServicio, db.entities);
    expect(filterOperations(visible, parsed, db.entities.Equipo, db.entities.Cliente)).toEqual(dashboardOrders(visible, filter));
    expect(filterOperations(visible, parsed, db.entities.Equipo, db.entities.Cliente).map(row => row.id)).toEqual(['one']);
  }
});
