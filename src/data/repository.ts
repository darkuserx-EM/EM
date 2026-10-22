import { assignedTo } from '../domain/order-team';
import { checkSubmittedReading, readingWarnings, type ReadingSubmission, type ReadingDecision } from '../domain/reading-submissions';
import { reusableHistoricalReading, sameHistoricalReading, type ReadingReconciliation } from '../domain/historical-readings';
import { createdByHistoricalImport, reassignableEquipment, type ImportedReportRevision } from '../domain/imported-reports';
import {localAuditPage, type AuditQuery} from './audit-log';
import {localOperationPage,isPagedEntity,type OperationQuery,type PagedEntity} from './operation-page';
import { preparePlan, todayGT } from '../domain/maintenance-plan';
import { findingClosed, upgradeFindingCollection } from '../domain/equipment-findings';
import { definitions, type Actor, type Database, type EntityName, type EntityRecord, type Scalar } from '../domain/model';
import { assertAdmin, filterVisible } from '../domain/permissions';
import { cleanFields, normalize, uniqueError, validateDatabase, validateRecord } from '../domain/validation';
import { addEquipmentHistoryDemo, createSeed } from './seed';
import { clientImportEntities, planClientImport, type ClientImportRow } from '../domain/client-import';
import { administrativeState, equipmentStatusChanges, equipmentStatusValues } from '../domain/equipment-status';
import { equipmentImageFields, equipmentImageLabels } from '../domain/equipment-images';
import { ValidationError } from '../domain/errors';
import type { HistoricalReportsImport } from './historical-reports';
import { enabledEquipment, validEquipmentGrant } from '../domain/technician-work';
import { equipmentCorrectionSummary, machineName, planEquipmentCorrection, type EquipmentCorrection, type EquipmentCorrectionSummary } from '../domain/equipment-correction';
import { isOperationalEntity, prepareOperation, ticketsResolvedByOrder } from '../domain/operations';

export const STORAGE_KEY = 'portal-em.database.v1';
export const LOCAL_MAX_ROWS = 20000;
export interface StorageAdapter { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface Repository {
  getAll(query?:OperationQuery): Promise<EntityRecord[]>;
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
  constructor(private storage: StorageAdapter, private options: { demoHistory: boolean; maxRows?: number; auditSequence?: number; validate?: (value:unknown)=>void } = { demoHistory: true }) {
    const saved = storage.getItem(STORAGE_KEY);
    try {
      const data: unknown = upgradeFindingCollection(saved ? JSON.parse(saved) : createSeed());
      this.validate(data);
      const expanded = this.options.demoHistory && addEquipmentHistoryDemo(data.entities);
      if (saved && expanded) data.revision++;
      this.validate(data);
      if (!saved || expanded) {
        try { storage.setItem(STORAGE_KEY, JSON.stringify(data)); }
        catch { throw new ValidationError('No se pudo guardar la ampliación del espacio local.'); }
      }
      this.database = data;
    } catch (error) {
      if (!(error instanceof ValidationError) && !(error instanceof SyntaxError)) throw error;
      throw new ValidationError(`No se pudo abrir el espacio local. Los datos existentes se conservaron. ${error instanceof Error ? error.message : ''}`);
    }
  }
  private validate(value: unknown): asserts value is Database {
    if(this.options.validate)this.options.validate(value);
    else validateDatabase(value, { maxRows: this.options.maxRows ?? LOCAL_MAX_ROWS });
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRevision = () => this.database.revision;
  recordCounts(actor:Actor) {assertAdmin(actor);return Object.fromEntries(Object.entries(this.database.entities).map(([name,rows])=>[name,rows.length]));}
  async operationPage(entity:PagedEntity,actor:Actor,query:OperationQuery={}) {
    const entities=Object.fromEntries(Object.entries(this.database.entities).map(([name,rows])=>[name,filterVisible(actor,name as EntityName,rows,this.database.entities)])) as Database['entities'];
    return localOperationPage(entity,query,{...this.database,entities});
  }
  async auditLog(actor: Actor, query: AuditQuery = {}) { assertAdmin(actor); return localAuditPage(this.database.entities.Bitacora,query); }
  refresh() {
    const saved = this.storage.getItem(STORAGE_KEY);
    if (saved) { const current: unknown = upgradeFindingCollection(JSON.parse(saved)); this.validate(current); this.database = current; this.listeners.forEach(listener => listener()); }
  }
  private commit(next: Database) {
    const saved = this.storage.getItem(STORAGE_KEY);
    if (saved) {
      const latest: unknown = upgradeFindingCollection(JSON.parse(saved)); this.validate(latest);
      if (latest.revision !== this.database.revision) { this.database = latest; this.listeners.forEach(listener => listener()); throw new ValidationError('Los datos cambiaron en otra pestaña. Revisa los valores e intenta de nuevo.'); }
    }
    next.revision = this.database.revision + 1;
    this.validate(next);
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { throw new ValidationError('No se pudo guardar. El navegador puede estar sin espacio o bloquear el almacenamiento. Descarga un respaldo antes de continuar.'); }
    this.database = next;
    this.listeners.forEach(listener => listener());
  }
  private record(entity: EntityName, actor: Actor, fields: Record<string, Scalar>, rows: EntityRecord[]): EntityRecord {
    const prefix = entity === 'Equipo' && fields.propiedad === 'De cliente' ? 'TCE' : definitions[entity].prefix;
    const max = rows.filter(row => row.codigo.startsWith(`${prefix}-`)).reduce((value, row) => Math.max(value, Number(row.codigo.match(/-(\d+)$/)?.[1] ?? 0)), entity==='Bitacora' ? this.options.auditSequence ?? 0 : 0);
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), codigo: `${prefix}-${String(max + 1).padStart(3, '0')}`, creado_por: actor.id, fecha_creacion: now, actualizado_por: actor.id, fecha_actualizacion: now, ...cleanFields(entity, fields) };
  }
  private audit(db: Database, actor: Actor, entity: string, action: string, detail: string) {
    db.entities.Bitacora.push({ ...this.record('Bitacora', actor, { entidad: entity, accion: action, detalle: detail.slice(0, 500) }, db.entities.Bitacora), registrado_por: actor.nombre, registrado_rol: actor.rol });
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
  private recordFindingChange(db: Database, actor: Actor, row: EntityRecord, previous?: EntityRecord) {
    row.actualizado_nombre = actor.nombre;
    row.cerrado_el = findingClosed(row) ? previous?.estado === row.estado ? previous.cerrado_el || row.fecha_actualizacion : row.fecha_actualizacion : '';
    const detail = `${row.codigo} · ${previous?.estado || 'Nuevo'} → ${row.estado}; prioridad: ${row.prioridad}; responsable: ${row.responsable || 'Sin asignar'}; ${row.nota_cambio || row.detalle_resolucion || (previous ? 'Ficha actualizada' : 'Seguimiento creado')}`;
    this.audit(db, actor, 'Hallazgo', previous ? 'Seguimiento actualizado' : 'Seguimiento creado', detail);
    Object.assign(db.entities.Bitacora.at(-1)!, { hallazgo_id: row.id, equipo_id: row.equipo_id, registrado_por: actor.nombre, estado_anterior: previous?.estado || '', estado_nuevo: row.estado, orden_resolucion_id: row.orden_resolucion_id || '' });
  }
  private initialEquipmentReading(db: Database, actor: Actor, row: EntityRecord) {
    if (typeof row.horometro !== 'number') return;
    if (db.entities.LecturaHorometro.some(reading => reading.equipo_id === row.id)) throw new ValidationError('El equipo ya tiene lecturas. Revisa su historial antes de registrar el horómetro.');
    const reading = this.record('LecturaHorometro', actor, {}, db.entities.LecturaHorometro);
    Object.assign(reading, { equipo_id: row.id, cliente_id: row.cliente_id || '', fecha: row.fecha_actualizacion, valor: row.horometro, origen: 'Ingreso de equipo', orden_id: '', registrado_por: actor.nombre, ubicacion: db.entities.Sede.find(site => site.id === row.sede_id)?.nombre ?? db.entities.Cliente.find(client => client.id === row.cliente_id)?.nombre ?? 'Patio EMSA' });
    db.entities.LecturaHorometro.push(reading);
  }
  private assertEditable(entity: EntityName, actor: Actor) {
    if (isOperationalEntity(entity)) return;
    assertAdmin(actor);
    if (!['Catalogos', 'Cliente', 'Contacto', 'Sede', 'Equipo', 'Hallazgo', 'PlanPM', 'Tecnico'].includes(entity)) throw new ValidationError('La edición de este módulo se habilitará en su etapa de desarrollo.');
  }
  repository(entity: EntityName, actor: Actor): Repository {
    const getAll = async (query:OperationQuery={}) => isPagedEntity(entity)&&Object.keys(query).length ? (await this.operationPage(entity,actor,{...query,page:1,pageSize:Math.max(1,this.database.entities[entity].length)})).rows : structuredClone(filterVisible(actor, entity, this.database.entities[entity], this.database.entities));
    return {
      getAll,
      getById: async id => (await getAll()).find(row => row.id === id),
      export: async predicate => { assertAdmin(actor); return (await getAll()).filter(predicate ?? (() => true)); },
      create: async input => {
        if (entity === 'Tecnico') throw new ValidationError('Crea el técnico desde Roles y accesos.');
        this.assertEditable(entity, actor);
        let fields = cleanFields(entity, input);
        const requestContent = JSON.stringify(Object.entries(fields).filter(([key]) => !['solicitud_id', 'schema_operacion'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
        if (isOperationalEntity(entity)) {
          const previousRequest = fields.solicitud_id && this.database.entities[entity].find(row => row.solicitud_id === fields.solicitud_id && row.creado_por === actor.id);
          if (previousRequest) {
            if (entity === 'OrdenServicio' && actor.rol === 'Técnico' && !assignedTo(previousRequest, actor.tecnico_id)) throw Object.assign(new ValidationError('La orden ya no está asignada a ti.'), { status: 403 });
            if (previousRequest.solicitud_datos !== requestContent) throw new ValidationError('La solicitud ya se guardó con otra información. Revisa el registro antes de crear otro.');
            return structuredClone(previousRequest);
          }
          fields = prepareOperation(entity, fields, actor, this.database.entities);
        }
        if (entity === 'PlanPM') { try { fields = preparePlan(fields, this.database.entities.OrdenServicio); } catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Plan inválido.'); } }
        const errors = validateRecord(entity, fields);
        const duplicate = uniqueError(entity, fields, this.database.entities[entity]);
        if (errors.length || duplicate) throw new ValidationError(errors.join('; ') || duplicate!);
        const next = structuredClone(this.database); const row = this.record(entity, actor, fields, next.entities[entity]);
        if (isOperationalEntity(entity) && fields.solicitud_id) row.solicitud_datos = requestContent;
        if (entity === 'PlanPM') {
          const previous = next.entities.PlanPM.filter(plan => plan.schema_plan === 1 && plan.equipo_id === row.equipo_id && plan.tipo_plan === row.tipo_plan).sort((a,b) => Number(b.version) - Number(a.version))[0];
          if (previous) previous.vigente = false;
          Object.assign(row, { version: Number(previous?.version || 0) + 1, vigente: true, anterior_id: previous?.id || '', confirmado_por: actor.nombre, confirmado_el: row.fecha_creacion, vigente_desde: todayGT() });
        }
        next.entities[entity].push(row);
        if (entity === 'Equipo') {
          if ((row.propiedad === 'De cliente' || administrativeState(row) === 'En renta') && !row.cliente_id) throw new ValidationError('Selecciona el cliente propietario o el cliente de la renta.');
          this.initialEquipmentReading(next, actor, row);
          this.recordEquipmentStatus(next, actor, row);
        }
        if (entity === 'PlanPM') {
          this.audit(next, actor, 'PlanPM', 'Nueva versión de plan', `${row.codigo} · ${row.tipo_plan} · versión ${row.version} · ${row.intervalo} ${row.criterio} · ${row.estado_plan} · ${row.motivo}`);
          Object.assign(next.entities.Bitacora.at(-1)!, { equipo_id: row.equipo_id, plan_id: row.id, registrado_por: actor.nombre });
        } else if (entity === 'Hallazgo') this.recordFindingChange(next, actor, row);
        else this.audit(next, actor, entity, 'Creación', `${row.codigo} · ${row.titulo || row.sintoma || row.nombre || row.origen || `${row.marca} ${row.modelo}`}`); this.commit(next);
        return structuredClone(row);
      },
      update: async (id, input) => {
        this.assertEditable(entity, actor);
        if (entity === 'PlanPM') throw new ValidationError('Guarda una nueva versión del plan para conservar el historial.');
        const next = structuredClone(this.database); const index = next.entities[entity].findIndex(row => row.id === id);
        if (index < 0) throw new ValidationError('No se encontró el registro.');
        const original = next.entities[entity][index]; let fields = cleanFields(entity, input);
        if (entity === 'Tecnico') {
          if (Object.keys(input).some(key => !['equipos_habilitados', 'expected_updated_at'].includes(key)) || !validEquipmentGrant(fields.equipos_habilitados)) throw new ValidationError('Solo se permite actualizar los equipos habilitados.');
          if (input.expected_updated_at !== original.fecha_actualizacion) throw Object.assign(new ValidationError('El técnico cambió. Recarga antes de guardar.'), { status: 409 });
          if (enabledEquipment({ ...original, ...fields }).some(id => !next.entities.Equipo.some(eq => eq.id === id))) throw new ValidationError('Selecciona equipos existentes.');
        }
        if (entity === 'OrdenServicio' && input.revision_accion && input.expected_updated_at !== original.fecha_actualizacion) throw Object.assign(new ValidationError('La orden cambió. Actualiza antes de revisarla.'), { status: 409 });
        if (isOperationalEntity(entity)) fields = prepareOperation(entity, fields, actor, next.entities, original);
        if (isOperationalEntity(entity) && input.expected_updated_at !== undefined && input.expected_updated_at !== original.fecha_actualizacion) throw Object.assign(new ValidationError('Este registro cambió mientras lo editabas. Cierra el formulario, revisa la versión actual y vuelve a intentarlo.'), { status: 409 });
        if (entity === 'Hallazgo') {
          if ((fields.equipo_id !== undefined && fields.equipo_id !== original.equipo_id) || (fields.orden_origen_id !== undefined && String(fields.orden_origen_id || '') !== String(original.orden_origen_id || ''))) throw new ValidationError('El equipo y el reporte de origen se conservan. Crea otro seguimiento si corresponde.');
          if (fields.estado !== undefined && fields.estado !== original.estado && !String(fields.nota_cambio || fields.detalle_resolucion || '').trim()) throw new ValidationError('Indica el motivo del cambio de estado.');
        }
        if (entity === 'Equipo') {
          if (typeof original.horometro === 'number' && fields.horometro !== undefined && fields.horometro !== original.horometro) throw new ValidationError('El horómetro se actualiza desde las lecturas. La ficha conserva el valor registrado.');
          if (fields.propiedad !== undefined && fields.propiedad !== original.propiedad) throw new ValidationError('La corrección de propiedad aún no está habilitada; el código original se conserva.');
        }
        const row: EntityRecord = { ...original, ...fields, actualizado_por: actor.id, fecha_actualizacion: new Date(Math.max(Date.now(), Date.parse(original.fecha_actualizacion) + 1)).toISOString() };
        if (entity === 'Equipo' && (row.propiedad === 'De cliente' || administrativeState(row) === 'En renta') && !row.cliente_id) throw new ValidationError('Selecciona el cliente propietario o el cliente de la renta.');
        const errors = validateRecord(entity, row); const duplicate = uniqueError(entity, row, next.entities[entity], id);
        if (errors.length || duplicate) throw new ValidationError(errors.join('; ') || duplicate!);
        if (entity === 'Equipo') this.recordEquipmentStatus(next, actor, row, original);
        next.entities[entity][index] = row;
        if (entity === 'OrdenServicio' && row.estado === 'Completada' && original.estado !== 'Completada' && typeof row.horometro === 'number' && !next.entities.LecturaHorometro.some(reading => reading.orden_id === row.id && reading.valor === row.horometro && String(reading.odometro_millas ?? '') === String(row.odometro_millas ?? ''))) {
          const readingFields = prepareOperation('LecturaHorometro', { equipo_id: row.equipo_id, cliente_id: row.cliente_id, orden_id: row.id, fecha: row.fecha_fin || new Date().toISOString(), valor: row.horometro, ...(typeof row.odometro_millas === 'number' ? { odometro_millas: row.odometro_millas } : {}) }, { ...actor, rol: 'Administrador' }, next.entities);
          const reading = this.record('LecturaHorometro', actor, readingFields, next.entities.LecturaHorometro);
          next.entities.LecturaHorometro.push(reading);
          this.audit(next, actor, 'LecturaHorometro', 'Lectura de cierre', `${row.codigo} · ${row.horometro} h; lectura original conservada.`);
        }
        if (entity === 'Equipo' && typeof original.horometro !== 'number') this.initialEquipmentReading(next, actor, row);
        if (entity === 'OrdenServicio' && row.estado === 'Completada' && original.estado !== 'Completada') {
          for (const ticket of ticketsResolvedByOrder(row, next.entities)) {
            const previousState = ticket.estado;
            Object.assign(ticket, { estado: 'Resuelto', actualizado_por: actor.id, fecha_actualizacion: new Date(Math.max(Date.now(), Date.parse(ticket.fecha_actualizacion) + 1)).toISOString() });
            this.audit(next, actor, 'Ticket', 'Resolución por orden', `${ticket.codigo} · ${previousState} → Resuelto. Resuelto automáticamente por finalización de ${row.codigo}; todas sus órdenes vinculadas están completadas.`);
            Object.assign(next.entities.Bitacora.at(-1)!, { ticket_id: ticket.id, orden_id: row.id, equipo_id: ticket.equipo_id, estado_anterior: previousState, estado_nuevo: 'Resuelto' });
          }
        }
        if (entity === 'OrdenServicio' && original.estado === 'Completada' && input.revision_accion === 'reabrir') {
          for (const ticket of next.entities.Ticket.filter(ticket => ticket.schema_operacion === 1 && ticket.importado !== true && ticket.estado === 'Resuelto' && (row.ticket_id === ticket.id || ticket.orden_id === row.id))) {
            Object.assign(ticket, { estado: 'En revisión', actualizado_por: actor.id, fecha_actualizacion: row.fecha_actualizacion });
            this.audit(next, actor, 'Ticket', 'Reapertura por orden', `${ticket.codigo} · Reapertura de ${row.codigo}`);
            Object.assign(next.entities.Bitacora.at(-1)!, { ticket_id: ticket.id, orden_id: row.id, equipo_id: row.equipo_id, estado_anterior: 'Resuelto', estado_nuevo: 'En revisión', motivo: input.revision_motivo });
          }
        }
        const changed = Object.entries(fields).filter(([key, value]) => original[key] !== value).map(([key, value]) => key === 'logo' ? `Logo: ${value ? 'actualizado' : 'retirado'}` : equipmentImageFields.some(field => field === key) ? `${equipmentImageLabels[key as keyof typeof equipmentImageLabels]}: ${value ? 'actualizada' : 'retirada'}` : `${key}: ${original[key]} → ${value}`).join('; ');
        if (entity === 'Hallazgo') this.recordFindingChange(next, actor, row, original);
        else if (entity === 'OrdenServicio' && original.estado === 'Completada' && input.revision_accion) {
          this.audit(next, actor, entity, input.revision_accion === 'reabrir' ? 'Reapertura de orden' : 'Corrección de orden completada', row.codigo + ' · ' + input.revision_motivo);
          Object.assign(next.entities.Bitacora.at(-1)!, { orden_id: row.id, equipo_id: row.equipo_id, motivo: input.revision_motivo, estado_anterior: original.estado, estado_nuevo: row.estado, version_anterior: JSON.stringify(original), version_nueva: JSON.stringify(row) });
        } else if (entity === 'Ticket' && row.estado === 'Cancelado' && original.estado !== 'Cancelado') {
          this.audit(next, actor, entity, 'Cancelación de solicitud', row.codigo + ' · ' + row.cancelacion_motivo);
          Object.assign(next.entities.Bitacora.at(-1)!, { ticket_id: row.id, equipo_id: row.equipo_id, estado_anterior: original.estado, estado_nuevo: row.estado, motivo: row.cancelacion_motivo, version_anterior: JSON.stringify(original), version_nueva: JSON.stringify(row) });
        } else if (entity === 'Ticket' && original.estado === 'Resuelto' && row.estado === 'En revisión') {
          this.audit(next, actor, entity, 'Reapertura sin orden', row.codigo + ' · Resuelto → En revisión · ' + row.reapertura_motivo);
          Object.assign(next.entities.Bitacora.at(-1)!, { ticket_id: row.id, equipo_id: row.equipo_id, estado_anterior: original.estado, estado_nuevo: row.estado, motivo: row.reapertura_motivo });
        } else if (entity === 'Tecnico') {
          this.audit(next, actor, entity, 'Equipos habilitados', `${row.codigo} · Selección actualizada`);
          Object.assign(next.entities.Bitacora.at(-1)!, { tecnico_id: row.id, equipos_anteriores: original.equipos_habilitados || '[]', equipos_nuevos: row.equipos_habilitados || '[]' });
        } else this.audit(next, actor, entity, 'Actualización', `${row.codigo} · ${changed || 'Sin cambios'}`);
        this.commit(next); return structuredClone(row);
      },
      remove: async id => { this.assertEditable(entity, actor); if (entity !== 'Catalogos') throw new ValidationError('Conserva el registro y cambia su estado desde la ficha.'); await this.repository(entity, actor).update(id, { activo: false }); },
      import: async (rows, expectedRevision) => {
        this.assertEditable(entity, actor);
        if (entity === 'Cliente') { this.importClients(actor, rows.map((item, index) => ({ ...item, entity: 'Cliente', line: index + 2 })), expectedRevision); return; }
        if (entity !== 'Catalogos') throw new ValidationError('La importación de este módulo aún no está habilitada. Usa el formulario web.');
        if (expectedRevision !== this.database.revision) throw new ValidationError('Los datos cambiaron desde la vista previa. Vuelve a seleccionar el archivo.');
        const next = structuredClone(this.database); const incomingIds = new Set<string>();
        for (const item of rows) {
          if (item.id && incomingIds.has(item.id)) throw new ValidationError('Hay identificadores duplicados en el archivo.');
          if (item.id) incomingIds.add(item.id);
          const index = item.id ? next.entities[entity].findIndex(row => row.id === item.id) : -1;
          if (item.id && index < 0) throw new ValidationError(`No existe el ID ${item.id}. Para agregar un registro nuevo, deja id vacío.`);
          const fields = cleanFields(entity, item.fields);
          const row = index >= 0 ? { ...next.entities[entity][index], ...fields, actualizado_por: actor.id, fecha_actualizacion: new Date().toISOString() } : this.record(entity, actor, fields, next.entities[entity]);
          const errors = validateRecord(entity, row); const duplicate = uniqueError(entity, row, next.entities[entity], index >= 0 ? row.id : undefined);
          if (errors.length || duplicate) throw new ValidationError(errors.join('; ') || duplicate!);
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
    if (expectedRevision !== this.database.revision) throw new ValidationError('Los datos cambiaron desde la vista previa. Vuelve a seleccionar el archivo.');
    const next = structuredClone(this.database);
    const plan = planClientImport({ Cliente: next.entities.Cliente, Contacto: next.entities.Contacto, Sede: next.entities.Sede }, rows, (entity, fields, records) => this.record(entity, actor, fields, records));
    const invalid = plan.rows.find(row => row.errors.length);
    if (invalid) throw new ValidationError(`${invalid.input.entity}, fila ${invalid.input.line}: ${invalid.errors.join(' · ')}`);
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
  importHistoricalReports(actor: Actor, payload: HistoricalReportsImport, expectedRevision: number) {
    assertAdmin(actor);
    if (expectedRevision !== this.database.revision) throw new ValidationError('Los datos cambiaron desde la vista previa. Recarga y revisa antes de guardar.');
    if (!payload || !Array.isArray(payload.equipos) || !Array.isArray(payload.reportes) || payload.reportes.length > 2000 || payload.equipos.length > 2000) throw new ValidationError('La importación debe contener hasta 2,000 equipos y reportes.');
    const next = structuredClone(this.database);
    const client = next.entities.Cliente.find(row => row.id === payload.cliente_id);
    if (!client) throw new ValidationError('Selecciona un cliente existente antes de importar.');
    const site = payload.sede_id ? next.entities.Sede.find(row => row.id === payload.sede_id) : undefined;
    if (payload.sede_id && (!site || site.cliente_id !== client.id)) throw new ValidationError('La sede seleccionada no pertenece al cliente.');
    // La ubicación de reportes y lecturas sale de la sede elegida; el archivo de AppSheet no la trae.
    const location = site ? String(site.nombre || '').trim() : '';
    const equipmentBySerial = new Map(next.entities.Equipo.map(row => [normalize(row.serie), row]));
    const incomingSerials = new Set<string>();
    for (const input of payload.equipos) {
      const serial = String(input.serie || '').trim(); const key = normalize(serial);
      if (!key || incomingSerials.has(key)) throw new ValidationError(`Serie vacía o repetida: ${serial || '(sin serie)'}.`);
      incomingSerials.add(key);
      const existing = equipmentBySerial.get(key);
      if (existing) {
        if (existing.cliente_id !== client.id || normalize(existing.modelo) !== normalize(input.modelo) || (existing.id_interno_cliente && input.id_interno_cliente && normalize(existing.id_interno_cliente) !== normalize(input.id_interno_cliente))) throw new ValidationError(`La serie ${serial} ya está registrada con datos distintos.`);
        continue;
      }
      const fields = {
        marca: String(input.marca || '').trim(), modelo: String(input.modelo || '').trim(), serie: serial,
        id_interno_cliente: String(input.id_interno_cliente || '').trim(), tipo: 'Clasificación pendiente',
        propiedad: 'De cliente', estado: 'Pendiente de revisión', estado_operativo: 'Pendiente de revisión',
        estado_mantenimiento: 'Por revisar', motivo_estado: 'Estado actual pendiente de confirmar. Ficha creada desde el historial de reportes.',
        cliente_id: client.id, sede_id: site?.id || '',
      };
      const errors = validateRecord('Equipo', fields); const duplicate = uniqueError('Equipo', fields, next.entities.Equipo);
      if (errors.length || duplicate) throw new ValidationError(`${serial}: ${errors.join('; ') || duplicate}`);
      const record = this.record('Equipo', actor, fields, next.entities.Equipo);
      next.entities.Equipo.push(record); equipmentBySerial.set(key, record);
    }
    const sourceIds = new Set(next.entities.OrdenServicio.filter(row => row.importado === true).map(row => String(row.origen_id)));
    const orderNos = new Set(next.entities.OrdenServicio.filter(row => row.importado === true).map(row => String(row.orden_origen)));
    const incomingIds = new Set<string>();
    let addedReports = 0; let addedReadings = 0; let reusedReadings = 0; const now = new Date().toISOString();
    for (const input of payload.reportes) {
      const sourceId = String(input.origen_id || '').trim(); const orderNo = String(input.orden_origen || '').trim();
      if (!sourceId || !orderNo || incomingIds.has(sourceId)) throw new ValidationError(`ID de origen vacío o repetido: ${sourceId || '(sin ID)'}.`);
      incomingIds.add(sourceId);
      if (sourceIds.has(sourceId)) continue;
      if (orderNos.has(orderNo)) throw new ValidationError(`La orden original ${orderNo} ya existe con otro ID de origen.`);
      const equipment = equipmentBySerial.get(normalize(input.serie));
      if (!equipment || equipment.cliente_id !== client.id) throw new ValidationError(`No hay equipo de ${client.nombre} con serie ${input.serie}.`);
      if (!Number.isFinite(Date.parse(input.fecha)) || !/^\d{4}-\d{2}-\d{2}T/.test(input.fecha)) throw new ValidationError(`La fecha de la orden ${orderNo} no es válida.`);
      if (input.fecha_fin && (!Number.isFinite(Date.parse(input.fecha_fin)) || !/^\d{4}-\d{2}-\d{2}T/.test(input.fecha_fin))) throw new ValidationError(`La hora final de la orden ${orderNo} no es válida.`);
      for (const [label, value] of [['H1', input.horometro], ['H3', input.odometro_millas]] as const) if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new ValidationError(`La lectura ${label} de la orden ${orderNo} no es válida.`);
      const row: EntityRecord = {
        id: crypto.randomUUID(), codigo: `OS-H-${String(next.entities.OrdenServicio.length + 1).padStart(4, '0')}`,
        creado_por: actor.id, fecha_creacion: now, actualizado_por: actor.id, fecha_actualizacion: now,
        equipo_id: equipment.id, cliente_id: client.id, tecnico_id: '', tecnico: input.tecnicos,
        fecha: input.fecha, fecha_fin: input.fecha_fin, tipo: input.tipo, estado: input.estado,
        motivo: input.diagnostico || input.tipo, diagnostico: input.diagnostico, trabajo: input.trabajo,
        prioridad: input.prioridad, ...(input.horometro === null ? {} : { horometro: input.horometro }), ...(input.odometro_millas === null ? {} : { odometro_millas: input.odometro_millas }),
        ubicacion: location, recibido_por: input.recibido_por, inspector: input.inspector,
        notas_seguridad: input.notas_seguridad, insumos_origen: input.insumos_origen, repuestos_origen: input.repuestos_origen,
        adjuntos_referencias: input.adjuntos_referencias, firma_cliente_referencia: input.firma_cliente_referencia,
        checklist_origen: input.checklist_origen, bocina_origen: input.bocina_origen, mes_origen: input.mes_origen,
        semana_origen: input.semana_origen, dia_origen: input.dia_origen, ubicacion_coordenadas: input.ubicacion_coordenadas,
        importado: true, origen_id: sourceId, orden_origen: orderNo,
      };
      next.entities.OrdenServicio.push(row); sourceIds.add(sourceId); orderNos.add(orderNo); addedReports++;
      if (typeof input.horometro === 'number') {
        const existing = reusableHistoricalReading(next.entities.LecturaHorometro, { equipo_id: equipment.id, cliente_id: client.id, fecha: input.fecha, valor: input.horometro, odometro_millas: input.odometro_millas, origen_id: sourceId });
        if (existing) {
          const original = JSON.stringify(existing);
          Object.assign(existing, { orden_id: row.id, actualizado_por: actor.id, fecha_actualizacion: now });
          this.audit(next, actor, 'LecturaHorometro', 'Lectura histórica reutilizada', `${existing.codigo} vinculada a ${row.codigo}; se conservan identidad, fecha, valor, calidad y autoría original.`);
          Object.assign(next.entities.Bitacora.at(-1)!, { equipo_id: equipment.id, lectura_id: existing.id, orden_id: row.id, lectura_original_json: original });
          reusedReadings++;
          continue;
        }
        const meter: EntityRecord = {
          id: crypto.randomUUID(), codigo: `HOR-H-${String(next.entities.LecturaHorometro.reduce((max, reading) => Math.max(max, Number(reading.codigo.match(/^HOR-H-(\d+)$/)?.[1] || 0)), 0) + 1).padStart(4, '0')}`,
          creado_por: actor.id, fecha_creacion: now, actualizado_por: actor.id, fecha_actualizacion: now,
          equipo_id: equipment.id, cliente_id: client.id, fecha: input.fecha, valor: input.horometro,
          origen: 'Orden de servicio', orden_id: row.id, registrado_por: 'Importación histórica AppSheet', ubicacion: location,
          ...(input.odometro_millas === null ? {} : { odometro_millas: input.odometro_millas }), es_estimado: false,
        };
        next.entities.LecturaHorometro.push(meter); addedReadings++;
      }
    }
    if (!addedReports && !payload.equipos.length) return { equipos: 0, reportes: 0, lecturas: 0, repetidos: payload.reportes.length };
    const newEquipment = next.entities.Equipo.length - this.database.entities.Equipo.length;
    const duplicateReports = payload.reportes.length - addedReports;
    this.audit(next, actor, 'Historial', 'Importación histórica', `${newEquipment} equipos, ${addedReports} reportes y ${addedReadings} lecturas agregados para ${client.nombre}; ${reusedReadings} lecturas reutilizadas; ${duplicateReports} reportes ya existentes omitidos. Valores de horómetro conservados como en origen.`);
    this.commit(next);
    return { equipos: newEquipment, reportes: addedReports, lecturas: addedReadings, repetidos: duplicateReports, ...(reusedReadings ? { lecturas_reutilizadas: reusedReadings } : {}) };
  }
  submitReadings(actor: Actor, payload: ReadingSubmission, expectedRevision: number) {
    if (actor.rol !== 'Cliente') throw new ValidationError('Solo el cliente puede enviar este lote.');
    if (expectedRevision !== this.database.revision) throw new ValidationError('Los datos cambiaron. Recarga y revisa el lote.');
    if (!payload || typeof payload.archivo !== 'string' || payload.archivo.length > 200 || !Array.isArray(payload.filas) || !payload.filas.length || payload.filas.length > 200) throw new ValidationError('Envía entre 1 y 200 lecturas por archivo.');
    const next = structuredClone(this.database); const batch = crypto.randomUUID(); let sent = 0; let repeated = 0;
    for (const input of payload.filas) {
      checkSubmittedReading(input, actor, next);
      const fecha = new Date(input.fecha).toISOString();
      const existing = next.entities.LecturaEnviada.find(row => row.equipo_id === input.equipo_id && Date.parse(String(row.fecha)) === Date.parse(fecha) && row.estado !== 'Rechazada');
      const official = next.entities.LecturaHorometro.find(row => row.equipo_id === input.equipo_id && Date.parse(String(row.fecha)) === Date.parse(fecha));
      if (existing || official) {
        if ((existing && existing.valor !== input.valor) || (official && official.valor !== input.valor)) throw new ValidationError('Hay otra lectura para ese equipo y momento con distinto valor. Revisa el historial.');
        repeated++; continue;
      }
      next.entities.LecturaEnviada.push(this.record('LecturaEnviada', actor, { equipo_id: input.equipo_id, cliente_id: actor.cliente_id!, fecha, valor: input.valor, observacion: input.observacion, archivo: payload.archivo, lote_id: batch, estado: 'Pendiente' }, next.entities.LecturaEnviada)); sent++;
    }
    if (sent) { this.audit(next, actor, 'LecturaEnviada', 'Lecturas enviadas', `${batch}: ${sent} pendientes; ${repeated} repetidas omitidas.`); this.commit(next); }
    return { enviadas: sent, repetidas: repeated };
  }
  reviewReading(actor: Actor, decision: ReadingDecision, expectedRevision: number) {
    assertAdmin(actor);
    if (expectedRevision !== this.database.revision) throw new ValidationError('Los datos cambiaron. Recarga antes de revisar.');
    if (!decision || typeof decision.aprobar !== 'boolean' || typeof decision.motivo !== 'string' || !decision.motivo.trim() || decision.motivo.length > 300) throw new ValidationError('Indica el motivo de la decisión (hasta 300 caracteres).');
    const next = structuredClone(this.database); const row = next.entities.LecturaEnviada.find(item => item.id === decision.id);
    if (!row) throw new ValidationError('No existe la lectura enviada.');
    if (row.estado !== 'Pendiente') throw new ValidationError('La lectura ya fue revisada.');
    if (decision.aprobar) {
      const equipment = next.entities.Equipo.find(item => item.id === row.equipo_id);
      if (!equipment || equipment.cliente_id !== row.cliente_id) throw new ValidationError('El equipo cambió de cliente. Rechaza el envío y solicita revisión.');
      const same = next.entities.LecturaHorometro.filter(item => item.equipo_id === row.equipo_id && Date.parse(String(item.fecha)) === Date.parse(String(row.fecha)));
      if (same.length) throw new ValidationError('Ya existe una lectura en ese momento. Rechaza este envío para evitar duplicados.');
      const warnings = readingWarnings({ equipo_id: String(row.equipo_id), fecha: String(row.fecha), valor: Number(row.valor) }, next.entities.LecturaHorometro);
      if (warnings.length) throw new ValidationError(`${warnings.join('. ')}. Rechaza el envío y revisa el contador antes de registrar una corrección.`);
      const reading = this.record('LecturaHorometro', actor, { schema_operacion: 1, equipo_id: row.equipo_id, cliente_id: row.cliente_id, fecha: row.fecha, valor: row.valor, origen: 'Registro manual', registrado_por: actor.nombre, es_estimado: false }, next.entities.LecturaHorometro);
      next.entities.LecturaHorometro.push(reading); row.lectura_id = reading.id;
    }
    row.estado = decision.aprobar ? 'Aprobada' : 'Rechazada'; row.motivo = decision.motivo.trim(); row.revisado_por = actor.id; row.revisado_el = new Date().toISOString(); row.actualizado_por = actor.id; row.fecha_actualizacion = String(row.revisado_el);
    this.audit(next, actor, 'LecturaEnviada', `Lectura ${row.estado.toLowerCase()}`, `${row.codigo} · ${row.valor} h · ${row.motivo}`);
    this.commit(next); return { revisadas: 1 };
  }
  /** «Corregir equipo» de una solicitud o de una orden sin solicitud (ver domain/equipment-correction.ts). Todo o nada, con copia íntegra en la bitácora. */
  changeOperationEquipment(actor: Actor, input: EquipmentCorrection, expectedRevision: number): EquipmentCorrectionSummary {
    if (expectedRevision !== this.database.revision) throw Object.assign(new ValidationError('Los datos cambiaron. Vuelve a revisar la corrección antes de guardarla.'), { status: 409 });
    const next = structuredClone(this.database);
    const plan = planEquipmentCorrection(next.entities, actor, input);
    const summary = equipmentCorrectionSummary(plan, next.entities);
    if (input.vista_previa === true) return summary;
    const reason = String(input.motivo ?? '').trim();
    if (reason.length < 8 || reason.length > 500) throw new ValidationError('Explica el motivo de la corrección (entre 8 y 500 caracteres).');
    const { ticket, orders, readings, parts, labor, findings, source, target } = plan;
    const copies = { solicitud_anterior_json: ticket ? JSON.stringify(ticket) : '', ordenes_anteriores_json: JSON.stringify(orders), lecturas_anteriores_json: JSON.stringify(readings), repuestos_anteriores_json: JSON.stringify(parts), horas_anteriores_json: JSON.stringify(labor), hallazgos_anteriores_json: JSON.stringify(findings) };
    const operations = [...(ticket ? [ticket] : []), ...orders];
    for (const row of [...operations, ...readings, ...parts, ...labor, ...findings]) {
      Object.assign(row, { equipo_id: target.id, actualizado_por: actor.id, fecha_actualizacion: new Date(Math.max(Date.now(), Date.parse(row.fecha_actualizacion) + 1)).toISOString() });
      // El cliente no cambia; la sede es la del equipo correcto (las lecturas y los demás registros solo la llevan si ya la tenían).
      if (operations.includes(row) || 'sede_id' in row) row.sede_id = String(target.sede_id || '');
      if (findings.includes(row)) row.actualizado_nombre = actor.nombre;
    }
    const codes = operations.map(row => row.codigo).join(', ');
    this.audit(next, actor, orders.length ? 'OrdenServicio' : 'Ticket', 'Corrección de equipo', `${codes} · ${machineName(source)} → ${machineName(target)}; con ${readings.length} lecturas, ${parts.length} repuestos, ${labor.length} registros de horas y ${findings.length} hallazgos. ${reason}`);
    Object.assign(next.entities.Bitacora.at(-1)!, { ticket_id: ticket?.id || '', orden_id: orders[0]?.id || '', equipo_id: target.id, equipo_anterior_id: source.id, equipo_anterior: machineName(source), equipo_nuevo: machineName(target), motivo: reason, ...copies });
    // Cada orden adicional de la solicitud también deja la corrección en su propio historial de revisiones.
    for (const order of orders.slice(1)) {
      this.audit(next, actor, 'OrdenServicio', 'Corrección de equipo', `${order.codigo} · se movió con ${codes} de ${machineName(source)} a ${machineName(target)}. ${reason}`);
      Object.assign(next.entities.Bitacora.at(-1)!, { ticket_id: ticket?.id || '', orden_id: order.id, equipo_id: target.id, equipo_anterior_id: source.id, equipo_anterior: machineName(source), equipo_nuevo: machineName(target), motivo: reason });
    }
    this.commit(next);
    return { ...summary, aplicado: true };
  }
  reconcileHistoricalReadings(actor: Actor, pairs: ReadingReconciliation[], expectedRevision: number) {
    assertAdmin(actor);
    if (expectedRevision !== this.database.revision) throw new ValidationError('Los datos cambiaron. Revisa de nuevo la conciliación.');
    if (!Array.isArray(pairs) || !pairs.length || pairs.length > 2000) throw new ValidationError('Selecciona entre 1 y 2000 pares de lecturas.');
    const next = structuredClone(this.database); const used = new Set<string>();
    for (const pair of pairs) {
      if (!pair || typeof pair.conservar_id !== 'string' || typeof pair.duplicada_id !== 'string' || pair.conservar_id === pair.duplicada_id || used.has(pair.conservar_id) || used.has(pair.duplicada_id)) throw new ValidationError('Par de lecturas inválido o repetido.');
      used.add(pair.conservar_id); used.add(pair.duplicada_id);
      const keep = next.entities.LecturaHorometro.find(row => row.id === pair.conservar_id);
      const duplicate = next.entities.LecturaHorometro.find(row => row.id === pair.duplicada_id);
      const order = next.entities.OrdenServicio.find(row => row.id === duplicate?.orden_id && row.importado === true);
      if (!keep || !duplicate || !order || keep.orden_id || keep.importado !== true || !keep.origen_id || keep.origen_id !== order.origen_id || duplicate.registrado_por !== 'Importación histórica AppSheet' || typeof order.horometro !== 'number') throw new ValidationError('Solo se concilian lecturas históricas conservadas con su duplicado de importación y el mismo ID de origen.');
      const target = { equipo_id: String(order.equipo_id), cliente_id: String(order.cliente_id), fecha: String(order.fecha), valor: order.horometro, odometro_millas: typeof order.odometro_millas === 'number' ? order.odometro_millas : null, origen_id: String(order.origen_id) };
      const others = next.entities.LecturaHorometro.filter(row => row.equipo_id === target.equipo_id && Date.parse(String(row.fecha)) === Date.parse(target.fecha));
      if (others.length !== 2 || !sameHistoricalReading(keep, target) || !sameHistoricalReading(duplicate, target)) throw new ValidationError('Las lecturas no son equivalentes o hay más de dos coincidencias.');
      for (const [entity, rows] of Object.entries(next.entities)) if (entity !== 'Bitacora') {
        if (rows.some(row => row.id !== duplicate.id && Object.entries(row).some(([key, value]) => key !== 'id' && value === duplicate.id))) throw new ValidationError('La lectura duplicada tiene otras referencias; requiere revisión.');
      }
      const original = JSON.stringify(keep); const removed = JSON.stringify(duplicate);
      Object.assign(keep, { orden_id: order.id, actualizado_por: actor.id, fecha_actualizacion: new Date().toISOString() });
      next.entities.LecturaHorometro = next.entities.LecturaHorometro.filter(row => row.id !== duplicate.id);
      this.audit(next, actor, 'LecturaHorometro', 'Conciliación de lectura duplicada', `${duplicate.codigo} → ${keep.codigo}; mismo equipo, instante, H1, H3 e ID de origen. Se conserva la lectura original y se vincula a ${order.codigo}. Duplicado archivado íntegro en esta bitácora.`);
      Object.assign(next.entities.Bitacora.at(-1)!, { equipo_id: keep.equipo_id, orden_id: order.id, lectura_id: keep.id, lectura_original_json: original, lectura_duplicada_json: removed });
    }
    this.commit(next);
    return { conciliadas: pairs.length };
  }
  /** Anula o reasigna un reporte histórico importado (ver domain/imported-reports.ts). Todo o nada, con copia íntegra en la bitácora. */
  reviseImportedReport(actor: Actor, input: ImportedReportRevision, expectedRevision: number) {
    assertAdmin(actor);
    if (expectedRevision !== this.database.revision) throw new ValidationError('Los datos cambiaron. Vuelve a abrir el reporte antes de corregirlo.');
    const reason = String(input?.motivo ?? '').trim();
    if (!input || !['anular', 'reasignar'].includes(input.accion)) throw new ValidationError('Elige si el reporte se anula o se mueve a otro equipo.');
    if (reason.length < 8 || reason.length > 500) throw new ValidationError('Explica el motivo de la corrección (entre 8 y 500 caracteres).');
    const next = structuredClone(this.database);
    const order = next.entities.OrdenServicio.find(row => row.id === input.orden_id);
    if (!order || order.importado !== true) throw new ValidationError('Solo se corrigen así los reportes históricos importados.');
    for (const [entity, rows] of Object.entries(next.entities)) if (!['Bitacora', 'LecturaHorometro'].includes(entity)) {
      if (rows.some(row => row.id !== order.id && Object.entries(row).some(([key, value]) => key !== 'id' && value === order.id))) throw new ValidationError('El reporte tiene otras referencias (solicitud, repuestos u horas); requiere revisión.');
    }
    const readings = next.entities.LecturaHorometro.filter(row => row.orden_id === order.id);
    const before = JSON.stringify(order), readingsBefore = JSON.stringify(readings), now = new Date().toISOString();
    if (input.accion === 'anular') {
      const removed = new Set(readings.filter(createdByHistoricalImport).map(row => row.id));
      next.entities.OrdenServicio = next.entities.OrdenServicio.filter(row => row.id !== order.id);
      next.entities.LecturaHorometro = next.entities.LecturaHorometro.filter(row => !removed.has(row.id));
      // Una lectura conservada de otro origen sigue siendo válida para el equipo: solo pierde el vínculo con el reporte.
      for (const reading of readings) if (!removed.has(reading.id)) Object.assign(reading, { orden_id: '', actualizado_por: actor.id, fecha_actualizacion: now });
      this.audit(next, actor, 'OrdenServicio', 'Anulación de reporte importado', `${order.codigo} · orden original ${order.orden_origen || 'sin número'}: sale del historial con ${removed.size} lecturas de importación. ${reason}`);
      Object.assign(next.entities.Bitacora.at(-1)!, { orden_id: order.id, equipo_id: order.equipo_id, motivo: reason, version_anterior: before, lecturas_anteriores_json: readingsBefore });
      this.commit(next);
      return { accion: 'anular' as const, orden: String(order.codigo), lecturas: removed.size };
    }
    const target = next.entities.Equipo.find(row => row.id === input.equipo_id);
    if (!target || !reassignableEquipment(order, [target]).length) throw new ValidationError('Elige otro equipo del mismo cliente.');
    const previousEquipment = String(order.equipo_id);
    Object.assign(order, { equipo_id: target.id, sede_id: target.sede_id || '', actualizado_por: actor.id, fecha_actualizacion: now });
    for (const reading of readings) Object.assign(reading, { equipo_id: target.id, actualizado_por: actor.id, fecha_actualizacion: now });
    this.audit(next, actor, 'OrdenServicio', 'Reasignación de reporte importado', `${order.codigo} · orden original ${order.orden_origen || 'sin número'}: pasa con ${readings.length} lecturas a ${target.codigo}. ${reason}`);
    Object.assign(next.entities.Bitacora.at(-1)!, { orden_id: order.id, equipo_id: target.id, equipo_anterior_id: previousEquipment, motivo: reason, version_anterior: before, version_nueva: JSON.stringify(order), lecturas_anteriores_json: readingsBefore });
    this.commit(next);
    return { accion: 'reasignar' as const, orden: String(order.codigo), lecturas: readings.length };
  }
  snapshot(actor: Actor) { assertAdmin(actor); return structuredClone(this.database); }
  async backup(actor: Actor) { return this.snapshot(actor); }
  restore(actor: Actor, candidate: unknown, expectedRevision: number, exportedAt?: string) {
    assertAdmin(actor); candidate = upgradeFindingCollection(candidate); this.validate(candidate);
    if (expectedRevision !== this.database.revision) throw new ValidationError('Los datos cambiaron. Revisa nuevamente el respaldo antes de restaurarlo.');
    if (exportedAt !== undefined && (!/^\d{4}-\d{2}-\d{2}T/.test(exportedAt) || !Number.isFinite(Date.parse(exportedAt)))) throw new ValidationError('La fecha de exportación del respaldo no es válida.');
    const next = structuredClone(candidate);
    // A live audit is authoritative. A genuinely empty operational database can
    // recover the original history; subsequent retries retain that live history.
    const emptyDatabase = Object.entries(this.database.entities).every(([name, rows]) => name === 'Catalogos' || rows.length === 0);
    if (!emptyDatabase) next.entities.Bitacora = structuredClone(this.database.entities.Bitacora);
    if (this.options.demoHistory) addEquipmentHistoryDemo(next.entities);
    this.audit(next, actor, 'Sistema', 'Restauración', `Respaldo revisión ${candidate.revision}; exportado: ${exportedAt ? new Date(exportedAt).toISOString() : 'fecha no disponible'}. Reemplaza revisión ${this.database.revision}. ${emptyDatabase ? 'Se recuperó la bitácora en una base operativa vacía.' : 'Se conservó la bitácora actual.'}`); this.commit(next);
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
