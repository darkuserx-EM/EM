import type { Pool, PoolConnection } from 'mysql2/promise';
import type { Express } from 'express';
import type { Actor } from '../../src/domain/model.js';
import type { MutationBody, PortalRequest, MfaBody, MfaReply, PortalResponse } from '../http-contracts.js';
import { createApp } from '../app.mjs';
import { registerAccountRoutes } from '../account.mjs';
import { registerAdminUserRoutes } from '../admin-users.mjs';
import { registerAuditRoutes } from '../audit-log.mjs';
import { mfaChallenge, registerMfaRoutes } from '../mfa.mjs';
import { operationPage } from '../operation-pages.mjs';
import { startMaintenance } from '../maintenance.mjs';
import { oneOf } from '../guards.mjs';
declare const pool: Pool;
declare const conn: PoolConnection;
declare const app: Express;
declare const actor: Actor;
// @ts-expect-error Startup requires a connection pool, not an individual connection.
createApp({ pool: conn, origin: 'https://example.test' });
// @ts-expect-error Account routes own transactions via a pool.
registerAccountRoutes(app, conn);
// @ts-expect-error Administration options do not accept a substituted actor.
registerAdminUserRoutes(app, { pool, actor });
// @ts-expect-error Audit routes need a real pool.
registerAuditRoutes(app, { execute: () => [] });
// @ts-expect-error MFA challenges bind to a password version.
await mfaChallenge(conn, { id: 'user' });
// @ts-expect-error Encryption uses bytes, never an unparsed secret string.
registerMfaRoutes(app, { pool, key: 'secret' });
declare const request: PortalRequest<MfaBody>;
// @ts-expect-error An untrusted code must be checked before string operations.
request.body.code.trim();
declare const response: PortalResponse<MfaReply>;
// @ts-expect-error Setup responses require both secret and URI.
response.json({ secret: 'secret' });
// @ts-expect-error Operational pages share one transaction/revision.
await operationPage(pool, actor, 'Ticket', {}, 1);
// @ts-expect-error An operational actor cannot have an invented role.
await operationPage(conn, { ...actor, rol: 'Root' }, 'Ticket', {}, 1);
// @ts-expect-error Updates require an identity and fields.
const missing: MutationBody = { action: 'update', entity: 'Equipo', revision: 1 };
void missing;
// @ts-expect-error Record fields cannot hide nested JSON.
const nested: MutationBody = { action: 'create', entity: 'Ticket', revision: 1, fields: { hidden: {} } };
void nested;
// @ts-expect-error Maintenance intervals are numeric milliseconds.
startMaintenance(pool, { intervalMs: '15 minutes' });
const raw: unknown = 'Cliente';
if (oneOf(['Cliente','Técnico'], raw)) {
  const role: 'Cliente'|'Técnico' = raw;
  void role;
}
