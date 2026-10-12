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
  const publishing=new Map();
  let generation = 0;
  function publish(db) {
    if(cached && cached.revision>db.revision)return;
    generation++;
    // Retaining a cache is best effort, including after a committed write.
    // Measure UTF-8 bytes one row at a time and stop once retention is ruled out.
    try { cached = sizeOf(db, maxBytes) <= maxBytes ? db : undefined; }
    catch { cached = undefined; }
  }
  async function publishAfterCommit(db,commit) {
    let finish;
    const ready=new Promise(resolve=>{finish=resolve;});
    publishing.set(db.revision,ready);
    try {await commit();publish(db);}
    finally {finish();if(publishing.get(db.revision)===ready)publishing.delete(db.revision);}
  }
  async function peek(revision) {
    // MySQL may grant the next writer's lock before delivering COMMIT's reply
    // here. Wait for that publication, never expose an uncommitted snapshot.
    await publishing.get(revision);
    return cached?.revision===revision ? cached : undefined;
  }
  async function read(revision) {
    if(publishing.has(revision))await publishing.get(revision);
    if(cached?.revision===revision)return cached;
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
  return { read, publish, peek, publishAfterCommit };
}
