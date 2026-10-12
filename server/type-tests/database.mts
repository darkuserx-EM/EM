import type { Pool, PoolConnection } from 'mysql2/promise';
import type { Database } from '../../src/domain/model.js';
import { prepareDatabaseWrite, readDatabase, readSnapshot } from '../database.mjs';
import { indexOperations } from '../operation-index.mjs';
import { createSnapshotCache } from '../snapshot-cache.mjs';
import { presentDatabase, readEquipmentImage } from '../equipment-images.mjs';
import { errorCode, errorField } from '../errors.mjs';
import { logFailure } from '../diagnostics.mjs';
declare const pool: Pool;
declare const conn: PoolConnection;
declare const db: Database;
// @ts-expect-error Invalid entity collections cannot be persisted.
prepareDatabaseWrite({ ...db, entities: { Equipo: [] } });
const write = prepareDatabaseWrite(db);
// @ts-expect-error Commit plans require the same transaction connection.
await write(pool);
// @ts-expect-error Unknown entities cannot enter the operation projection.
await indexOperations(conn, [{ entity: 'ClienteInexistente', row: db.entities.Equipo[0] }]);
// @ts-expect-error Snapshot readers need a pool to own their transaction.
await readSnapshot(conn);
// @ts-expect-error Audit inclusion is a boolean option.
await readDatabase(conn, false, { includeAudit: 'false' });
const cache = createSnapshotCache(pool);
// @ts-expect-error An asynchronous commit cannot be replaced with a scalar.
await cache.publishAfterCommit(db, () => 1);
// @ts-expect-error Cache generations are numeric revisions.
await cache.peek('1');
// @ts-expect-error Image presentation preserves the database contract.
presentDatabase({ entities: {} });
// @ts-expect-error An image response does not guarantee a match.
readEquipmentImage(undefined, 'foto_equipo', 'hash').bytes;
const failure: unknown = { code: 'ER_DUP_ENTRY', sql: 'private' };
errorCode(failure)?.toUpperCase();
// @ts-expect-error Unknown error fields must be narrowed before use.
errorField(failure, 'sql').toUpperCase();
// @ts-expect-error Log status must be a numeric HTTP status.
logFailure(failure, { event: 'test', status: '500' });
