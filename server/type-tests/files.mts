import type { Pool, PoolConnection } from 'mysql2/promise';
import type { MediaFile, FullBackupEntry } from '../contracts.js';
import type { PortalResponse, MediaReply } from '../http-contracts.js';
import { prepareMedia, storeMedia, hydrateEquipment } from '../media.mjs';
import { decodeAttachment } from '../attachments.mjs';
import { validateRestoreFile, writeLine } from '../attachment-backup.mjs';
import { fullBackupEntries } from '../full-backup.mjs';
declare const pool: Pool;
declare const conn: PoolConnection;
declare const file: MediaFile;
// @ts-expect-error Media writes participate in a transaction.
await storeMedia(pool, file);
// @ts-expect-error Content is binary, not a serialized file.
await storeMedia(conn, { ...file, content: 'base64' });
// @ts-expect-error MIME is a header string, not a numeric value.
await prepareMedia(Buffer.alloc(12), 123);
// @ts-expect-error Equipment hydration requires full records.
await hydrateEquipment(pool, [{ id: 'equipment' }]);
// @ts-expect-error Attachment category is a string, validated at runtime.
decodeAttachment({ category: 12 });
// @ts-expect-error Original creation time is numeric.
validateRestoreFile({ metadata: { created_at: 'yesterday' } });
// @ts-expect-error Streaming requires an HTTP response, not a plain writer.
await writeLine({ write: () => true }, {});
// @ts-expect-error A full backup must own one consistent transaction.
fullBackupEntries(pool);
declare const entry: FullBackupEntry;
if (entry.type === 'media') {
  // @ts-expect-error Media metadata cannot be mistaken for attachment metadata.
  entry.file.metadata.order_id;
}
declare const response: PortalResponse<MediaReply>;
// @ts-expect-error Upload responses cannot omit their identity.
response.json({ reference: 'media:hash' });
