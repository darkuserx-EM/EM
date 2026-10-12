// Compile-only negative contracts. An unused expectation fails typecheck.
import type { Pool, PoolConnection } from 'mysql2/promise';
import { select, change } from '../sql.mjs';
import { appendAudit, migrateAuditStorage } from '../audit-storage.mjs';
import { attachmentBatches, manifestPage } from '../attachment-batches.mjs';
declare const pool: Pool;
declare const conn: PoolConnection;
const rows = await select<{ id: string; payload: string }>(conn, 'SELECT id,payload FROM em_records');
rows[0].payload.toUpperCase();
// @ts-expect-error Unselected columns are not implicitly any.
rows[0].password_hash;
// @ts-expect-error SQL values cannot be functions.
await change(conn, 'DELETE FROM em_sessions WHERE user_id=?', [() => 'id']);
// @ts-expect-error Audit writers require a transaction connection, not the pool.
await appendAudit(pool, []);
// @ts-expect-error Serialized payloads must be strings.
await appendAudit(conn, [{ id: 'a', payload: {} }]);
// @ts-expect-error Migration progress reports a number.
await migrateAuditStorage(pool, { afterBatch: ({ moved }: { moved: string }) => { void moved; } });
for await (const files of attachmentBatches(conn)) {
  files[0].content.equals(Buffer.alloc(0));
  // @ts-expect-error Attachment bytes are Buffer, not JSON text.
  files[0].content = 'base64';
}
const page = manifestPage({ cursor: 'invalid input remains validated at runtime' });
if (page?.cursor) {
  // @ts-expect-error Validated cursor contains a number then a string.
  const id: number = page.cursor[1];
  void id;
}
