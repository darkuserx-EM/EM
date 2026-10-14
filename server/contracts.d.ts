import type { Pool, PoolConnection } from 'mysql2/promise';
import type { EntityName, EntityRecord, Role } from '../src/domain/model.js';

export type SqlConnection = Pool | PoolConnection;
export interface StoredPayload { id: string; payload: string }
export interface AttachmentMetadata {
  id: string; order_id: string; ticket_id?: string | null; request_id: string; category: string; name: string;
  mime: string; size: number; sha256: string; uploaded_by: string; created_at: number;
}
export interface AttachmentFile extends AttachmentMetadata { content: Buffer; storage_key?: string | null }
export interface MediaMetadata {
  equipment_id: string; field: string; hash: string; mime: string; size: number;
  sha256: string; uploaded_by: string; created_at: number;
}
export interface MediaFile extends MediaMetadata { content: Buffer; thumbnail: Buffer | null; storage_key?: string | null; thumbnail_key?: string | null }
export interface MediaUpload extends Omit<MediaFile, 'equipment_id'> {
  id: string; equipment_id: string | null; expires_at: number;
}
export interface UserRow {
  id: string; email: string; name: string; role: Role; password_hash: string;
  client_id: string | null; technician_id: string | null; active: number;
  expires_at: number | null; must_change_password: number; creation_request: string | null;
  totp_enabled: number; totp_secret: string | null; totp_pending: string | null;
  totp_pending_expires: number | null; totp_last_step: number | null;
}
export interface SessionUserRow extends UserRow {
  csrf: string; token_hash: string; last_seen_at: number | null; session_expires_at: number;
}
export interface ChallengeRow {
  token_hash: string; user_id: string; password_version: string; expires_at: number; attempts: number;
}
export interface SecurityEventRow {
  id: string; actor_id: string; target_id: string; action: string; created_at: number;
  actor_name: string | null; actor_email: string | null; target_name: string | null; target_email: string | null;
}
export interface AuditPayload {
  id: string; codigo: string; fecha_creacion: string;
  entidad?: string; equipo_id?: string; hallazgo_id?: string; accion?: string;
}
export type WriteCommand =
  | { kind: 'upsert'; rows: [EntityName, string, string][] }
  | { kind: 'audit'; entries: StoredPayload[] }
  | { kind: 'remove'; entity: EntityName; ids: string[] };
export type FullBackupEntry =
  | { type: 'portal-em.full'; version: 1; schemaVersion: 1; revision: number; exportedAt: string }
  | { type: 'record'; entity: EntityName; record: EntityRecord }
  | { type: 'media'; file: { metadata: MediaMetadata; base64: string } }
  | { type: 'attachment'; file: { metadata: AttachmentMetadata; base64: string } };
