import { readSnapshot } from './database.mjs';

// A single unfiltered snapshot per process. Every response is filtered separately.
// MySQL remains authoritative; even an unchanged poll checks its revision.
export function createSnapshotCache(pool, { maxBytes = 32 * 1024 * 1024, load = () => readSnapshot(pool) } = {}) {
  let cached;
  let pending;
  let generation = 0;
  function publish(db) {
    generation++;
    cached = Buffer.byteLength(JSON.stringify(db)) <= maxBytes ? db : undefined;
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
