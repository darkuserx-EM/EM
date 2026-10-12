import type { Pool, PoolConnection } from 'mysql2/promise';
import type { EntityName } from '../src/domain/model.js';

export type SqlConnection = Pool | PoolConnection;
export interface StoredPayload { id: string; payload: string }
export interface AttachmentMetadata {
  id: string; order_id: string; request_id: string; category: string; name: string;
  mime: string; size: number; sha256: string; uploaded_by: string; created_at: number;
}
export interface AttachmentFile extends AttachmentMetadata { content: Buffer }
export interface AuditPayload {
  id: string; codigo: string; fecha_creacion: string;
  entidad?: string; equipo_id?: string; hallazgo_id?: string; accion?: string;
}
export type WriteCommand =
  | { kind: 'upsert'; rows: [EntityName, string, string][] }
  | { kind: 'audit'; entries: StoredPayload[] }
  | { kind: 'remove'; entity: EntityName; ids: string[] };
