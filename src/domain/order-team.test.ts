import { expect, it } from 'vitest';
import { LocalDataSource } from '../data/repository';
import { createSeed, demoUsers } from '../data/seed';
import { assignedTo } from './order-team';
import { technicianEquipmentIds } from './technician-work';
import { filterVisible } from './permissions';
const [admin, coordinator, ronny, raul, third, client] = demoUsers;
function fixture() { let data = JSON.stringify(createSeed()); return new LocalDataSource({ getItem: () => data, setItem: (_key, value) => { data = value; } }, { demoHistory: false }); }
const fields = { equipo_id: 'equipment-1', sintoma: 'Revisión extra en campo', estado: 'En proceso', tecnico_apoyo_1_id: raul.tecnico_id!, tecnico_apoyo_2_id: third.tecnico_id! };
it('crea una sola orden en campo para tres técnicos; conserva historial y restringe al cliente', async () => {
  const source = fixture(), order = await source.repository('OrdenServicio', ronny).create(fields);
  expect(order).toMatchObject({ tecnico_id: ronny.tecnico_id, visible_cliente: false, estado: 'En proceso' });
  expect(order.fecha).toBeTruthy(); expect(order.fecha_programada).toBeTruthy();
  for (const actor of [ronny, raul, third, admin, coordinator]) expect((await source.repository('OrdenServicio', actor).getById(order.id))?.id).toBe(order.id);
  expect(await source.repository('OrdenServicio', client).getById(order.id)).toBeUndefined();
  const changed = await source.repository('OrdenServicio', raul).update(order.id, { diagnostico: 'Diagnóstico de apoyo', expected_updated_at: order.fecha_actualizacion });
  expect(changed.actualizado_por).toBe(raul.id);
  await expect(source.repository('OrdenServicio', third).update(order.id, { diagnostico: 'Versión antigua', expected_updated_at: order.fecha_actualizacion })).rejects.toThrow();
  await expect(source.repository('OrdenServicio', raul).update(order.id, { tecnico_apoyo_2_id: '' })).rejects.toThrow('ejecución');
  await expect(source.repository('OrdenServicio', third).update(order.id, { visible_cliente: true })).rejects.toThrow('ejecución');
  const closed = await source.repository('OrdenServicio', third).update(order.id, { estado: 'Completada', trabajo_realizado: 'Ajuste', pruebas_realizadas: 'Elevación', resultado_pruebas: 'Correcto', expected_updated_at: changed.fecha_actualizacion });
  expect(closed.estado).toBe('Completada'); expect(closed.actualizado_por).toBe(third.id);
  expect(source.snapshot(admin).entities.OrdenServicio.filter(row => row.id === order.id)).toHaveLength(1);
  expect(assignedTo(closed, raul.tecnico_id)).toBe(true);
});
it('rechaza apoyos duplicados/inexistentes y conserva acceso histórico al retirar un equipo', async () => {
  const source = fixture();
  for (const support of [ronny.tecnico_id!, third.tecnico_id!, 'missing']) await expect(source.repository('OrdenServicio', ronny).create({ ...fields, tecnico_apoyo_1_id: support })).rejects.toThrow();
  const db = createSeed(); db.entities.Equipo[0].estado_administrativo = 'Baja';
  expect(technicianEquipmentIds(ronny, db.entities).has(db.entities.Equipo[0].id)).toBe(false);
  const order = await source.repository('OrdenServicio', ronny).create(fields);
  const outsider = { ...raul, tecnico_id: 'unassigned' };
  expect(filterVisible(outsider, 'OrdenServicio', [order])).toEqual([]);
  db.entities.OrdenServicio = [{ ...order, equipo_id: db.entities.Equipo[0].id }];
  expect(filterVisible(raul, 'Equipo', [db.entities.Equipo[0]], db.entities)).toHaveLength(1);
});
