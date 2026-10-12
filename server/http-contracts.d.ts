import type { Request, Response, RequestHandler } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { Actor } from '../src/domain/model.js';
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
  orderId?: string; requestId?: string; category?: string; name?: unknown; base64?: unknown;
}
export interface RestoreFileInput { metadata?: Partial<AttachmentMetadata>; base64?: unknown }
export interface AttachmentRestoreBody { file?: RestoreFileInput; allowOrphan?: boolean }
export interface MediaRestoreBody { file?: { metadata?: Partial<MediaMetadata>; base64?: unknown } }
export type AttachmentReply =
  | { files: Omit<AttachmentMetadata, "request_id">[]; nextCursor?: string | null }
  | { file: Pick<AttachmentMetadata, 'id' | 'order_id' | 'name' | 'mime' | 'size' | 'created_at'> & { category?: string } };
export interface RestoreReply { restored: boolean; duplicate: boolean; id: string }
export type MediaReply = { uploadId: string; reference: string } | { restored: boolean; duplicate: boolean };
