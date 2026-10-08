import { createApp } from './app.mjs';
import { connectDatabase, migrate } from './database.mjs';
import { logFailure } from './diagnostics.mjs';
import { startMaintenance } from './maintenance.mjs';
const production = process.env.NODE_ENV !== 'development';
const origin = process.env.APP_ORIGIN || 'https://portal.expertosenmontacargas.com';
let pool;
try {
  if (production && !origin.startsWith('https://')) throw Object.assign(new Error('APP_ORIGIN debe usar HTTPS.'), { code:'CONFIG_APP_ORIGIN' });
  pool = connectDatabase(process.env);
  await migrate(pool);
  const app = createApp({pool,origin,setupToken:process.env.SETUP_TOKEN,production,trustProxy:process.env.TRUST_PROXY ?? '1',networkDiagnostics:process.env.ENABLE_NETWORK_DIAGNOSTICS === 'true'});
  const server = app.listen(Number(process.env.PORT || 3000),'0.0.0.0');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  console.log('Portal EM: servidor iniciado.');
  const stopMaintenance = startMaintenance(pool);
  const shutdown = () => server.close(async()=>{await stopMaintenance();await pool.end();process.exit(0);});
  process.once('SIGTERM',shutdown); process.once('SIGINT',shutdown);
} catch (error) {
  logFailure(error, {event:'startup',status:500});
  if (pool) await pool.end();
  process.exitCode = 1;
}
