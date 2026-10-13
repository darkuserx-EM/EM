import type { Request, Response, RequestHandler } from 'express';
type ParamsDictionary = Record<string, string>;
import type { Actor, Database, EntityRecord, EntityName, Role, Scalar } from '../src/domain/model.js';
import type { ImportRow } from '../src/data/repository.js';
import type { ClientImportRow } from '../src/domain/client-import.js';
import type { HistoricalReportsImport } from '../src/data/historical-reports.js';
import type { AttachmentMetadata, MediaMetadata } from './contracts.js';

// Installed only by the authenticated /api middleware. Public handlers must not
// consume these fields before authentication; integration checks that boundary.
declare global {
  namespace Express {
    interface Request {
      actor: Actor;
      sessionHash: string;
      csrf: string;
      mustChangePassword: boolean;
    }
  }
}
export type PortalRequest<Body = unknown> = Request<ParamsDictionary, unknown, Body, Record<string, unknown>>;
export type PortalResponse<Body = unknown> = Response<Body>;
export type PortalMiddleware = RequestHandler<ParamsDictionary, unknown, unknown, Record<string, unknown>>;
export interface AttachmentBody {
  orderId?: string; ticketId?: string; requestId?: string; category?: string; name?: unknown; base64?: unknown;
}
export interface RestoreFileInput { metadata?: Partial<AttachmentMetadata>; base64?: unknown }
export interface AttachmentRestoreBody { file?: RestoreFileInput; allowOrphan?: boolean }
export interface MediaRestoreBody { file?: { metadata?: Partial<MediaMetadata>; base64?: unknown } }
export type AttachmentReply =
  | { files: Omit<AttachmentMetadata, "request_id">[]; nextCursor?: string | null }
  | { file: Pick<AttachmentMetadata, 'id' | 'order_id' | 'name' | 'mime' | 'size' | 'created_at'> & { category?: string } };
export interface RestoreReply { restored: boolean; duplicate: boolean; id: string }
export type MediaReply = { uploadId: string; reference: string } | { restored: boolean; duplicate: boolean };
export interface SessionBody { setupToken?: unknown; email?: unknown; name?: unknown; password?: unknown }
export interface AccountBody { currentPassword?: unknown; newPassword?: unknown; scope?: unknown }
export interface MfaBody { challenge?: unknown; code?: unknown; currentPassword?: unknown }
export interface AdminUserBody {
  email?: unknown; name?: unknown; role?: Role; days?: unknown; password?: unknown;
  requestId?: string; specialty?: unknown; technicianId?: string; clientId?: unknown; currentPassword?: unknown;
}
interface MutationCommon {
  revision: number; paged?: boolean; mediaUploads?: Record<string,string>;
  entity?: EntityName; fields?: Record<string,Scalar>;
}
export type MutationBody = MutationCommon & (
  | { action:'create'; entity:EntityName; fields:Record<string,Scalar> }
  | { action:'update'; entity:EntityName; id:string; fields:Record<string,Scalar> }
  | { action:'remove'; entity:EntityName; id:string }
  | { action:'import'; entity:EntityName; rows:ImportRow[] }
  | { action:'importClients'; rows:ClientImportRow[] }
  | { action:'importHistoricalReports'; payload:HistoricalReportsImport }
  | { action:'restore'; database:unknown; exportedAt?:string }
);
export interface AppOptions {
  pool: import('mysql2/promise').Pool; origin:string; setupToken?:string; production?:boolean;
  dist?:string; trustProxy?:string; networkDiagnostics?:boolean; logger?:(line:string)=>void;
  sessionIdleMinutes?:string; totpEncryptionKey?:string;
  files?:import('./file-storage.mjs').FileStore;
}
export type MfaReply = { ok:true; recoveryCodes?:string[] } | { secret:string; uri:string };
export type LoginReply = { ok:true } | { needsTotp:boolean; challenge:string };
export type PublicUser = Pick<import('./contracts.js').UserRow,
  'id'|'email'|'name'|'role'|'client_id'|'technician_id'|'active'|'expires_at'|'must_change_password'>;
export type AdminUserReply =
  | { users:PublicUser[] }
  | { id:string; email:string; password:string; expiresAt:number|null; technicianId:string|null; clientId:string|null }
  | { ok:boolean; email:string; password?:string; expiresAt?:number|null };
export interface AuditReply<Row> { rows:Row[]; nextCursor:string|null }
export interface PublicDatabase extends Database {
  syncToken:string; access:Actor; pagedEntities?:EntityName[]; counts?:Record<string,number>;
}
export interface MutationReply {
  result?: EntityRecord | ReturnType<import('../src/data/repository.js').LocalDataSource['importClients']>
    | ReturnType<import('../src/data/repository.js').LocalDataSource['importHistoricalReports']>;
  database:PublicDatabase;
}
