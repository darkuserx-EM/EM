import { describe, expect, it } from 'vitest';
import { LocalDataSource, STORAGE_KEY } from './repository';
import { createSeed, demoUsers } from './seed';
import type { EntityRecord } from '../domain/model';
import { validateDatabase } from '../domain/validation';

const [admin, coordinator] = demoUsers;
const base = { creado_por: 'importacion', fecha_creacion: '2026-10-16T13:30:00Z', actualizado_por: 'importacion', fecha_actualizacion: '2026-10-16T13:30:00Z' };

/** Un reporte importado en la máquina equivocada, con su lectura de importación y una lectura conservada de otro origen. */
function fixture(change?: (db: ReturnType<typeof createSeed>) => void) {
  const db = createSeed();
  const clientId = String(db.entities.Equipo.find(row => row.cliente_id && db.entities.Equipo.filter(other => other.cliente_id === row.cliente_id).length > 1)!.cliente_id);
  const [wrong, right] = db.entities.Equipo.filter(row => row.cliente_id === clientId);
  const otherClient = db.entities.Equipo.find(row => row.cliente_id && row.cliente_id !== clientId)!;
  db.entities.OrdenServicio.push({ ...base, id: 'imported-order', codigo: 'OS-H-0493', equipo_id: wrong.id, cliente_id: clientId, sede_id: '', importado: true, origen_id: 'source-493', orden_origen: '493', fecha: '2026-05-14T18:49:00.000Z', estado: 'Completado', tipo: 'Mantenimiento Mayor', horometro: 8059 });
  db.entities.LecturaHorometro.push(
    { ...base, id: 'import-reading', codigo: 'HOR-H-0493', equipo_id: wrong.id, cliente_id: clientId, orden_id: 'imported-order', fecha: '2026-05-14T18:49:00.000Z', valor: 8059, origen: 'Orden de servicio', registrado_por: 'Importación histórica AppSheet', es_estimado: false },
    { ...base, id: 'kept-reading', codigo: 'HOR-902', equipo_id: wrong.id, cliente_id: clientId, orden_id: 'imported-order', fecha: '2026-05-14T18:49:00.000Z', valor: 8059, origen: 'Orden de servicio', registrado_por: 'Técnico original', es_estimado: false },
  );
  change?.(db);
  let saved = JSON.stringify(db);
  const source = new LocalDataSource({ getItem: key => key === STORAGE_KEY ? saved : null, setItem: (_key, value) => { saved = value; } }, { demoHistory: false });
  return { source, wrong, right, otherClient, before: source.snapshot(admin) };
}
const lastAudit = (source: LocalDataSource) => source.snapshot(admin).entities.Bitacora.at(-1) as EntityRecord;

describe('corrección de reportes históricos importados', () => {
  it('anular: el reporte y su lectura de importación salen del historial; la lectura de otro origen queda sin vínculo', () => {
    const { source, wrong, before } = fixture();
    expect(source.reviseImportedReport(admin, { orden_id: 'imported-order', accion: 'anular', motivo: 'Era del RD05, que no está en el portal' }, source.getRevision())).toEqual({ accion: 'anular', orden: 'OS-H-0493', lecturas: 1 });
    const after = source.snapshot(admin);
    expect(after.entities.OrdenServicio.some(row => row.id === 'imported-order')).toBe(false);
    expect(after.entities.LecturaHorometro.some(row => row.id === 'import-reading')).toBe(false);
    expect(after.entities.LecturaHorometro.find(row => row.id === 'kept-reading')).toMatchObject({ orden_id: '', equipo_id: wrong.id, valor: 8059, registrado_por: 'Técnico original' });
    const audit = lastAudit(source);
    expect(audit).toMatchObject({ accion: 'Anulación de reporte importado', orden_id: 'imported-order', equipo_id: wrong.id, motivo: 'Era del RD05, que no está en el portal', registrado_rol: 'Administrador' });
    expect(JSON.parse(String(audit.version_anterior))).toEqual(before.entities.OrdenServicio.find(row => row.id === 'imported-order'));
    expect(JSON.parse(String(audit.lecturas_anteriores_json)).map((row: EntityRecord) => row.id)).toEqual(['import-reading', 'kept-reading']);
    expect(() => validateDatabase(after)).not.toThrow();
  });

  it('reasignar: pasa con sus lecturas a otro equipo del mismo cliente', () => {
    const { source, wrong, right } = fixture();
    expect(source.reviseImportedReport(admin, { orden_id: 'imported-order', accion: 'reasignar', equipo_id: right.id, motivo: 'Las lecturas siguen la secuencia del otro equipo' }, source.getRevision())).toMatchObject({ accion: 'reasignar', lecturas: 2 });
    const after = source.snapshot(admin);
    expect(after.entities.OrdenServicio.find(row => row.id === 'imported-order')).toMatchObject({ equipo_id: right.id, sede_id: right.sede_id || '' });
    expect(after.entities.LecturaHorometro.filter(row => row.orden_id === 'imported-order').map(row => row.equipo_id)).toEqual([right.id, right.id]);
    expect(lastAudit(source)).toMatchObject({ accion: 'Reasignación de reporte importado', equipo_id: right.id, equipo_anterior_id: wrong.id });
    expect(() => validateDatabase(after)).not.toThrow();
  });

  it('solo administración, con motivo, sobre reportes importados y sin otras referencias; si falla no cambia nada', () => {
    const { source, otherClient, before } = fixture();
    const revision = source.getRevision();
    expect(() => source.reviseImportedReport(coordinator, { orden_id: 'imported-order', accion: 'anular', motivo: 'Motivo suficiente' }, revision)).toThrow('administración');
    expect(() => source.reviseImportedReport(admin, { orden_id: 'imported-order', accion: 'anular', motivo: 'corto' }, revision)).toThrow('motivo');
    expect(() => source.reviseImportedReport(admin, { orden_id: 'imported-order', accion: 'reasignar', equipo_id: otherClient.id, motivo: 'Motivo suficiente' }, revision)).toThrow('mismo cliente');
    expect(() => source.reviseImportedReport(admin, { orden_id: 'imported-order', accion: 'anular', motivo: 'Motivo suficiente' }, revision - 1)).toThrow('cambiaron');
    const portalOrder = before.entities.OrdenServicio.find(row => row.importado !== true)!;
    expect(() => source.reviseImportedReport(admin, { orden_id: portalOrder.id, accion: 'anular', motivo: 'Motivo suficiente' }, revision)).toThrow('importados');
    expect(source.snapshot(admin)).toEqual(before);
    const referenced = fixture(db => { const order = db.entities.OrdenServicio.find(row => row.id === 'imported-order')!; db.entities.OTRepuesto.push({ ...base, id: 'part-1', codigo: 'OTR-001', orden_id: order.id, equipo_id: order.equipo_id }); });
    expect(() => referenced.source.reviseImportedReport(admin, { orden_id: 'imported-order', accion: 'anular', motivo: 'Motivo suficiente' }, referenced.source.getRevision())).toThrow('otras referencias');
    expect(referenced.source.snapshot(admin)).toEqual(referenced.before);
  });
});
