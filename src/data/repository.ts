import {localAuditPage, type AuditQuery} from './audit-log';
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
import { isOperationalEntity, prepareOperation } from '../domain/operations';

export const STORAGE_KEY = 'portal-em.database.v1';
export const LOCAL_MAX_ROWS = 20000;
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
  constructor(private storage: StorageAdapter, private options: { demoHistory: boolean; maxRows?: number } = { demoHistory: true }) {
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
    validateDatabase(value, { maxRows: this.options.maxRows ?? LOCAL_MAX_ROWS });
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRevision = () => this.database.revision;
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
    const max = rows.filter(row => row.codigo.startsWith(`${prefix}-`)).reduce((value, row) => Math.max(value, Number(row.codigo.match(/-(\d+)$/)?.[1] ?? 0)), 0);
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
    if (!['Catalogos', 'Cliente', 'Contacto', 'Sede', 'Equipo', 'Hallazgo', 'PlanPM'].includes(entity)) throw new ValidationError('La edición de este módulo se habilitará en su etapa de desarrollo.');
  }
  repository(entity: EntityName, actor: Actor): Repository {
    const getAll = async () => structuredClone(filterVisible(actor, entity, this.database.entities[entity], this.database.entities));
    return {
      getAll,
      getById: async id => (await getAll()).find(row => row.id === id),
      export: async predicate => { assertAdmin(actor); return (await getAll()).filter(predicate ?? (() => true)); },
      create: async input => {
        this.assertEditable(entity, actor);
        let fields = cleanFields(entity, input);
        const requestContent = JSON.stringify(Object.entries(fields).filter(([key]) => !['solicitud_id', 'schema_operacion'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
        if (isOperationalEntity(entity)) {
          const previousRequest = fields.solicitud_id && this.database.entities[entity].find(row => row.solicitud_id === fields.solicitud_id && row.creado_por === actor.id);
          if (previousRequest) {
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
        if (entity === 'OrdenServicio' && row.estado === 'Completada' && original.estado !== 'Completada' && typeof row.horometro === 'number') {
          const readingFields = prepareOperation('LecturaHorometro', { equipo_id: row.equipo_id, cliente_id: row.cliente_id, orden_id: row.id, fecha: row.fecha_fin || new Date().toISOString(), valor: row.horometro, ...(typeof row.odometro_millas === 'number' ? { odometro_millas: row.odometro_millas } : {}) }, { ...actor, rol: 'Administrador' }, next.entities);
          const reading = this.record('LecturaHorometro', actor, readingFields, next.entities.LecturaHorometro);
          next.entities.LecturaHorometro.push(reading);
          this.audit(next, actor, 'LecturaHorometro', 'Lectura de cierre', `${row.codigo} · ${row.horometro} h; lectura original conservada.`);
        }
        if (entity === 'Equipo' && typeof original.horometro !== 'number') this.initialEquipmentReading(next, actor, row);
        const changed = Object.entries(fields).filter(([key, value]) => original[key] !== value).map(([key, value]) => key === 'logo' ? `Logo: ${value ? 'actualizado' : 'retirado'}` : equipmentImageFields.some(field => field === key) ? `${equipmentImageLabels[key as keyof typeof equipmentImageLabels]}: ${value ? 'actualizada' : 'retirada'}` : `${key}: ${original[key]} → ${value}`).join('; ');
        if (entity === 'Hallazgo') this.recordFindingChange(next, actor, row, original);
        else this.audit(next, actor, entity, 'Actualización', `${row.codigo} · ${changed || 'Sin cambios'}`); this.commit(next); return structuredClone(row);
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
        marca: String(input.marca || 'Crown').trim(), modelo: String(input.modelo || '').trim(), serie: serial,
        id_interno_cliente: String(input.id_interno_cliente || '').trim(), tipo: 'Equipo Crown · clasificación pendiente',
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
    let addedReports = 0; let addedReadings = 0; const now = new Date().toISOString();
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
        ubicacion: input.ubicacion, recibido_por: input.recibido_por, inspector: input.inspector,
        notas_seguridad: input.notas_seguridad, insumos_origen: input.insumos_origen, repuestos_origen: input.repuestos_origen,
        adjuntos_referencias: input.adjuntos_referencias, firma_cliente_referencia: input.firma_cliente_referencia,
        checklist_origen: input.checklist_origen, bocina_origen: input.bocina_origen, mes_origen: input.mes_origen,
        semana_origen: input.semana_origen, dia_origen: input.dia_origen, ubicacion_coordenadas: input.ubicacion_coordenadas,
        importado: true, origen_id: sourceId, orden_origen: orderNo,
      };
      next.entities.OrdenServicio.push(row); sourceIds.add(sourceId); orderNos.add(orderNo); addedReports++;
      if (typeof input.horometro === 'number') {
        const meter: EntityRecord = {
          id: crypto.randomUUID(), codigo: `HOR-H-${String(next.entities.LecturaHorometro.length + 1).padStart(4, '0')}`,
          creado_por: actor.id, fecha_creacion: now, actualizado_por: actor.id, fecha_actualizacion: now,
          equipo_id: equipment.id, cliente_id: client.id, fecha: input.fecha, valor: input.horometro,
          origen: 'Orden de servicio', orden_id: row.id, registrado_por: 'Importación histórica AppSheet', ubicacion: input.ubicacion,
          ...(input.odometro_millas === null ? {} : { odometro_millas: input.odometro_millas }), es_estimado: false,
        };
        next.entities.LecturaHorometro.push(meter); addedReadings++;
      }
    }
    if (!addedReports && !payload.equipos.length) return { equipos: 0, reportes: 0, lecturas: 0, repetidos: payload.reportes.length };
    const newEquipment = next.entities.Equipo.length - this.database.entities.Equipo.length;
    const duplicateReports = payload.reportes.length - addedReports;
    this.audit(next, actor, 'Historial', 'Importación histórica', `${newEquipment} equipos, ${addedReports} reportes y ${addedReadings} lecturas agregados para ${client.nombre}; ${duplicateReports} reportes ya existentes omitidos. Valores de horómetro conservados como en origen.`);
    this.commit(next);
    return { equipos: newEquipment, reportes: addedReports, lecturas: addedReadings, repetidos: duplicateReports };
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
