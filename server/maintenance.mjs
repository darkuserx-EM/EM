import { cleanupExpired } from './database.mjs';
import { logFailure } from './diagnostics.mjs';
import { cleanupMediaUploads } from './media.mjs';

/** @param {import("mysql2/promise").Pool} pool @param {{intervalMs?:number,logger?:(line:string)=>void}} [options] */
export function startMaintenance(pool, { intervalMs = 15 * 60 * 1000, logger = console.error } = {}) {
  /** @type {Promise<unknown>|undefined} */
  let pending;
  const run = () => pending ?? (pending = cleanupExpired(pool).then(() => cleanupMediaUploads(pool)).then(()=>pool.execute('DELETE FROM em_mfa_challenges WHERE expires_at<=? LIMIT 500',[Date.now()]))
    .catch(error => logFailure(error, {event:'maintenance', status:500}, logger))
    .finally(() => { pending = undefined; }));
  const timer = setInterval(run, intervalMs); timer.unref();
  run();
  return async () => { clearInterval(timer); await pending; };
}
