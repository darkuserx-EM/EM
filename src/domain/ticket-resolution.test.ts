import { describe, expect, it } from 'vitest';
import { LocalDataSource } from '../data/repository';
import { createSeed, demoUsers } from '../data/seed';
import { ticketsResolvedByOrder } from './operations';

const [admin, coordinator, technician, otherTechnician, , client] = demoUsers;
const ticketInput = { equipo_id: 'equipment-1', titulo: 'Frenos', descripcion: 'Revisar frenado', prioridad: 'Alta' };
const orderInput = { equipo_id: 'equipment-1', sintoma: 'Revisar frenos', estado: 'Programada', fecha_programada: '2026-10-12', tecnico_id: 'tech-1', visible_cliente: false };
const closure = { estado: 'Completada', diagnostico: 'Holgura', trabajo_realizado: 'Ajuste', pruebas_realizadas: 'Frenado sin carga', resultado_pruebas: 'Satisfactorio' };
function fixture() {
  let saved = JSON.stringify(createSeed()); let fail = false;
  return {
    source: new LocalDataSource({ getItem: () => saved, setItem: (_key, value) => { if (fail) throw Error('Synthetic full disk'); saved = value; } }, { demoHistory: false }),
    failSave: () => { fail = true; },
  };
}

describe('resolución de solicitudes al completar sus órdenes', () => {
  it.each(['Nuevo', 'En revisión', 'Programado'])('resuelve %s con actor e historial, sin liberar equipo ni publicar el reporte privado', async estado => {
    const { source } = fixture();
    const ticket = await source.repository('Ticket', coordinator).create({ ...ticketInput, estado, ...(estado === 'Programado' ? { responsable_id: 'tech-1', fecha_programada: '2026-10-11' } : {}) });
    const order = await source.repository('OrdenServicio', coordinator).create({ ...orderInput, ticket_id: ticket.id });
    const repo = source.repository('OrdenServicio', technician);
    await repo.update(order.id, { estado: 'En proceso' }); const before = source.snapshot(admin);
    await repo.update(order.id, closure); const after = source.snapshot(admin);
    const resolved = after.entities.Ticket.find(row => row.id === ticket.id)!;
    expect(resolved).toEqual({ ...ticket, estado: 'Resuelto', actualizado_por: technician.id, fecha_actualizacion: resolved.fecha_actualizacion });
    expect(resolved.fecha_actualizacion > ticket.fecha_actualizacion).toBe(true);
    expect(after.entities.Equipo).toEqual(before.entities.Equipo); expect(after.entities.Hallazgo).toEqual(before.entities.Hallazgo);
    expect(after.entities.LecturaHorometro).toEqual(before.entities.LecturaHorometro);
    expect(after.entities.Bitacora.find(row => row.accion === 'Resolución por orden')).toMatchObject({ ticket_id: ticket.id, orden_id: order.id, creado_por: technician.id, estado_anterior: estado, estado_nuevo: 'Resuelto' });
    expect((await source.repository('Ticket', client).getById(ticket.id))?.estado).toBe('Resuelto');
    expect(await source.repository('OrdenServicio', client).getById(order.id)).toBeUndefined();
    await expect(repo.update(order.id, closure)).rejects.toThrow('cerrada'); expect(source.snapshot(admin)).toEqual(after);
    await source.repository('OrdenServicio', coordinator).update(order.id, { visible_cliente: true });
    expect(source.snapshot(admin).entities.Bitacora.filter(row => row.accion === 'Resolución por orden')).toHaveLength(1);
  });
  it('espera todas las órdenes, incluso un borrador, y resuelve solo en el último cierre', async () => {
    const { source } = fixture(); const tickets = source.repository('Ticket', coordinator); const orders = source.repository('OrdenServicio', coordinator);
    const ticket = await tickets.create(ticketInput);
    const first = await orders.create({ ...orderInput, ticket_id: ticket.id });
    const second = await orders.create({ ...orderInput, ticket_id: ticket.id, estado: 'Borrador' });
    await orders.update(first.id, { estado: 'En proceso' }); await orders.update(first.id, closure);
    expect((await tickets.getById(ticket.id))?.estado).toBe('Nuevo');
    await orders.update(second.id, { estado: 'Programada' }); await orders.update(second.id, { estado: 'En proceso' }); await orders.update(second.id, closure);
    expect((await tickets.getById(ticket.id))?.estado).toBe('Resuelto');
    expect(source.snapshot(admin).entities.Bitacora.filter(row => row.accion === 'Resolución por orden')).toHaveLength(1);
  });
  it('conserva revisión manual si existe una orden cancelada', async () => {
    const { source } = fixture(); const orders = source.repository('OrdenServicio', coordinator); const tickets = source.repository('Ticket', coordinator);
    const ticket = await tickets.create(ticketInput);
    const first = await orders.create({ ...orderInput, ticket_id: ticket.id }); const second = await orders.create({ ...orderInput, ticket_id: ticket.id });
    await orders.update(first.id, { estado: 'Cancelada' }); await orders.update(second.id, { estado: 'En proceso' }); await orders.update(second.id, closure);
    expect((await tickets.getById(ticket.id))?.estado).toBe('Nuevo');
    await tickets.update(ticket.id, { estado: 'Resuelto' }); expect((await tickets.getById(ticket.id))?.estado).toBe('Resuelto');
  });
  it.each(['Resuelto', 'Cancelado'])('no reescribe una solicitud ya %s', async estado => {
    const { source } = fixture(); const orders = source.repository('OrdenServicio', coordinator); const tickets = source.repository('Ticket', coordinator);
    const ticket = await tickets.create(ticketInput); const order = await orders.create({ ...orderInput, ticket_id: ticket.id });
    await tickets.update(ticket.id, { estado }); const original = source.snapshot(admin).entities.Ticket;
    await orders.update(order.id, { estado: 'En proceso' }); await orders.update(order.id, closure);
    expect(source.snapshot(admin).entities.Ticket).toEqual(original);
    expect(source.snapshot(admin).entities.Bitacora.some(row => row.accion === 'Resolución por orden')).toBe(false);
  });
  it('respeta el enlace inverso sin inventar enlaces por equipo', async () => {
    const { source } = fixture(); const tickets = source.repository('Ticket', coordinator); const orders = source.repository('OrdenServicio', coordinator);
    const unrelated = await tickets.create(ticketInput); const order = await orders.create(orderInput);
    const ticket = await tickets.create({ ...ticketInput, orden_id: order.id });
    await orders.update(order.id, { estado: 'En proceso' }); await orders.update(order.id, closure);
    expect((await tickets.getById(ticket.id))?.estado).toBe('Resuelto'); expect((await tickets.getById(unrelated.id))?.estado).toBe('Nuevo');
  });
  it('no resuelve vínculos ambiguos ni históricos', async () => {
    const { source } = fixture(); const tickets = source.repository('Ticket', coordinator); const orders = source.repository('OrdenServicio', coordinator);
    const ticket = await tickets.create(ticketInput); const order = await orders.create({ ...orderInput, ticket_id: ticket.id });
    const other = await tickets.create({ ...ticketInput, orden_id: order.id }); const entities = source.snapshot(admin).entities;
    const completed = { ...order, estado: 'Completada' }; entities.OrdenServicio = [completed];
    expect(ticketsResolvedByOrder(completed, entities).map(row => row.id)).not.toContain(other.id);
    entities.Ticket.find(row => row.id === ticket.id)!.importado = true;
    expect(ticketsResolvedByOrder(completed, entities)).toEqual([]);
    entities.Ticket.find(row => row.id === ticket.id)!.importado = false;
    entities.OrdenServicio.push({ ...completed, id: 'legacy', schema_operacion: 0 });
    expect(ticketsResolvedByOrder(completed, entities)).toEqual([]);
  });
  it('rechazos de permisos, lectura, versión y persistencia conservan toda la operación', async () => {
    const { source, failSave } = fixture(); const ticket = await source.repository('Ticket', coordinator).create(ticketInput);
    const order = await source.repository('OrdenServicio', coordinator).create({ ...orderInput, ticket_id: ticket.id });
    const repo = source.repository('OrdenServicio', technician); await repo.update(order.id, { estado: 'En proceso' });
    const before = source.snapshot(admin);
    await expect(source.repository('OrdenServicio', otherTechnician).update(order.id, closure)).rejects.toThrow('permiso');
    await expect(source.repository('Ticket', technician).update(ticket.id, { estado: 'Resuelto' })).rejects.toThrow('permiso');
    await expect(repo.update(order.id, { ...closure, horometro: 10 })).rejects.toThrow('disminuye');
    await expect(repo.update(order.id, { ...closure, expected_updated_at: order.fecha_actualizacion })).rejects.toThrow('cambió');
    expect(source.snapshot(admin)).toEqual(before);
    failSave(); await expect(repo.update(order.id, closure)).rejects.toThrow('guardar'); expect(source.snapshot(admin)).toEqual(before);
  });
});
