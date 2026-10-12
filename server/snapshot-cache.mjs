import { readSnapshot } from './database.mjs';

// A single unfiltered snapshot per process. Every response is filtered separately.
// MySQL remains authoritative; even an unchanged poll checks its revision.
export function snapshotByteSize(db, maxBytes = Infinity) {
  const { entities = {}, ...metadata } = db;
  let bytes = Buffer.byteLength(JSON.stringify({ ...metadata, entities: {} }));
  let firstEntity = true;
  for (const [name, rows] of Object.entries(entities)) {
    bytes += (firstEntity ? 0 : 1) + Buffer.byteLength(JSON.stringify(name)) + 3; // key:[]
    firstEntity = false;
    if (bytes > maxBytes) return bytes;
    for (let i = 0; i < rows.length; i++) {
      bytes += (i ? 1 : 0) + Buffer.byteLength(JSON.stringify(rows[i]));
      if (bytes > maxBytes) return bytes;
    }
  }
  return bytes;
}
export function createSnapshotCache(pool, { maxBytes = 32 * 1024 * 1024, load = () => readSnapshot(pool,{includeAudit:false}), sizeOf = snapshotByteSize } = {}) {
  let cached;
  let pending;
  let generation = 0;
  function publish(db) {
    generation++;
    // Retaining a cache is best effort, including after a committed write.
    // Measure UTF-8 bytes one row at a time and stop once retention is ruled out.
    try { cached = sizeOf(db, maxBytes) <= maxBytes ? db : undefined; }
    catch { cached = undefined; }
  }
  async function read(revision) {
    if (cached?.revision === revision) return cached;
    if (!pending) {
      const started = generation;
      pending = load().then(db => {
        if (started === generation) publish(db);
        return db;
      }).finally(() => { pending = undefined; });
    }
    const db = await pending;
    if (cached && cached.revision >= revision && cached.revision >= db.revision) return cached;
    // A shared read may have started before the revision this caller observed.
    if (db.revision < revision) return read(revision);
    return db;
  }
  return { read, publish };
}
