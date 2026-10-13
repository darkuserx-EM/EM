import {encryptionKey} from './totp.mjs';
import {verifyMfaConfiguration} from './mfa.mjs';
import { createApp } from './app.mjs';
import { connectDatabase, migrate } from './database.mjs';
import { logFailure } from './diagnostics.mjs';
import { startMaintenance } from './maintenance.mjs';
import { migrateLegacyMedia } from './media.mjs';
import { fileStoreFromEnv } from './file-storage.mjs';
const production = process.env.NODE_ENV !== 'development';
const origin = process.env.APP_ORIGIN || 'https://portal.expertosenmontacargas.com';
/** @type {import("mysql2/promise").Pool|undefined} */
let pool;
try {
  if (production && !origin.startsWith('https://')) throw Object.assign(new Error('APP_ORIGIN debe usar HTTPS.'), { code:'CONFIG_APP_ORIGIN' });
  pool = connectDatabase(process.env);
  await migrate(pool);
  await verifyMfaConfiguration(pool,encryptionKey(process.env.TOTP_ENCRYPTION_KEY));
  const app = createApp({pool,origin,setupToken:process.env.SETUP_TOKEN,production,trustProxy:process.env.TRUST_PROXY ?? '1',networkDiagnostics:process.env.ENABLE_NETWORK_DIAGNOSTICS === 'true',sessionIdleMinutes:process.env.SESSION_IDLE_MINUTES || '60',totpEncryptionKey:process.env.TOTP_ENCRYPTION_KEY,files:fileStoreFromEnv(pool,process.env)});
  const server = app.listen(Number(process.env.PORT || 3000),'0.0.0.0');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  console.log('Portal EM: servidor iniciado.');
  // Compatible reads serve old and new storage while bounded, atomic batches progress.
  const mediaMigration = migrateLegacyMedia(pool).then(result => console.log('Portal EM: migración de fotografías', result)).catch(error => logFailure(error,{event:'media.migration',status:500}));
  const stopMaintenance = startMaintenance(pool);
  const connectedPool=pool;
  const shutdown = () => server.close(async()=>{await stopMaintenance();await mediaMigration;await connectedPool.end();process.exit(0);});
  process.once('SIGTERM',shutdown); process.once('SIGINT',shutdown);
} catch (error) {
  logFailure(error, {event:'startup',status:500});
  if (pool) await pool.end();
  process.exitCode = 1;
}
