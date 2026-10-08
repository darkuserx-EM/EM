import { definitions, type Actor, type Database, type EntityName, type EntityRecord, type Scalar } from '../domain/model';
import { assertAdmin, filterVisible } from '../domain/permissions';
import { cleanFields, normalize, uniqueError, validateDatabase, validateRecord } from '../domain/validation';
import { addEquipmentHistoryDemo, createSeed } from './seed';
import { clientImportEntities, planClientImport, type ClientImportRow } from '../domain/client-import';
import { administrativeState, equipmentStatusChanges, equipmentStatusValues } from '../domain/equipment-status';
import { equipmentImageFields, equipmentImageLabels } from '../domain/equipment-images';

export const STORAGE_KEY = 'portal-em.database.v1';
export interface StorageAdapter { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface Repository {
  getAll(): Promise<EntityRecord[]>;
  getById(id: string): Promise<EntityRecord | undefined>;
  create(input: Record<string, Scalar>): Promise<EntityRecord>;
  update(id: string, input: Record<string, Scalar>): Promise<EntityRecord>;
  remove(id: string): Promise<void>;
  import(rows: ImportRow[], expectedRevision: number): Promise<void>;
  export(predicate?: (row: EntityRecord) => boolean): Promise<EntityRecord[]>;
}
export interface ImportRow { id?: string; fields: Record<string, Scalar> }
export class LocalDataSource {
  private database: Database;
  private listeners = new Set<() => void>();
  constructor(private storage: StorageAdapter, private options = { demoHistory: true }) {
    const saved = storage.getItem(STORAGE_KEY);
    try {
      const data: unknown = saved ? JSON.parse(saved) : createSeed();
      validateDatabase(data);
      const expanded = this.options.demoHistory && addEquipmentHistoryDemo(data.entities);
      if (saved && expanded) data.revision++;
      validateDatabase(data);
      if (!saved || expanded) storage.setItem(STORAGE_KEY, JSON.stringify(data));
      this.database = data;
    } catch (error) {
      throw new Error(`No se pudo abrir el espacio local. Los datos existentes se conservaron. ${error instanceof Error ? error.message : ''}`);
    }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRevision = () => this.database.revision;
  refresh() {
    const saved = this.storage.getItem(STORAGE_KEY);
    if (saved) { const current: unknown = JSON.parse(saved); validateDatabase(current); this.database = current; this.listeners.forEach(listener => listener()); }
  }
  private commit(next: Database) {
    const saved = this.storage.getItem(STORAGE_KEY);
    if (saved) {
      const latest: unknown = JSON.parse(saved); validateDatabase(latest);
      if (latest.revision !== this.database.revision) { this.database = latest; this.listeners.forEach(listener => listener()); throw new Error('Los datos cambiaron en otra pestaña. Revisa los valores e intenta de nuevo.'); }
    }
    next.revision = this.database.revision + 1;
    validateDatabase(next);
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { throw new Error('No se pudo guardar. El navegador puede estar sin espacio o bloquear el almacenamiento. Descarga un respaldo antes de continuar.'); }
    this.database = next;
    this.listeners.forEach(listener => listener());
  }
  private record(entity: EntityName, actor: Actor, fields: Record<string, Scalar>, rows: EntityRecord[]): EntityRecord {
    const prefix = entity === 'Equipo' && fields.propiedad === 'De cliente' ? 'TCE' : definitions[entity].prefix;
    const max = rows.filter(row => row.codigo.startsWith(`${prefix}-`)).reduce((value, row) => Math.max(value, Number(row.codigo.match(/-(\d+)$/)?.[1] ?? 0)), 0);
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), codigo: `${prefix}-${String(max + 1).padStart(3, '0')}`, creado_por: actor.id, fecha_creacion: now, actualizado_por: actor.id, fecha_actualizacion: now, ...cleanFields(entity, fields) };
  }
  private audit(db: Database, actor: Actor, entity: string, action: string, detail: string) {
    db.entities.Bitacora.push(this.record('Bitacora', actor, { entidad: entity, accion: action, detalle: detail.slice(0, 500) }, db.entities.Bitacora));
  }
  private recordEquipmentStatus(db: Database, actor: Actor, row: EntityRecord, previous?: EntityRecord) {
    const changed = equipmentStatusChanges(previous ?? {}, row);
    if (!changed.length) return;
    row.estado_actualizado_por = actor.nombre;
    row.estado_actualizado_el = row.fecha_actualizacion;
    const before = equipmentStatusValues(previous ?? {}); const after = equipmentStatusValues(row);
    const labels: Record<string, string> = { estado_operativo: 'Operación', estado_administrativo: 'Administración', estado_mantenimiento: 'Mantenimiento', motivo_estado: 'Motivo' };
    const detail = changed.map(key => key === 'motivo_estado' ? 'Motivo: ' + (after[key] || 'retirado') : labels[key] + ': ' + (before[key] || 'Sin especificar') + ' → ' + (after[key] || 'Sin especificar')).join('; ');
    this.audit(db, actor, 'Equipo', 'Cambio de estado', row.codigo + ' · ' + detail);
    Object.assign(db.entities.Bitacora.at(-1)!, { equipo_id: row.id, registrado_por: actor.nombre, motivo: row.motivo_estado || '' });
  }
  private initialEquipmentReading(db: Database, actor: Actor, row: EntityRecord) {
    if (typeof row.horometro !== 'number') return;
    if (db.entities.LecturaHorometro.some(reading => reading.equipo_id === row.id)) throw new Error('El equipo ya tiene lecturas. Revisa su historial antes de registrar el horómetro.');
    const reading = this.record('LecturaHorometro', actor, {}, db.entities.LecturaHorometro);
    Object.assign(reading, { equipo_id: row.id, cliente_id: row.cliente_id || '', fecha: row.fecha_actualizacion, valor: row.horometro, origen: 'Ingreso de equipo', orden_id: '', registrado_por: actor.nombre, ubicacion: db.entities.Sede.find(site => site.id === row.sede_id)?.nombre ?? db.entities.Cliente.find(client => client.id === row.cliente_id)?.nombre ?? 'Patio EMSA' });
    db.entities.LecturaHorometro.push(reading);
  }
  private assertEditable(entity: EntityName, actor: Actor) {
    assertAdmin(actor);
    if (!['Catalogos', 'Cliente', 'Contacto', 'Sede', 'Equipo'].includes(entity)) throw new Error('La edición de este módulo se habilitará en su etapa de desarrollo.');
  }
  repository(entity: EntityName, actor: Actor): Repository {
    const getAll = async () => structuredClone(filterVisible(actor, entity, this.database.entities[entity]));
    return {
      getAll,
      getById: async id => (await getAll()).find(row => row.id === id),
      export: async predicate => { assertAdmin(actor); return (await getAll()).filter(predicate ?? (() => true)); },
      create: async input => {
        this.assertEditable(entity, actor);
        const fields = cleanFields(entity, input); const errors = validateRecord(entity, fields);
        const duplicate = uniqueError(entity, fields, this.database.entities[entity]);
        if (errors.length || duplicate) throw new Error(errors.join('; ') || duplicate!);
        const next = structuredClone(this.database); const row = this.record(entity, actor, fields, next.entities[entity]);
        next.entities[entity].push(row);
        if (entity === 'Equipo') {
          if ((row.propiedad === 'De cliente' || administrativeState(row) === 'En renta') && !row.cliente_id) throw new Error('Selecciona el cliente propietario o el cliente de la renta.');
          this.initialEquipmentReading(next, actor, row);
          this.recordEquipmentStatus(next, actor, row);
        }
        this.audit(next, actor, entity, 'Creación', `${row.codigo} · ${row.nombre || `${row.marca} ${row.modelo}`}`); this.commit(next);
        return structuredClone(row);
      },
      update: async (id, input) => {
        this.assertEditable(entity, actor);
        const next = structuredClone(this.database); const index = next.entities[entity].findIndex(row => row.id === id);
        if (index < 0) throw new Error('No se encontró el registro.');
        const original = next.entities[entity][index]; const fields = cleanFields(entity, input);
        if (entity === 'Equipo') {
          if (typeof original.horometro === 'number' && fields.horometro !== undefined && fields.horometro !== original.horometro) throw new Error('El horómetro se actualiza desde las lecturas. La ficha conserva el valor registrado.');
          if (fields.propiedad !== undefined && fields.propiedad !== original.propiedad) throw new Error('La corrección de propiedad aún no está habilitada; el código original se conserva.');
        }
        const row: EntityRecord = { ...original, ...fields, actualizado_por: actor.id, fecha_actualizacion: new Date().toISOString() };
        if (entity === 'Equipo' && (row.propiedad === 'De cliente' || administrativeState(row) === 'En renta') && !row.cliente_id) throw new Error('Selecciona el cliente propietario o el cliente de la renta.');
        const errors = validateRecord(entity, row); const duplicate = uniqueError(entity, row, next.entities[entity], id);
        if (errors.length || duplicate) throw new Error(errors.join('; ') || duplicate!);
        if (entity === 'Equipo') this.recordEquipmentStatus(next, actor, row, original);
        next.entities[entity][index] = row;
        if (entity === 'Equipo' && typeof original.horometro !== 'number') this.initialEquipmentReading(next, actor, row);
        const changed = Object.entries(fields).filter(([key, value]) => original[key] !== value).map(([key, value]) => key === 'logo' ? `Logo: ${value ? 'actualizado' : 'retirado'}` : equipmentImageFields.some(field => field === key) ? `${equipmentImageLabels[key as keyof typeof equipmentImageLabels]}: ${value ? 'actualizada' : 'retirada'}` : `${key}: ${original[key]} → ${value}`).join('; ');
        this.audit(next, actor, entity, 'Actualización', `${row.codigo} · ${changed || 'Sin cambios'}`); this.commit(next); return structuredClone(row);
      },
      remove: async id => { this.assertEditable(entity, actor); if (entity !== 'Catalogos') throw new Error('Conserva el registro y cambia su estado desde la ficha.'); await this.repository(entity, actor).update(id, { activo: false }); },
      import: async (rows, expectedRevision) => {
        this.assertEditable(entity, actor);
        if (entity === 'Cliente') { this.importClients(actor, rows.map((item, index) => ({ ...item, entity: 'Cliente', line: index + 2 })), expectedRevision); return; }
        if (entity !== 'Catalogos') throw new Error('La importación de este módulo aún no está habilitada. Usa el formulario web.');
        if (expectedRevision !== this.database.revision) throw new Error('Los datos cambiaron desde la vista previa. Vuelve a seleccionar el archivo.');
        const next = structuredClone(this.database); const incomingIds = new Set<string>();
        for (const item of rows) {
          if (item.id && incomingIds.has(item.id)) throw new Error('Hay identificadores duplicados en el archivo.');
          if (item.id) incomingIds.add(item.id);
          const index = item.id ? next.entities[entity].findIndex(row => row.id === item.id) : -1;
          if (item.id && index < 0) throw new Error(`No existe el ID ${item.id}. Para agregar un registro nuevo, deja id vacío.`);
          const fields = cleanFields(entity, item.fields);
          const row = index >= 0 ? { ...next.entities[entity][index], ...fields, actualizado_por: actor.id, fecha_actualizacion: new Date().toISOString() } : this.record(entity, actor, fields, next.entities[entity]);
          const errors = validateRecord(entity, row); const duplicate = uniqueError(entity, row, next.entities[entity], index >= 0 ? row.id : undefined);
          if (errors.length || duplicate) throw new Error(errors.join('; ') || duplicate!);
          if (index >= 0) next.entities[entity][index] = row; else next.entities[entity].push(row);
        }
        this.audit(next, actor, entity, 'Importación', `${rows.length} registros procesados desde Excel.`); this.commit(next);
      },
    };
  }
  previewClientImport(actor: Actor, rows: ClientImportRow[]) {
    assertAdmin(actor);
    return planClientImport({ Cliente: this.database.entities.Cliente, Contacto: this.database.entities.Contacto, Sede: this.database.entities.Sede }, rows).rows;
  }
  importClients(actor: Actor, rows: ClientImportRow[], expectedRevision: number) {
    assertAdmin(actor);
    if (expectedRevision !== this.database.revision) throw new Error('Los datos cambiaron desde la vista previa. Vuelve a seleccionar el archivo.');
    const next = structuredClone(this.database);
    const plan = planClientImport({ Cliente: next.entities.Cliente, Contacto: next.entities.Contacto, Sede: next.entities.Sede }, rows, (entity, fields, records) => this.record(entity, actor, fields, records));
    const invalid = plan.rows.find(row => row.errors.length);
    if (invalid) throw new Error(`${invalid.input.entity}, fila ${invalid.input.line}: ${invalid.errors.join(' · ')}`);
    const now = new Date().toISOString();
    for (const item of plan.rows.filter(row => row.action === 'Actualizar')) {
      const record = plan.entities[item.input.entity].find(row => row.id === item.input.id?.trim())!;
      record.actualizado_por = actor.id; record.fecha_actualizacion = now;
    }
    for (const entity of clientImportEntities) next.entities[entity] = plan.entities[entity];
    const counts = clientImportEntities.map(entity => `${entity}: ${rows.filter(row => row.entity === entity).length}`).join(', ');
    this.audit(next, actor, 'Cliente', 'Importación', `${counts}. ${plan.rows.filter(row => row.action === 'Agregar').length} altas y ${plan.rows.filter(row => row.action === 'Actualizar').length} actualizaciones desde Excel.`);
    this.commit(next);
    return plan.entities.Cliente.find(row => rows.some(item => item.entity === 'Cliente' && (item.id?.trim() ? item.id.trim() === row.id : normalize(item.fields.nombre) === normalize(row.nombre))))?.id;
  }
  snapshot(actor: Actor) { assertAdmin(actor); return structuredClone(this.database); }
  async backup(actor: Actor) { return this.snapshot(actor); }
  restore(actor: Actor, candidate: unknown, expectedRevision: number) {
    assertAdmin(actor); validateDatabase(candidate);
    if (expectedRevision !== this.database.revision) throw new Error('Los datos cambiaron. Revisa nuevamente el respaldo antes de restaurarlo.');
    const next = structuredClone(candidate);
    if (this.options.demoHistory) addEquipmentHistoryDemo(next.entities);
    this.audit(next, actor, 'Sistema', 'Restauración', 'Se restauró un respaldo completo revisado por administración.'); this.commit(next);
  }
}
let singleton: LocalDataSource | undefined;
export function getDataSource() {
  if (!singleton) {
    singleton = new LocalDataSource(window.localStorage);
    window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) singleton?.refresh(); });
  }
  return singleton;
}
