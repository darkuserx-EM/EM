import { describe, expect, it } from 'vitest';
import { LocalDataSource, STORAGE_KEY } from './repository';
import { createSeed, demoUsers } from './seed';
import type { Actor, Database, EntityName, EntityRecord } from '../domain/model';
import type { EquipmentCorrection } from '../domain/equipment-correction';
import { validateDatabase } from '../domain/validation';

const [admin, coordinator, technician] = demoUsers; const client = demoUsers[5];
const base = { creado_por: 'user-coord', fecha_creacion: '2026-10-10T14:00:00.000Z', actualizado_por: 'user-coord', fecha_actualizacion: '2026-10-10T14:00:00.000Z' };
const reason = 'El cliente reportó la falla del otro equipo';

/**
 * Datos ficticios: la solicitud TKT-004 y su orden OS-103 (En proceso) se registraron con el primer equipo de client-2
 * en lugar del segundo. La orden tiene 2 lecturas, un repuesto, un registro de horas y un hallazgo que nació en ella.
 */
function fixture(change?: (db: Database) => void) {
  const db = createSeed();
  const [wrong, right] = db.entities.Equipo.filter(row => row.cliente_id === 'client-2');
  db.entities.Sede.push({ ...base, id: 'site-2', codigo: 'SED-901', cliente_id: 'client-2', nombre: 'Bodega central' });
  right.sede_id = 'site-2';
  const owner = { equipo_id: wrong.id, cliente_id: 'client-2' };
  const meter = { ...base, ...owner, schema_operacion: 1, orden_id: 'order-1', origen: 'Orden de servicio', registrado_por: 'Carlos Méndez', es_estimado: false };
  db.entities.Ticket.push({ ...base, ...owner, id: 'ticket-1', codigo: 'TKT-004', schema_operacion: 1, sede_id: '', titulo: 'No eleva la carga', descripcion: 'Falla al elevar con carga completa.', prioridad: 'Alta', estado: 'En revisión', fecha_programada: '', responsable_id: '', orden_id: '' });
  db.entities.OrdenServicio.push({ ...base, ...owner, id: 'order-1', codigo: 'OS-103', schema_operacion: 1, sede_id: '', ticket_id: 'ticket-1', desde_solicitud: true, tecnico_id: 'tech-1', tipo: 'Correctivo', prioridad: 'Alta', estado: 'En proceso', fecha_programada: '2026-10-10', fecha: '2026-10-10T14:30:00.000Z', sintoma: 'No eleva la carga', visible_cliente: false, motivo: 'No eleva la carga', trabajo: '', tecnico: 'Carlos Méndez' });
  db.entities.LecturaHorometro.push({ ...meter, id: 'reading-1', codigo: 'HOR-901', fecha: '2026-10-10T15:00:00.000Z', valor: 2400 }, { ...meter, id: 'reading-2', codigo: 'HOR-902', fecha: '2026-10-11T15:00:00.000Z', valor: 2406 });
  db.entities.OTRepuesto.push({ ...base, ...owner, id: 'part-1', codigo: 'REP-901', orden_id: 'order-1', descripcion: 'Sello hidráulico', cantidad: 1, costo_unitario: 85 });
  db.entities.OTHoras.push({ ...base, ...owner, id: 'labor-1', codigo: 'HRS-901', orden_id: 'order-1', horas: 2 });
  db.entities.Hallazgo.push({ ...base, id: 'finding-1', codigo: 'HAL-901', equipo_id: wrong.id, descripcion: 'Fuga en el cilindro de elevación', componente: 'Hidráulico', prioridad: 'Media', estado: 'Abierto', orden_origen_id: 'order-1' });
  change?.(db);
  let saved = JSON.stringify(db);
  const source = new LocalDataSource({ getItem: key => key === STORAGE_KEY ? saved : null, setItem: (_key, value) => { saved = value; } }, { demoHistory: false });
  const other = db.entities.Equipo.find(row => row.cliente_id === 'client-1')!;
  return { source, wrong, right, other, before: source.snapshot(admin) };
}
const order = (db: Database, id = 'order-1') => db.entities.OrdenServicio.find(row => row.id === id)!;
const find = (db: Database, entity: EntityName, id: string) => db.entities[entity].find(row => row.id === id)!;
const statusOf = (action: () => unknown) => { try { action(); } catch (error) { return (error as { status?: number }).status; } return undefined; };
const correct = (source: LocalDataSource, actor: Actor, input: Partial<EquipmentCorrection>, revision = source.getRevision()) => source.changeOperationEquipment(actor, { ticket_id: 'ticket-1', equipo_id: '', motivo: reason, ...input }, revision);

describe('corregir el equipo de una solicitud o de una orden', () => {
  it('la vista previa resume lo que se moverá sin guardar nada, desde la solicitud o desde su orden', () => {
    const { source, right, before } = fixture();
    const summary = correct(source, coordinator, { equipo_id: right.id, motivo: undefined, vista_previa: true });
    expect(summary).toMatchObject({ solicitud: 'TKT-004', ordenes: ['OS-103'], repuestos: 1, horas: 1, hallazgos: 1, equipo_nuevo_id: right.id, solo_administracion: false, aplicado: false, ultima_lectura_destino: { valor: 2357 }, avisos: [] });
    expect(summary.lecturas).toEqual([{ codigo: 'HOR-901', valor: 2400, fecha: '2026-10-10T15:00:00.000Z' }, { codigo: 'HOR-902', valor: 2406, fecha: '2026-10-11T15:00:00.000Z' }]);
    expect(source.changeOperationEquipment(coordinator, { orden_id: 'order-1', equipo_id: right.id, vista_previa: true }, source.getRevision())).toEqual(summary);
    expect(source.snapshot(admin)).toEqual(before);
  });

  it('mueve juntos la solicitud, su orden, lecturas, repuestos, horas y hallazgos, y guarda la copia anterior en la bitácora', () => {
    const { source, wrong, right, before } = fixture();
    expect(correct(source, coordinator, { equipo_id: right.id })).toMatchObject({ aplicado: true, solicitud: 'TKT-004', ordenes: ['OS-103'] });
    const after = source.snapshot(admin);
    const moved: [EntityName, string][] = [['Ticket', 'ticket-1'], ['OrdenServicio', 'order-1'], ['LecturaHorometro', 'reading-1'], ['LecturaHorometro', 'reading-2'], ['OTRepuesto', 'part-1'], ['OTHoras', 'labor-1'], ['Hallazgo', 'finding-1']];
    for (const [entity, id] of moved) expect(find(after, entity, id)).toMatchObject({ equipo_id: right.id, actualizado_por: coordinator.id });
    expect(find(after, 'Ticket', 'ticket-1')).toMatchObject({ sede_id: 'site-2', cliente_id: 'client-2', estado: 'En revisión' });
    expect(order(after)).toMatchObject({ sede_id: 'site-2', cliente_id: 'client-2', ticket_id: 'ticket-1', estado: 'En proceso', tecnico_id: 'tech-1' });
    expect(after.entities.LecturaHorometro.filter(row => row.equipo_id === wrong.id)).toEqual(before.entities.LecturaHorometro.filter(row => row.equipo_id === wrong.id && row.orden_id !== 'order-1'));
    const audit = after.entities.Bitacora.at(-1)!;
    expect(audit).toMatchObject({ entidad: 'OrdenServicio', accion: 'Corrección de equipo', ticket_id: 'ticket-1', orden_id: 'order-1', equipo_id: right.id, equipo_anterior_id: wrong.id, motivo: reason, registrado_por: coordinator.nombre, registrado_rol: 'Coordinador' });
    expect(JSON.parse(String(audit.solicitud_anterior_json))).toEqual(find(before, 'Ticket', 'ticket-1'));
    expect(JSON.parse(String(audit.ordenes_anteriores_json))).toEqual([order(before)]);
    expect(JSON.parse(String(audit.lecturas_anteriores_json)).map((row: EntityRecord) => [row.id, row.equipo_id])).toEqual([['reading-1', wrong.id], ['reading-2', wrong.id]]);
    for (const [key, id] of [['repuestos_anteriores_json', 'part-1'], ['horas_anteriores_json', 'labor-1'], ['hallazgos_anteriores_json', 'finding-1']]) expect(JSON.parse(String(audit[key])).map((row: EntityRecord) => row.id)).toEqual([id]);
    expect(after.revision).toBe(before.revision + 1);
    expect(() => validateDatabase(after)).not.toThrow();
  });

  it('una orden sin solicitud se mueve sola con sus lecturas; una solicitud con dos órdenes deja la corrección en el historial de cada una', () => {
    const single = fixture(db => { db.entities.Ticket = []; Object.assign(order(db), { ticket_id: '', desde_solicitud: false }); });
    expect(single.source.changeOperationEquipment(admin, { orden_id: 'order-1', equipo_id: single.right.id, motivo: reason }, single.source.getRevision())).toMatchObject({ solicitud: '', ordenes: ['OS-103'], aplicado: true });
    const after = single.source.snapshot(admin);
    expect(order(after).equipo_id).toBe(single.right.id);
    expect(after.entities.Bitacora.at(-1)).toMatchObject({ entidad: 'OrdenServicio', ticket_id: '', orden_id: 'order-1' });
    expect(() => validateDatabase(after)).not.toThrow();

    const pair = fixture(db => db.entities.OrdenServicio.push({ ...order(db), id: 'order-2', codigo: 'OS-104', desde_solicitud: false, estado: 'Programada', fecha: '', fecha_programada: '2026-10-20', tecnico_id: 'tech-2', tecnico: 'Ana López' }));
    expect(correct(pair.source, coordinator, { equipo_id: pair.right.id }).ordenes).toEqual(['OS-103', 'OS-104']);
    const moved = pair.source.snapshot(admin);
    expect([order(moved).equipo_id, order(moved, 'order-2').equipo_id]).toEqual([pair.right.id, pair.right.id]);
    expect(moved.entities.Bitacora.filter(row => row.accion === 'Corrección de equipo').map(row => row.orden_id)).toEqual(['order-1', 'order-2']);
    expect(() => validateDatabase(moved)).not.toThrow();
  });

  it('rechaza otro cliente, el mismo equipo, técnicos y clientes, canceladas, importadas y motivos cortos; si falla no cambia nada', () => {
    const { source, wrong, right, other, before } = fixture(); const revision = source.getRevision();
    expect(() => correct(source, coordinator, { equipo_id: other.id })).toThrow('mismo cliente');
    expect(() => correct(source, coordinator, { equipo_id: wrong.id })).toThrow('distinto del actual');
    expect(() => correct(source, coordinator, { equipo_id: right.id, motivo: 'corto' })).toThrow('motivo');
    expect(() => correct(source, coordinator, { equipo_id: right.id }, revision - 1)).toThrow('cambiaron');
    for (const actor of [technician, client]) expect(statusOf(() => correct(source, actor, { equipo_id: right.id, vista_previa: true }))).toBe(403);
    expect(source.snapshot(admin)).toEqual(before);

    const canceled = fixture(db => { order(db).estado = 'Cancelada'; });
    expect(() => correct(canceled.source, admin, { equipo_id: canceled.right.id })).toThrow('cancelada');
    expect(canceled.source.snapshot(admin)).toEqual(canceled.before);
    const imported = fixture(db => {
      db.entities.Ticket = []; db.entities.Hallazgo = []; db.entities.OTRepuesto = []; db.entities.OTHoras = [];
      db.entities.LecturaHorometro = db.entities.LecturaHorometro.filter(row => row.orden_id !== 'order-1');
      const { schema_operacion: _schema, ticket_id: _ticket, ...row } = order(db);
      db.entities.OrdenServicio = [...db.entities.OrdenServicio.filter(item => item.id !== 'order-1'), { ...row, importado: true, estado: 'Completado', origen_id: 'source-1', orden_origen: '493' }];
    });
    expect(() => imported.source.changeOperationEquipment(admin, { orden_id: 'order-1', equipo_id: imported.right.id, motivo: reason }, imported.source.getRevision())).toThrow('Corregir reporte importado');
    expect(imported.source.snapshot(admin)).toEqual(imported.before);
  });

  it('con una orden completada solo administración puede corregir el equipo', () => {
    const { source, right, before } = fixture(db => {
      Object.assign(order(db), { estado: 'Completada', fecha_fin: '2026-10-11T16:00:00.000Z', diagnostico: 'Sello dañado', trabajo_realizado: 'Cambio de sello', pruebas_realizadas: 'Elevación con carga', resultado_pruebas: 'Sin fugas', horometro: 2406 });
      find(db, 'Ticket', 'ticket-1').estado = 'Resuelto';
    });
    expect(statusOf(() => correct(source, coordinator, { equipo_id: right.id, vista_previa: true }))).toBe(403);
    expect(() => correct(source, coordinator, { equipo_id: right.id })).toThrow('solo administración');
    expect(source.snapshot(admin)).toEqual(before);
    expect(correct(source, admin, { equipo_id: right.id })).toMatchObject({ aplicado: true, solo_administracion: true });
    const after = source.snapshot(admin);
    expect(order(after)).toMatchObject({ equipo_id: right.id, estado: 'Completada' });
    expect(after.entities.Bitacora.at(-1)).toMatchObject({ registrado_rol: 'Administrador' });
    expect(() => validateDatabase(after)).not.toThrow();
  });

  it('se detiene si una lectura movida rompe la secuencia del horómetro del equipo correcto y dice cuál revisar', () => {
    const later = fixture(db => { db.entities.LecturaHorometro.push({ ...base, id: 'reading-right', codigo: 'HOR-950', schema_operacion: 1, equipo_id: db.entities.Equipo.filter(row => row.cliente_id === 'client-2')[1].id, cliente_id: 'client-2', orden_id: '', fecha: '2026-10-10T20:00:00.000Z', valor: 2380, origen: 'Registro manual', registrado_por: 'Operador', es_estimado: false }); });
    expect(() => correct(later.source, coordinator, { equipo_id: later.right.id })).toThrow(/HOR-901.*mayor que la lectura posterior HOR-950/);
    expect(later.source.snapshot(admin)).toEqual(later.before);
    const lower = fixture(db => { for (const row of db.entities.LecturaHorometro.filter(item => item.orden_id === 'order-1')) row.valor = Number(row.valor) - 400; });
    expect(() => correct(lower.source, coordinator, { equipo_id: lower.right.id, vista_previa: true })).toThrow(/HOR-901 \(2,000 h del 10\/10\/2026\) es menor que la lectura anterior/);
    expect(lower.source.snapshot(admin)).toEqual(lower.before);
  });

  it('avisa si la orden abierta tiene capturado un horómetro menor que la última lectura del equipo correcto', () => {
    const { source, right } = fixture(db => {
      db.entities.LecturaHorometro = db.entities.LecturaHorometro.filter(row => row.orden_id !== 'order-1');
      order(db).horometro = 1700;
    });
    expect(correct(source, coordinator, { equipo_id: right.id, vista_previa: true }).avisos).toEqual([expect.stringContaining('OS-103 tiene capturado un horómetro de 1,700 h, menor que los 2,357 h de la última lectura')]);
  });

  it('se detiene si un hallazgo se resolvió en la orden pero nació en otra, o si otro registro quedaría vinculado al equipo anterior', () => {
    const finding = fixture(db => { db.entities.Hallazgo.push({ ...base, id: 'finding-2', codigo: 'HAL-902', equipo_id: db.entities.Equipo.filter(row => row.cliente_id === 'client-2')[0].id, descripcion: 'Desgaste de cadenas', componente: 'Torre y cadenas', prioridad: 'Baja', estado: 'Abierto', orden_origen_id: '', orden_resolucion_id: 'order-1' }); });
    expect(() => correct(finding.source, admin, { equipo_id: finding.right.id })).toThrow(/HAL-902 se resolvió en OS-103 pero nació fuera/);
    expect(finding.source.snapshot(admin)).toEqual(finding.before);
    const linked = fixture(db => { db.entities.LecturaEnviada.push({ ...base, id: 'sent-1', codigo: 'ENV-901', equipo_id: db.entities.Equipo.filter(row => row.cliente_id === 'client-2')[0].id, cliente_id: 'client-2', fecha: '2026-10-10T15:00:00.000Z', valor: 2400, estado: 'Aprobada', lectura_id: 'reading-1', archivo: 'flota.xlsx', lote_id: 'lote-1', observacion: '' }); });
    expect(() => correct(linked.source, admin, { equipo_id: linked.right.id })).toThrow('ENV-901 está vinculado');
    expect(linked.source.snapshot(admin)).toEqual(linked.before);
  });
});
