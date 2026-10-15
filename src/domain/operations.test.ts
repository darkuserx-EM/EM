import { describe, expect, it } from 'vitest';
import { LocalDataSource } from '../data/repository';
import { createSeed, demoUsers } from '../data/seed';
import { filterVisible } from './permissions';
import type { EntityRecord, Scalar } from './model';

const [admin, coordinator, technician, otherTechnician, , client] = demoUsers;
function fixture() {
  let saved = JSON.stringify(createSeed());
  return new LocalDataSource({ getItem: () => saved, setItem: (_key, value) => { saved = value; } }, { demoHistory: false });
}
const ticket = { equipo_id: 'equipment-1', cliente_id: 'client-1', titulo: 'Revisión de frenos', descripcion: 'El recorrido aumentó.', prioridad: 'Alta' };
const order = { equipo_id: 'equipment-1', cliente_id: 'client-1', sintoma: 'Inspeccionar frenos', tipo: 'Correctivo', prioridad: 'Alta', estado: 'Programada', fecha_programada: '2026-10-10', tecnico_id: 'tech-1', visible_cliente: true };
describe('operación con permisos y trazabilidad', () => {
  it.each([admin, coordinator, technician])('$rol inicia un borrador y guarda avances parciales sin inventar lecturas ni cerrar la solicitud', async actor => {
    const source = fixture(); const request = await source.repository('Ticket', coordinator).create({ ...ticket, responsable_id: technician.tecnico_id! });
    const draft = await source.repository('OrdenServicio', coordinator).create({ ...order, ticket_id: request.id, estado: 'Borrador', fecha_programada: '', visible_cliente: false });
    const before = source.snapshot(admin); const repo = source.repository('OrdenServicio', actor);
    const started = await repo.update(draft.id, { estado: 'En proceso', fecha_programada: '2026-10-14', expected_updated_at: draft.fecha_actualizacion });
    expect(started.fecha).toBeTruthy(); expect(started.tecnico_id).toBe(technician.tecnico_id);
    const partial = await repo.update(started.id, { diagnostico: 'En revisión, pendiente de pruebas', expected_updated_at: started.fecha_actualizacion });
    expect(partial).toMatchObject({ id: draft.id, estado: 'En proceso', fecha: started.fecha, visible_cliente: false });
    expect(partial.resultado_pruebas || '').toBe('');
    const after = source.snapshot(admin);
    expect(after.entities.LecturaHorometro).toEqual(before.entities.LecturaHorometro);
    expect(after.entities.Ticket).toEqual(before.entities.Ticket);
    expect(after.entities.OrdenServicio.filter(row => row.ticket_id === request.id)).toHaveLength(1);
    await expect(source.repository('OrdenServicio', client).update(draft.id, { estado: 'En proceso' })).rejects.toThrow('permiso');
    await expect(source.repository('OrdenServicio', otherTechnician).update(draft.id, { estado: 'En proceso' })).rejects.toThrow('permiso');
  });
  it('el técnico consulta sus solicitudes y equipo antes de tener orden, sin poder editarlas', async () => {
    const source = fixture();
    const own = await source.repository('Ticket', coordinator).create({ ...ticket, responsable_id: technician.tecnico_id! });
    await source.repository('Ticket', coordinator).create({ ...ticket, responsable_id: otherTechnician.tecnico_id! });
    const visible = await source.repository('Ticket', technician).getAll();
    expect(visible.map(row => row.id)).toEqual([own.id]);
    expect(visible[0].tiene_orden).toBe(false);
    expect((await source.repository('Equipo', technician).getAll()).some(row => row.id === own.equipo_id)).toBe(true);
    expect((await source.repository('Cliente', technician).getAll()).some(row => row.id === own.cliente_id)).toBe(true);
    await expect(source.repository('Ticket', technician).update(own.id, { estado: 'Resuelto' })).rejects.toThrow('permiso');
    expect(await source.repository('Ticket', { ...technician, tecnico_id: undefined }).getAll()).toEqual([]);
    const linked = await source.repository('OrdenServicio', coordinator).create({ ...order, ticket_id: own.id, tecnico_id: otherTechnician.tecnico_id!, visible_cliente: false });
    const requests = await source.repository('Ticket', client).getAll();
    expect(requests.find(row => row.id === own.id)?.tiene_orden).toBe(true);
    expect(await source.repository('OrdenServicio', client).getById(linked.id)).toBeUndefined();
  });
  it('cliente crea solamente solicitudes propias y no controla programación', async () => {
    const source = fixture(); const repo = source.repository('Ticket', client);
    const row = await repo.create(ticket);
    expect(row.estado).toBe('Nuevo'); expect(row.creado_por).toBe(client.id);
    await expect(repo.create({ ...ticket, equipo_id: 'equipment-2', cliente_id: '' })).rejects.toThrow('permiso');
    await expect(repo.create({ ...ticket, responsable_id: 'tech-1' })).rejects.toThrow('coordinación');
    await expect(repo.update(row.id, { estado: 'Resuelto' })).rejects.toThrow('permiso');
    await expect(repo.remove(row.id)).rejects.toThrow('Conserva');
  });
  it('altas son idempotentes por actor y solicitud, también después de recargar', async () => {
    const source = fixture(); const repo = source.repository('Ticket', client);
    const input = { ...ticket, solicitud_id: 'ticket-request-123' };
    const row = await repo.create(input); const revision = source.getRevision();
    expect((await repo.create(input)).id).toBe(row.id); expect(source.getRevision()).toBe(revision);
    await expect(repo.create({ ...input, descripcion: 'Otro problema' })).rejects.toThrow('otra información');
    expect(source.snapshot(admin).entities.Ticket).toHaveLength(1);
  });
  it('programar exige responsable y fecha y valida cliente, sede y ticket', async () => {
    const source = fixture(); const repo = source.repository('OrdenServicio', coordinator);
    await expect(repo.create({ ...order, fecha_programada: '' })).rejects.toThrow('fecha y técnico');
    await expect(repo.create({ ...order, tecnico_id: 'inexistente' })).rejects.toThrow('técnico');
    await expect(repo.create({ ...order, cliente_id: 'client-2' })).rejects.toThrow('cliente');
    await expect(repo.create({ ...order, sede_id: 'ajena' })).rejects.toThrow('sede');
    await expect(repo.create({ ...order, ticket_id: 'ajeno' })).rejects.toThrow('ticket');
    await expect(repo.create({ ...order, fecha_programada: '2026-02-30' })).rejects.toThrow('Fecha');
  });
  it('técnico sólo ejecuta su orden; no cambia propiedad, publicación ni agenda', async () => {
    const source = fixture(); const row = await source.repository('OrdenServicio', coordinator).create(order);
    await expect(source.repository('OrdenServicio', otherTechnician).update(row.id, { diagnostico: 'Interferencia' })).rejects.toThrow('permiso');
    const repo = source.repository('OrdenServicio', technician);
    const forbidden: Record<string, Scalar>[] = [{ tecnico_id: 'tech-2' }, { fecha_programada: '2026-10-11' }, { visible_cliente: false }, { prioridad: 'Baja' }];
    for (const fields of forbidden) await expect(repo.update(row.id, fields)).rejects.toThrow('ejecución');
    await expect(repo.update(row.id, { estado: 'Cancelada' })).rejects.toThrow('coordinación');
    expect((await repo.update(row.id, { estado: 'En proceso' })).actualizado_por).toBe(technician.id);
  });
  it('cerrar exige evidencias, conserva estado del equipo y hallazgos y crea lectura atómica', async () => {
    const source = fixture(); const row = await source.repository('OrdenServicio', coordinator).create(order);
    const repo = source.repository('OrdenServicio', technician); await repo.update(row.id, { estado: 'En proceso' });
    const before = source.snapshot(admin);
    await expect(repo.update(row.id, { estado: 'Completada' })).rejects.toThrow('diagnóstico');
    const closure = { estado: 'Completada', diagnostico: 'Cable con holgura', trabajo_realizado: 'Ajuste del freno', pruebas_realizadas: 'Retención en rampa', resultado_pruebas: 'Satisfactoria', horometro: 900 };
    const complete = await repo.update(row.id, closure);
    const after = source.snapshot(admin);
    expect(after.entities.Equipo).toEqual(before.entities.Equipo); expect(after.entities.Hallazgo).toEqual(before.entities.Hallazgo);
    expect(after.entities.LecturaHorometro.at(-1)).toMatchObject({ orden_id: complete.id, valor: 900, creado_por: technician.id, es_estimado: false });
    await expect(repo.update(row.id, { diagnostico: 'Reescribir' })).rejects.toThrow('cerrada');
    await source.repository('OrdenServicio', coordinator).update(row.id, { visible_cliente: false, expected_updated_at: complete.fecha_actualizacion });
    expect(await source.repository('OrdenServicio', client).getAll()).toEqual([]);
    expect(source.snapshot(admin).entities.OrdenServicio.at(-1)?.diagnostico).toBe(closure.diagnostico);
  });
  it('lectura regresiva al cerrar revierte toda la operación y conserva originales', async () => {
    const source = fixture(); const row = await source.repository('OrdenServicio', coordinator).create(order);
    const repo = source.repository('OrdenServicio', technician); await repo.update(row.id, { estado: 'En proceso' });
    const before = source.snapshot(admin);
    await expect(repo.update(row.id, { estado: 'Completada', diagnostico: 'Revisado', trabajo_realizado: 'Ajuste', pruebas_realizadas: 'Freno', resultado_pruebas: 'OK', horometro: 10 })).rejects.toThrow('disminuye');
    expect(source.snapshot(admin)).toEqual(before);
  });
  it('permite ejecutar y cerrar sin horómetro opcional sin inventar una lectura cero', async () => {
    const source = fixture(); const row = await source.repository('OrdenServicio', coordinator).create({ ...order, horometro: null, odometro_millas: null });
    const repo = source.repository('OrdenServicio', technician); await repo.update(row.id, { estado: 'En proceso', horometro: null });
    const before = source.snapshot(admin);
    const completed = await repo.update(row.id, { estado: 'Completada', horometro: null, diagnostico: 'Revisado', trabajo_realizado: 'Ajuste', pruebas_realizadas: 'Freno', resultado_pruebas: 'OK' });
    expect(completed.horometro).toBeNull(); expect(source.snapshot(admin).entities.LecturaHorometro).toEqual(before.entities.LecturaHorometro);
  });
  it('conserva una lectura capturada cuando se intenta vaciar el campo', async () => {
    const source = fixture(); const row = await source.repository('OrdenServicio', coordinator).create({ ...order, horometro: 900 });
    await expect(source.repository('OrdenServicio', technician).update(row.id, { horometro: null })).rejects.toThrow('Conserva la lectura');
    expect(source.snapshot(admin).entities.OrdenServicio.at(-1)?.horometro).toBe(900);
  });
  it('cliente ve únicamente informes publicados y el técnico sólo sus recursos', async () => {
    const source = fixture(); const row = await source.repository('OrdenServicio', coordinator).create({ ...order, visible_cliente: false });
    expect(await source.repository('OrdenServicio', client).getAll()).toEqual([]);
    await source.repository('OrdenServicio', coordinator).update(row.id, { visible_cliente: true });
    const entities = source.snapshot(admin).entities;
    const secret = { ...entities.OrdenServicio.at(-1)!, costo_repuestos: 200, notas_internas: 'No compartir', adjuntos_referencias: 'secret.jpg', inspector: 'private@example.com' };
    const visible = filterVisible(client, 'OrdenServicio', [secret], entities)[0];
    expect(visible.id).toBe(row.id);
    for (const key of ['costo_repuestos', 'notas_internas', 'adjuntos_referencias', 'inspector', 'solicitud_datos']) expect(visible).not.toHaveProperty(key);
    const technicianEquipment = await source.repository('Equipo', technician).getAll();
    expect(technicianEquipment.every(item => !item.fuera_de_flota || entities.OrdenServicio.some(os => os.equipo_id === item.id && os.tecnico_id === technician.tecnico_id))).toBe(true);
    expect(filterVisible({ id: 'missing', nombre: 'Sin asociación', rol: 'Técnico' }, 'Equipo', entities.Equipo, entities)).toEqual([]);
  });
  it('no reescribe los reportes importados o legados al editar', async () => {
    const source = fixture(); const legacy = source.snapshot(admin).entities.OrdenServicio[0] as EntityRecord;
    await expect(source.repository('OrdenServicio', admin).update(legacy.id, { estado: 'Programada' })).rejects.toThrow('histórico');
    expect(source.snapshot(admin).entities.OrdenServicio[0]).toEqual(legacy);
    await expect(source.repository('OrdenServicio', coordinator).update(legacy.id, { visible_cliente: true })).rejects.toThrow('histórico');
    await source.repository('OrdenServicio', admin).update(legacy.id, { visible_cliente: true });
    const published = source.snapshot(admin).entities.OrdenServicio[0];
    expect(published).not.toHaveProperty('schema_operacion');
    expect(published.trabajo).toBe(legacy.trabajo); expect(published.estado).toBe(legacy.estado);
    expect(await source.repository('OrdenServicio', client).getAll()).toHaveLength(1);
  });
});
