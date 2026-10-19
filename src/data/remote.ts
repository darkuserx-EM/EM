import type { AuditPage, AuditQuery } from './audit-log';
import type { Actor, Database, EntityName, EntityRecord, Scalar } from '../domain/model';
import { assertAdmin } from '../domain/permissions';
import { planClientImport, type ClientImportRow } from '../domain/client-import';
import type { Repository } from './repository';
import type { HistoricalReportsImport } from './historical-reports';
import { isOperationalEntity } from '../domain/operations';
import { equipmentImageFields } from '../domain/equipment-images';
import {isPagedEntity,localOperationPage,type OperationQuery,type OperationPage,type PagedEntity} from './operation-page';

let csrf = '';
let authEpoch = 0;
type SyncedDatabase = Database & { syncToken?: string; access?: Actor; pagedEntities?:string[]; counts?:Record<string,number> };
export function setCsrf(value: string) { csrf = value; authEpoch++; }
export async function videoChunk(id:string,offset:number,bytes:Blob):Promise<{offset:number}> {
  const response=await fetch(`/api/videos/${encodeURIComponent(id)}/chunk?offset=${offset}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream','X-CSRF-Token':csrf},body:bytes,signal:AbortSignal.timeout(90000)});
  if(response.status===401)window.dispatchEvent(new Event('portal-session-expired'));
  const data=await response.json();if(!response.ok)throw new Error(data.error||'No se pudo enviar esta parte del video. Conserva el archivo y reintenta.');return data;
}
async function uploadEquipmentFields(fields: Record<string, Scalar>) {
  const values = { ...fields }; const uploads: Record<string, string> = {};
  for (const field of equipmentImageFields) {
    const value = values[field];
    if (typeof value !== 'string' || !value.startsWith('data:')) continue;
    const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,(.*)$/);
    if (!match) throw new Error('La fotografía no es válida.');
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
    const uploadId = crypto.randomUUID();
    const response = await fetch('/api/equipment-media/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': match[1], 'X-CSRF-Token': csrf, 'X-Upload-ID': uploadId, 'X-Equipment-Field': field }, body: bytes, signal: AbortSignal.timeout(30000) });
    if (response.status === 401) window.dispatchEvent(new Event('portal-session-expired'));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar la fotografía. Tus campos siguen en el formulario.');
    values[field] = data.reference; uploads[field] = data.uploadId;
  }
  return { fields: values, mediaUploads: uploads };
}
export async function api<T>(path: string, body?: unknown, options: {poll?:boolean;timeoutMs?:number} = {}): Promise<T> {
  const epoch = authEpoch;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(),options.timeoutMs??30000);
  let response: Response; let data: unknown;
  try {
    response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? (options.poll ? {'X-Portal-Poll':'1'} : {}) : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body),signal:controller.signal });
    if (response.status === 204) {
      if (body === undefined && path.startsWith('database?since=')) return undefined as T;
      throw new Error('El servidor no confirmó el resultado de la operación. Revisa la información antes de repetirla.');
    }
    try { data = await response.json(); }
    catch {
      if (response.status === 401 && epoch === authEpoch && !['login','session'].includes(path)) window.dispatchEvent(new Event('portal-session-expired'));
      throw new Error(response.status === 401 ? 'Tu sesión terminó. Vuelve a ingresar.' : `No recibimos una respuesta válida del servidor (HTTP ${response.status}). ${body === undefined ? 'Intenta actualizar la página.' : 'Tus campos siguen en el formulario. Comprueba la lista antes de volver a guardar para evitar duplicados.'}`);
    }
  } catch (error) {
    if (controller.signal.aborted || error instanceof TypeError) throw new Error(body === undefined ? 'No se pudo conectar con el portal. Revisa tu conexión e intenta nuevamente.' : 'No recibimos confirmación del guardado. Tus campos siguen en el formulario; comprueba la lista antes de repetirlo para evitar duplicados.');
    throw error;
  } finally { clearTimeout(timeout); }
  if (!data || typeof data !== 'object') throw new Error('La respuesta del servidor está incompleta. Actualiza la página antes de continuar.');
  if (!response.ok) {
    if (response.status === 401 && epoch === authEpoch && !['login','session'].includes(path)) window.dispatchEvent(new CustomEvent('portal-session-expired', {detail:'code' in data ? data.code : undefined}));
    if ('code' in data && data.code === 'PASSWORD_CHANGE_REQUIRED' && epoch === authEpoch) window.dispatchEvent(new Event('portal-password-required'));
    throw Object.assign(new Error(('error' in data && typeof data.error === 'string' && data.error) || 'No se pudo completar la solicitud.'), { status: response.status, code: 'code' in data ? data.code : undefined });
  }
  return data as T;
}
export class RemoteDataSource {
  private connection: 'ok' | 'error' | 'syncing' = 'syncing';
  private connectionSequence = 0;
  private connectionListeners = new Set<() => void>();
  subscribeConnection = (listener: () => void) => { this.connectionListeners.add(listener); return () => { this.connectionListeners.delete(listener); }; };
  getConnection = () => this.connection;
  private reportConnection(value: 'ok' | 'error' | 'syncing', sequence: number, generation: number) {
    if (generation !== this.generation || sequence < this.connectionSequence) return;
    this.connectionSequence = sequence;
    if (this.connection !== value) { this.connection = value; this.connectionListeners.forEach(listener => listener()); }
  }
  private database?: SyncedDatabase;
  private sequence = 0;
  private lastAccepted = 0;
  private generation = 0;
  private listeners = new Set<() => void>();
  private pendingCreates = new Map<string, string>();
  private collections = new Map<string,Promise<EntityRecord[]>>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRevision = () => this.database?.revision ?? -1;
  private accept(db: SyncedDatabase, sequence: number, generation: number) {
    if (generation !== this.generation || sequence < this.lastAccepted || (this.database && db.revision < this.database.revision)) return;
    const accessChanged = db.access && JSON.stringify(db.access) !== JSON.stringify(this.database?.access);
    this.collections.clear();
    this.database = db; this.lastAccepted = sequence;
    if (accessChanged && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('portal-access-changed', {detail:db.access}));
    this.listeners.forEach(listener => listener());
  }
  clear() { this.generation++; this.database = undefined; this.pendingCreates.clear(); this.collections.clear(); setCsrf(''); this.reportConnection('syncing', ++this.sequence, this.generation); this.listeners.forEach(listener => listener()); }
  async refresh(poll = false) {
    const sequence = ++this.sequence; const generation = this.generation;
    const since = this.database?.syncToken;
    this.reportConnection('syncing', sequence, generation);
    try {
      const db = await api<SyncedDatabase | undefined>(since ? `database?since=${encodeURIComponent(since)}&paged=1` : 'database?paged=1',undefined,{poll});
      if (db) this.accept(db, sequence, generation);
      this.reportConnection('ok', sequence, generation);
    } catch (error) { this.reportConnection('error', sequence, generation); throw error; }
  }
  private current() { if (!this.database) throw new Error('Espera a que termine la conexión al servidor.'); return this.database; }
  private async mutate<T>(body: Record<string, unknown>): Promise<T> {
    const sequence = ++this.sequence; const generation = this.generation;
    try { const response = await api<{ database: SyncedDatabase; result: T }>('mutate', { revision: this.getRevision(), ...body, paged:true }); this.accept(response.database, sequence, generation); return response.result; }
    catch (error) { if (generation === this.generation && (error as { status?: number }).status === 409) await this.refresh(); throw error; }
  }
  repository(entity: EntityName, actor: Actor): Repository {
    const getAll = async (query:OperationQuery={}) => {
      const db=this.current();
      if(!isPagedEntity(entity))return structuredClone(db.entities[entity]);
      if(!db.pagedEntities?.includes(entity))return localOperationPage(entity,{...query,page:1,pageSize:Math.max(1,db.entities[entity].length)},db).rows;
      const key=JSON.stringify([entity,query]);
      if(!this.collections.has(key)) {
        if(this.collections.size>=12)this.collections.delete(this.collections.keys().next().value!);
        const loading=(async()=>{
          const rows:EntityRecord[]=[];const ids=new Set<string>();let page=1,total=Infinity;
          do {
            if(this.current()!==db)throw new Error('La consulta cambió. Espera a que se actualice.');
            const result=await this.operationPage(entity,actor,{...query,page,pageSize:200});
            if(this.current()!==db||result.revision!==db.revision)throw new Error('La consulta cambió. Espera a que se actualice.');
            for(const row of result.rows){if(ids.has(row.id))throw new Error('El historial está incompleto. Vuelve a consultar.');ids.add(row.id);}
            rows.push(...result.rows);total=result.total;page++;
            if(rows.length>total)throw new Error('El historial cambió. Vuelve a consultar.');
            if(!result.rows.length&&rows.length<total)throw new Error('El historial está incompleto. Vuelve a consultar.');
          }while(rows.length<total);
          return rows;
        })();
        this.collections.set(key,loading);void loading.catch(()=>{if(this.collections.get(key)===loading)this.collections.delete(key);});
      }
      return structuredClone(await this.collections.get(key)!);
    };
    const getById=async(id:string)=>isPagedEntity(entity)&&this.current().pagedEntities?.includes(entity)?(await this.operationPage(entity,actor,{id,pageSize:1})).rows[0]:(await getAll()).find(row=>row.id===id);
    return {
      getAll, getById,
      export: async predicate => { assertAdmin(actor); const rows = (await getAll()).filter(predicate || (() => true)); return entity === 'Equipo' ? (await api<{rows:EntityRecord[]}>('equipment-export', {ids:rows.map(row => row.id)})).rows : rows; },
      create: async (fields: Record<string, Scalar>) => {
        if (!isOperationalEntity(entity)) { assertAdmin(actor); return this.mutate<EntityRecord>({ action: 'create', entity, ...(entity === 'Equipo' ? await uploadEquipmentFields(fields) : {fields}) }); }
        const key = JSON.stringify([actor.id, entity, Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))]);
        const requestId = fields.solicitud_id || this.pendingCreates.get(key) || crypto.randomUUID();
        if (this.pendingCreates.size >= 100) this.pendingCreates.delete(this.pendingCreates.keys().next().value!);
        this.pendingCreates.set(key, String(requestId));
        const result = await this.mutate<EntityRecord>({ action: 'create', entity, fields: { ...fields, solicitud_id: requestId } });
        this.pendingCreates.delete(key); return result;
      },
      update: async (id, fields) => {
        if (!isOperationalEntity(entity)) { assertAdmin(actor); return this.mutate<EntityRecord>({ action: 'update', entity, id, ...(entity === 'Equipo' ? await uploadEquipmentFields(fields) : {fields}) }); }
        return this.mutate<EntityRecord>({ action: 'update', entity, id, fields: { expected_updated_at: fields.expected_updated_at || (await getById(id))?.fecha_actualizacion || '', ...fields } });
      },
      remove: async id => { assertAdmin(actor); await this.mutate({ action: 'remove', entity, id }); },
      import: async (rows, revision) => { assertAdmin(actor); await this.mutate({ action: 'import', entity, rows, revision }); },
    };
  }
  recordCounts(actor:Actor) {assertAdmin(actor);return this.current().counts||Object.fromEntries(Object.entries(this.current().entities).map(([name,rows])=>[name,rows.length]));}
  async operationPage(entity:PagedEntity,_actor:Actor,query:OperationQuery={}):Promise<OperationPage> {
    const db=this.current(),generation=this.generation;
    if(!db.pagedEntities?.includes(entity))return localOperationPage(entity,query,db);
    const params=new URLSearchParams(Object.entries({...query,token:db.syncToken}).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));
    try {
      const page=await api<OperationPage>('operations/'+entity+'?'+params);
      if(generation!==this.generation||this.current()!==db)throw new Error('La consulta cambió. Espera a que se actualice.');
      return page;
    }catch(error){if(generation===this.generation&&(error as {status?:number}).status===409)await this.refresh();throw error;}
  }
  async auditLog(actor: Actor, query: AuditQuery = {}): Promise<AuditPage> { assertAdmin(actor); const params=new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));return api<AuditPage>('audit-log?'+params); }
  snapshot(actor: Actor) { assertAdmin(actor); return structuredClone(this.current()); }
  async backup(actor: Actor) { assertAdmin(actor); return api<Database>('backup'); }
  previewClientImport(actor: Actor, rows: ClientImportRow[]) {
    assertAdmin(actor); const entities = this.current().entities;
    return planClientImport({ Cliente: entities.Cliente, Contacto: entities.Contacto, Sede: entities.Sede }, rows).rows;
  }
  importClients(actor: Actor, rows: ClientImportRow[], revision: number) { assertAdmin(actor); return this.mutate<string | undefined>({ action: 'importClients', rows, revision }); }
  importHistoricalReports(actor: Actor, payload: HistoricalReportsImport, revision: number) { assertAdmin(actor); return this.mutate<{ equipos: number; reportes: number; lecturas: number; lecturas_reutilizadas?: number; repetidos: number }>({ action: 'importHistoricalReports', payload, revision }); }
  submitReadings(payload: import('../domain/reading-submissions').ReadingSubmission, revision: number) { return this.mutate<{enviadas:number; repetidas:number}>({ action: 'submitReadings', payload, revision }); }
  reviewReading(decision: import('../domain/reading-submissions').ReadingDecision, revision: number) { return this.mutate<{revisadas:number}>({ action: 'reviewReading', decision, revision }); }
  changeOperationEquipment(_actor: Actor, correction: import('../domain/equipment-correction').EquipmentCorrection, revision: number) { return this.mutate<import('../domain/equipment-correction').EquipmentCorrectionSummary>({ action: 'changeOperationEquipment', correction, revision }); }
  async restore(actor: Actor, database: unknown, revision: number, exportedAt?: string) { assertAdmin(actor); await this.mutate({ action: 'restore', database, revision, exportedAt }); }
}
