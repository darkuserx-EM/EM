import { describe, expect, it } from 'vitest';
import { LocalDataSource } from '../../data/repository';
import { createSeed, demoUsers } from '../../data/seed';
import { addSymptom, orderEntryTimes, symptomOptions } from './order-entry';

const [admin, coordinator, technician, , , client] = demoUsers;
const ronny = { ...technician, nombre: 'Ronny' };
const raul = { ...coordinator, nombre: 'Raúl', tecnico_id: 'tech-2' };
function fixture() { let data = JSON.stringify(createSeed()); return new LocalDataSource({ getItem: () => data, setItem: (_key, value) => { data = value; } }, { demoHistory: false }); }

describe('captura simplificada de órdenes', () => {
  it('sugiere día y horas de Guatemala, incluso al cambiar el día UTC', () => {
    expect(orderEntryTimes(undefined, undefined, new Date('2026-10-17T03:42:55Z'))).toEqual({ fecha_programada: '2026-10-16', hora_programada: '21:42', fecha: '2026-10-16T21:42' });
  });
  it('conserva la fecha de la solicitud y no rellena ni cambia una orden guardada', () => {
    expect(orderEntryTimes(undefined, { fecha_programada: '2026-11-01' }).fecha_programada).toBe('2026-11-01');
    expect(orderEntryTimes({})).toEqual({ fecha_programada: '', hora_programada: '', fecha: '' });
    expect(orderEntryTimes({ fecha_programada: '2026-10-10', hora_programada: '08:30', fecha: '2026-10-10T15:00:00Z' })).toEqual({ fecha_programada: '2026-10-10', hora_programada: '08:30', fecha: '2026-10-10T09:00' });
  });
  it('agrega síntomas sin borrar el relato, duplicar líneas ni truncar el texto', () => {
    expect(addSymptom('', 'Ruido')).toBe('Ruido');
    expect(addSymptom('No eleva al cargar', 'Ruido')).toBe('No eleva al cargar\nRuido');
    expect(addSymptom('No eleva\nRuido', 'Ruido')).toBe('No eleva\nRuido');
    expect(() => addSymptom('x'.repeat(3999), 'Ruido')).toThrow('espacio');
    expect(symptomOptions([{ categoria: 'Marcas', nombre: 'Marca' }, { categoria: 'Síntomas', nombre: 'Ruido', activo: false }, { categoria: 'Síntomas', nombre: 'Fuga' }, { categoria: 'Síntomas', nombre: 'Fuga' }])).toEqual(['Fuga']);
  });
  it.each([admin, raul, ronny])('$nombre conserva horas corregidas, causa histórica, identidad y cierre auditado', async actor => {
    const source = fixture(), repo = source.repository('OrdenServicio', actor);
    const start = new Date(Date.now() - 3600000).toISOString();
    const order = await repo.create({ equipo_id: 'equipment-1', tecnico_id: 'tech-1', tecnico_apoyo_1_id: 'tech-2', estado: 'En proceso', sintoma: 'Ruido', causa_confirmada: 'Registro anterior', fecha: start, fecha_programada: start.slice(0, 10), hora_programada: '08:15' });
    expect(order.fecha).toBe(start); expect(order.hora_programada).toBe('08:15');
    await expect(repo.update(order.id, { estado: 'Completada' })).rejects.toThrow();
    const advanced = await repo.update(order.id, { diagnostico: 'Rodamiento desgastado', trabajo_realizado: 'Cambio de rodamiento', expected_updated_at: order.fecha_actualizacion });
    const closed = await repo.update(order.id, { estado: 'Completada', pruebas_realizadas: 'Traslado sin carga', resultado_pruebas: 'Sin ruido', fecha_fin: new Date().toISOString(), expected_updated_at: advanced.fecha_actualizacion });
    expect(closed).toMatchObject({ id: order.id, codigo: order.codigo, causa_confirmada: 'Registro anterior', fecha: start, estado: 'Completada' });
    const snapshot = source.snapshot(admin);
    expect(snapshot.entities.Bitacora.some(row => row.entidad === 'OrdenServicio')).toBe(true);
    expect((await source.repository('OrdenServicio', ronny).getById(order.id))?.id).toBe(order.id);
    expect((await source.repository('OrdenServicio', raul).getById(order.id))?.id).toBe(order.id);
  });
  it('muestra al técnico solo sugerencias activas; cliente no captura ni edita órdenes', async () => {
    const source = fixture();
    const symptoms = await source.repository('Catalogos', ronny).getAll();
    expect(symptoms).toHaveLength(7); expect(symptoms.every(row => row.categoria === 'Síntomas')).toBe(true);
    await expect(source.repository('Catalogos', ronny).update(symptoms[0].id, { nombre: 'Alterado' })).rejects.toThrow();
    expect(await source.repository('Catalogos', client).getAll()).toEqual([]);
    const order = await source.repository('OrdenServicio', admin).create({ equipo_id: 'equipment-1', tecnico_id: 'tech-1', estado: 'En proceso', sintoma: 'Ruido', visible_cliente: true });
    await expect(source.repository('OrdenServicio', client).update(order.id, { diagnostico: 'Alterado' })).rejects.toThrow();
    await expect(source.repository('OrdenServicio', client).create({ equipo_id: 'equipment-1', sintoma: 'Ruido' })).rejects.toThrow();
    expect((await source.repository('OrdenServicio', client).getById(order.id))?.sintoma).toBe('Ruido');
  });
});
