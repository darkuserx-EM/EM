import { cleanupExpired } from './database.mjs';
import { logFailure } from './diagnostics.mjs';

export function startMaintenance(pool, { intervalMs = 15 * 60 * 1000, logger = console.error } = {}) {
  let pending;
  const run = () => pending ?? (pending = cleanupExpired(pool)
    .catch(error => logFailure(error, {event:'maintenance', status:500}, logger))
    .finally(() => { pending = undefined; }));
  const timer = setInterval(run, intervalMs); timer.unref();
  run();
  return async () => { clearInterval(timer); await pending; };
}
