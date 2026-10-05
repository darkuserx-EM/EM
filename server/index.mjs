import { createApp } from './app.mjs';
import { connectDatabase, migrate } from './database.mjs';
const production = process.env.NODE_ENV !== 'development';
const origin = process.env.APP_ORIGIN || 'https://portal.expertosenmontacargas.com';
if (production && !origin.startsWith('https://')) throw new Error('APP_ORIGIN debe usar HTTPS.');
let pool;
try {
  pool = connectDatabase(process.env);
  await migrate(pool);
  const app = createApp({pool,origin,setupToken:process.env.SETUP_TOKEN,production});
  const server = app.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log('Portal EM: servidor iniciado.'));
  process.on('SIGTERM',()=>server.close(async()=>{await pool.end();process.exit(0);}));
} catch {
  console.error('Portal EM: no se pudo iniciar. Revisa las variables DB_* y la disponibilidad de MySQL.');
  if (pool) await pool.end();
  process.exitCode = 1;
}
