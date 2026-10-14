import { describe, expect, it } from 'vitest';
import { LocalDataSource } from '../data/repository';
import { createSeed, demoUsers } from '../data/seed';
import { canCreateTicketOrder, canReopenTicket, technicianEquipmentIds } from './technician-work';
import { IncrementalValidation } from './incremental-validation';
import { validateDatabase } from './validation';
const [admin, coordinator, tech, otherTech, , client] = demoUsers;
function fixture() { let data = JSON.stringify(createSeed()); return new LocalDataSource({ getItem: () => data, setItem: (_key, value) => { data = value; } }, { demoHistory: false }); }
const request = { equipo_id: 'equipment-1', titulo: 'Cadena floja', descripcion: 'Verificar tensión', estado: 'Programado', responsable_id: 'tech-1', fecha_programada: '2026-10-14' };
const order = { equipo_id: 'equipment-1', estado: 'Programada', fecha_programada: '2026-10-14', sintoma: 'Verificar tensión' };

describe('flujo de trabajo del técnico', () => {
  it('crea su orden desde la solicitud, conserva el vínculo y evita un segundo alta', async () => {
    const source = fixture(), ticket = await source.repository('Ticket', coordinator).create(request);
    const original = structuredClone(ticket); const repo = source.repository('OrdenServicio', tech);
    const input = { ...order, ticket_id: ticket.id, desde_solicitud: true, solicitud_id: crypto.randomUUID() };
    const saved = await repo.create(input);
    expect(saved.tecnico_id).toBe(tech.tecnico_id); expect(saved.visible_cliente).toBe(false); expect(saved.ticket_id).toBe(ticket.id);
    expect((await repo.create(input)).id).toBe(saved.id);
    await expect(repo.create({ ...input, solicitud_id: crypto.randomUUID() })).rejects.toThrow('ya tiene orden');
    await expect(source.repository('OrdenServicio', coordinator).create({ ...input, tecnico_id: tech.tecnico_id!, solicitud_id: crypto.randomUUID() })).rejects.toThrow('ya tiene una orden');
    expect(source.snapshot(admin).entities.Ticket.find(row => row.id === ticket.id)).toMatchObject(original);
    expect(await source.repository('OrdenServicio', client).getById(saved.id)).toBeUndefined();
  });
  it('rechaza equipos y solicitudes ajenos, reasignación, publicación y cierre en el alta', async () => {
    const source = fixture(), ticket = await source.repository('Ticket', coordinator).create(request);
    const repo = source.repository('OrdenServicio', tech);
    await expect(source.repository('OrdenServicio', otherTech).create({ ...order, ticket_id: ticket.id })).rejects.toThrow('permiso');
    expect((await repo.create({ ...order, equipo_id: 'equipment-7' })).equipo_id).toBe('equipment-7');
    await expect(repo.create({ ...order, tecnico_id: otherTech.tecnico_id! })).rejects.toThrow('permiso');
    await expect(repo.create({ ...order, visible_cliente: true })).rejects.toThrow('permiso');
    await expect(repo.create({ ...order, estado: 'Completada' })).rejects.toThrow('borrador, programada o en proceso');
    await expect(source.repository('OrdenServicio', client).create(order)).rejects.toThrow('permiso');
    await expect(source.repository('OrdenServicio', { ...tech, tecnico_id: undefined }).create(order)).rejects.toThrow('permiso');
  });
  it('un reintento después de reasignar no devuelve la orden al técnico anterior', async () => {
    const source = fixture(), ticket = await source.repository('Ticket', coordinator).create(request);
    const input = { ...order, ticket_id: ticket.id, solicitud_id: crypto.randomUUID() };
    const saved = await source.repository('OrdenServicio', tech).create(input);
    await source.repository('OrdenServicio', coordinator).update(saved.id, { tecnico_id: otherTech.tecnico_id! });
    await expect(source.repository('OrdenServicio', tech).create(input)).rejects.toThrow('ya no está asignada');
  });
  it('crea sin habilitación; conserva metadatos antiguos y permisos de ejecución', async () => {
    const source = fixture(), technician = source.snapshot(admin).entities.Tecnico.find(row => row.id === tech.tecnico_id)!;
    expect((await source.repository('OrdenServicio', tech).create({ ...order, estado: 'En proceso' })).estado).toBe('En proceso');
    await expect(source.repository('Tecnico', tech).update(technician.id, { equipos_habilitados: '["equipment-1"]' })).rejects.toThrow('administración');
    const granted = await source.repository('Tecnico', admin).update(technician.id, { equipos_habilitados: '["equipment-1"]', expected_updated_at: technician.fecha_actualizacion });
    expect(technicianEquipmentIds(tech, source.snapshot(admin).entities).has('equipment-1')).toBe(true);
    const repo = source.repository('OrdenServicio', tech), draft = await repo.create({ ...order, estado: 'Borrador' });
    const scheduled = await repo.update(draft.id, { estado: 'Programada', fecha_programada: '2026-10-15', expected_updated_at: draft.fecha_actualizacion });
    await expect(repo.update(draft.id, { fecha_programada: '2026-10-16' })).rejects.toThrow('ejecución');
    await expect(repo.update(draft.id, { tecnico_id: otherTech.tecnico_id! })).rejects.toThrow('ejecución');
    expect(scheduled.tecnico_id).toBe(tech.tecnico_id);
    await source.repository('Tecnico', admin).update(technician.id, { equipos_habilitados: '[]', expected_updated_at: granted.fecha_actualizacion });
    expect((await repo.getById(draft.id))?.id).toBe(draft.id);
  });
  it.each([admin, coordinator, tech])('$rol reabre una resuelta sin orden con motivo, conserva datos y crea después la orden', async actor => {
    const source = fixture(), repo = source.repository('Ticket', coordinator), ticket = await repo.create(request);
    const closed = await repo.update(ticket.id, { estado: 'Resuelto' });
    expect(canReopenTicket(actor, closed)).toBe(true);
    await expect(source.repository('Ticket', actor).update(ticket.id, { estado: 'En revisión', reapertura_motivo: '' })).rejects.toThrow('motivo');
    const reopened = await source.repository('Ticket', actor).update(ticket.id, { estado: 'En revisión', reapertura_motivo: 'Se cerró por error antes de generar la orden.', expected_updated_at: closed.fecha_actualizacion });
    expect(reopened).toMatchObject({ id: ticket.id, codigo: ticket.codigo, descripcion: ticket.descripcion, fecha_creacion: ticket.fecha_creacion, creado_por: ticket.creado_por });
    const audit = source.snapshot(admin).entities.Bitacora.find(row => row.accion === 'Reapertura sin orden');
    expect(audit).toMatchObject({ ticket_id: ticket.id, creado_por: actor.id, estado_anterior: 'Resuelto', estado_nuevo: 'En revisión', motivo: reopened.reapertura_motivo });
    expect(canCreateTicketOrder(actor, reopened)).toBe(true);
    const created = await source.repository('OrdenServicio', tech).create({ ...order, ticket_id: ticket.id });
    expect(created.ticket_id).toBe(ticket.id);
  });
  it('bloquea reapertura ajena, cancelada, histórica, con orden y ediciones mezcladas', async () => {
    const source = fixture(), repo = source.repository('Ticket', coordinator), ticket = await repo.create(request);
    await repo.update(ticket.id, { estado: 'Resuelto' }); const fields = { estado: 'En revisión', reapertura_motivo: 'Cierre accidental sin la orden.' };
    await expect(source.repository('Ticket', otherTech).update(ticket.id, fields)).rejects.toThrow('permiso');
    await expect(source.repository('Ticket', client).update(ticket.id, fields)).rejects.toThrow('permiso');
    await expect(repo.update(ticket.id, { ...fields, titulo: 'Alterado' })).rejects.toThrow('Reabre primero');
    await expect(repo.update(ticket.id, { titulo: 'Alterado' })).rejects.toThrow('cerrada');
    expect(canReopenTicket(admin, { ...ticket, estado: 'Cancelado' })).toBe(false);
    expect(canReopenTicket(admin, { ...ticket, estado: 'Resuelto', importado: true })).toBe(false);
    await repo.update(ticket.id, fields); const linked = await source.repository('OrdenServicio', tech).create({ ...order, ticket_id: ticket.id });
    await repo.update(ticket.id, { estado: 'Resuelto' });
    await expect(repo.update(ticket.id, fields)).rejects.toThrow('permiso');
    expect(canReopenTicket(admin, { ...ticket, estado: 'Resuelto' }, [linked])).toBe(false);
  });
  it('valida referencias de habilitación y mantiene consistente la validación incremental', () => {
    const db = createSeed(), index = IncrementalValidation.create(db), next = structuredClone(db);
    next.entities.Tecnico[0].equipos_habilitados = '["equipment-1"]'; next.revision++;
    expect(() => validateDatabase(next)).not.toThrow(); expect(() => index.check(next)).not.toThrow();
    next.entities.Tecnico[0].equipos_habilitados = '["equipo-inexistente"]';
    expect(() => validateDatabase(next)).toThrow('habilitado'); expect(() => index.check(next)).toThrow('habilitado');
  });
});
