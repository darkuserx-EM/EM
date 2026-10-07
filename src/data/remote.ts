import type { Actor, Database, EntityName, EntityRecord, Scalar } from '../domain/model';
import { assertAdmin } from '../domain/permissions';
import { planClientImport, type ClientImportRow } from '../domain/client-import';
import type { Repository } from './repository';

let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(),30000);
  let response: Response; let data: unknown;
  try {
    response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body),signal:controller.signal });
    if (response.status === 401 && !['login','session'].includes(path)) window.dispatchEvent(new Event('portal-session-expired'));
    try { data = await response.json(); }
    catch {
      throw new Error(response.status === 401 ? 'Tu sesión terminó. Vuelve a ingresar.' : `No recibimos una respuesta válida del servidor (HTTP ${response.status}). ${body === undefined ? 'Intenta actualizar la página.' : 'Tus campos siguen en el formulario. Comprueba la lista antes de volver a guardar para evitar duplicados.'}`);
    }
  } catch (error) {
    if (controller.signal.aborted || error instanceof TypeError) throw new Error(body === undefined ? 'No se pudo conectar con el portal. Revisa tu conexión e intenta nuevamente.' : 'No recibimos confirmación del guardado. Tus campos siguen en el formulario; comprueba la lista antes de repetirlo para evitar duplicados.');
    throw error;
  } finally { clearTimeout(timeout); }
  if (!data || typeof data !== 'object') throw new Error('La respuesta del servidor está incompleta. Actualiza la página antes de continuar.');
  if (!response.ok) {
    throw Object.assign(new Error(('error' in data && typeof data.error === 'string' && data.error) || 'No se pudo completar la solicitud.'), { status: response.status });
  }
  return data as T;
}
export class RemoteDataSource {
  private database?: Database;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRevision = () => this.database?.revision ?? -1;
  private accept(db: Database) { if (!this.database || db.revision >= this.database.revision) { this.database = db; this.listeners.forEach(listener => listener()); } }
  clear() { this.database = undefined; csrf = ''; }
  async refresh() { this.accept(await api<Database>('database')); }
  private current() { if (!this.database) throw new Error('Espera a que termine la conexión al servidor.'); return this.database; }
  private async mutate<T>(body: Record<string, unknown>): Promise<T> {
    try { const response = await api<{ database: Database; result: T }>('mutate', { revision: this.getRevision(), ...body }); this.accept(response.database); return response.result; }
    catch (error) { if ((error as { status?: number }).status === 409) await this.refresh(); throw error; }
  }
  repository(entity: EntityName, actor: Actor): Repository {
    const getAll = async () => structuredClone(this.current().entities[entity]);
    return {
      getAll, getById: async id => (await getAll()).find(row => row.id === id),
      export: async predicate => { assertAdmin(actor); return (await getAll()).filter(predicate || (() => true)); },
      create: async (fields: Record<string, Scalar>) => { assertAdmin(actor); return this.mutate<EntityRecord>({ action: 'create', entity, fields }); },
      update: async (id, fields) => { assertAdmin(actor); return this.mutate<EntityRecord>({ action: 'update', entity, id, fields }); },
      remove: async id => { assertAdmin(actor); await this.mutate({ action: 'remove', entity, id }); },
      import: async (rows, revision) => { assertAdmin(actor); await this.mutate({ action: 'import', entity, rows, revision }); },
    };
  }
  snapshot(actor: Actor) { assertAdmin(actor); return structuredClone(this.current()); }
  previewClientImport(actor: Actor, rows: ClientImportRow[]) {
    assertAdmin(actor); const entities = this.current().entities;
    return planClientImport({ Cliente: entities.Cliente, Contacto: entities.Contacto, Sede: entities.Sede }, rows).rows;
  }
  importClients(actor: Actor, rows: ClientImportRow[], revision: number) { assertAdmin(actor); return this.mutate<string | undefined>({ action: 'importClients', rows, revision }); }
  async restore(actor: Actor, database: unknown, revision: number) { assertAdmin(actor); await this.mutate({ action: 'restore', database, revision }); }
}
