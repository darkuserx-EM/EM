import express from 'express';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalDataSource, STORAGE_KEY, filterVisible, entityNames, ValidationError } from './generated/domain.mjs';
import { readSnapshot, readDatabase, readEquipmentRecord, saveDatabase, consumeLoginAttempt } from './database.mjs';
import { hashPassword, verifyPassword, digest, equal, token, cookieToken } from './security.mjs';
import { presentDatabase, presentEquipment, resolveEquipmentImages, readEquipmentImage } from './equipment-images.mjs';
import { logFailure, parseTrustProxy } from './diagnostics.mjs';
import { createSnapshotCache } from './snapshot-cache.mjs';
import { registerAccountRoutes } from './account.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status, expose: true });
const syncToken = (revision, actor) => digest(JSON.stringify(['portal-sync-v1', revision, actor]));
const visible = (db, actor) => ({ ...presentDatabase({ ...db, entities: Object.fromEntries(entityNames.map(name => [name, filterVisible(actor, name, db.entities[name])])) }), syncToken: syncToken(db.revision, actor), access: actor });
const actorOf = user => ({ id: user.id, nombre: user.name, rol: user.role, cliente_id: user.client_id || undefined, tecnico_id: user.technician_id || undefined });
const cookieName = 'em_session';
const emailOf = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export function createApp({ pool, origin, setupToken, production = true, dist = resolve('dist'), trustProxy = '1', networkDiagnostics = false, logger = console.error }) {
  const app = express();
  app.set('portal production', production);
  app.disable('x-powered-by'); app.set('trust proxy', parseTrustProxy(String(trustProxy)));
  const snapshots = createSnapshotCache(pool);
  app.use(helmet({ strictTransportSecurity: production ? { maxAge: 31536000, includeSubDomains: false } : false, contentSecurityPolicy: { directives: { upgradeInsecureRequests: production ? [] : null } } }));
  app.use((_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
  app.use('/api', (_req,res,next) => { res.set('Cache-Control','no-store'); next(); });
  app.get('/api/health', async (_req,res) => { try { await pool.query('SELECT 1'); res.json({ status:'ok', database:'connected' }); } catch (error) {
    const reference = logFailure(error, { event:'health', status:503 }, logger);
    res.status(503).json({ status:'unavailable', reference });
  } });
  app.use('/api', rateLimit({ windowMs:60000, limit:240, standardHeaders:'draft-8', legacyHeaders:false, message:{error:'Demasiadas solicitudes. Intenta de nuevo en un minuto.'} }));
  app.use('/api', (req,_res,next) => {
    if (!['GET','HEAD'].includes(req.method) && (req.get('origin') !== origin || !req.is('application/json'))) return next(fail(403,'La solicitud debe realizarse desde el portal.'));
    next();
  });
  const smallJson = express.json({ limit:'100kb' });
  const loginLimit = rateLimit({ windowMs:900000, limit:30, standardHeaders:'draft-8', legacyHeaders:false, message:{error:'Demasiados intentos. Espera 15 minutos.'} });
  app.get('/api/setup-status', async (_req,res) => { const [rows] = await pool.query('SELECT COUNT(*) AS n FROM em_users'); res.json({ needsSetup:Number(rows[0].n) === 0 }); });
  app.post('/api/setup', loginLimit, smallJson, async (req,res) => {
    if (!setupToken || setupToken.length < 32 || !equal(req.body?.setupToken,setupToken)) throw fail(403,'La clave de instalación no es válida.');
    const email = emailOf(req.body.email);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || !name || name.length>160) throw fail(400,'Indica nombre y correo válidos.');
    if (typeof req.body.password !== 'string' || req.body.password.length < 14 || req.body.password.length > 128) throw fail(400,'Usa una contraseña de entre 14 y 128 caracteres.');
    const passwordHash = await hashPassword(req.body.password);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE');
      const [users] = await conn.query('SELECT COUNT(*) AS n FROM em_users');
      if (Number(users[0].n)) throw fail(409,'La cuenta inicial ya existe. Inicia sesión.');
      await conn.execute('INSERT INTO em_users (id,email,name,role,password_hash) VALUES (?,?,?,?,?)',[randomUUID(),email,name,'Administrador',passwordHash]);
      await conn.commit(); res.status(201).json({created:true});
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });
  app.post('/api/login', loginLimit, smallJson, async (req,res) => {
    const email = emailOf(req.body?.email);
    if (!email || email.length>254 || typeof req.body.password !== 'string' || req.body.password.length>128) throw fail(401,'Correo o contraseña incorrectos.');
    const attemptKey = digest(JSON.stringify(['login-v2',email,ipKeyGenerator(req.ip)]));
    if (!await consumeLoginAttempt(pool,attemptKey)) throw fail(429,'Demasiados intentos. Espera 15 minutos.');
    const [rows] = await pool.execute('SELECT * FROM em_users WHERE email=? AND active=TRUE',[email]);
    // Derive even for an unknown account to avoid fast username enumeration.
    const dummy = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
    if (!await verifyPassword(req.body.password,rows[0]?.password_hash || dummy) || !rows[0]) throw fail(401,'Correo o contraseña incorrectos.');
    const session = token();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [current] = await conn.execute('SELECT id,password_hash,active FROM em_users WHERE id=? FOR UPDATE',[rows[0].id]);
      if (!current[0]?.active || current[0].password_hash !== rows[0].password_hash) throw fail(401,'Correo o contraseña incorrectos.');
      await conn.execute('INSERT INTO em_sessions (token_hash,user_id,csrf,expires_at) VALUES (?,?,?,?)',[digest(session),rows[0].id,token(),Date.now()+8*3600000]);
      await conn.execute('DELETE FROM em_login_limits WHERE bucket=?',[attemptKey]);
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    res.cookie(cookieName,session,{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge:8*3600000});
    res.json({ok:true});
  });
  app.use('/api', async (req,_res,next) => {
    const session = cookieToken(req.headers.cookie,cookieName);
    if (!session || session.length>128) throw fail(401,'Inicia sesión para continuar.');
    const [rows] = await pool.execute('SELECT s.csrf, s.token_hash, u.* FROM em_sessions s JOIN em_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=TRUE',[digest(session),Date.now()]);
    if (!rows[0]) throw fail(401,'Tu sesión terminó. Vuelve a ingresar.');
    req.actor = actorOf(rows[0]); req.sessionHash = rows[0].token_hash; req.csrf = rows[0].csrf;
    if (!['GET','HEAD'].includes(req.method) && !equal(req.get('x-csrf-token'),req.csrf)) throw fail(403,'La sesión de esta solicitud no es válida. Recarga el portal.');
    next();
  });
  app.get('/api/session', (req,res) => res.json({actor:req.actor,csrf:req.csrf}));
  // Small authenticated requests are parsed only after session and CSRF checks.
  app.use('/api', (req,res,next) => req.path === '/mutate' && req.method === 'POST' ? next() : smallJson(req,res,next));
  registerAccountRoutes(app, pool);
  app.post('/api/logout', async (req,res) => { await pool.execute('DELETE FROM em_sessions WHERE token_hash=?',[req.sessionHash]); res.clearCookie(cookieName,{path:'/',secure:production,httpOnly:true,sameSite:'strict'}); res.json({ok:true}); });
  app.get('/api/database', async (req,res) => {
    const [rows] = await pool.query('SELECT revision FROM em_meta WHERE id=1');
    const revision = Number(rows[0].revision);
    if (req.query.since === syncToken(revision, req.actor)) return res.status(204).end();
    res.json(visible(await snapshots.read(revision),req.actor));
  });
  if (networkDiagnostics) app.get('/api/diagnostico/red', (req,res) => {
    if (req.actor.rol !== 'Administrador') throw fail(403,'Esta acción está disponible solo para administración.');
    res.json({ ip:req.ip, ips:req.ips, socket:req.socket.remoteAddress, xForwardedFor:req.get('x-forwarded-for')?.slice(0,512) ?? null, trustProxy:req.app.get('trust proxy') });
  });
  app.get('/api/backup', async (req,res) => {
    if (req.actor.rol !== 'Administrador') throw fail(403,'Esta acción está disponible solo para administración.');
    res.json(await readSnapshot(pool));
  });
  app.post('/api/equipment-export', async (req,res) => {
    if (req.actor.rol !== 'Administrador') throw fail(403,'Esta acción está disponible solo para administración.');
    if (!Array.isArray(req.body.ids) || req.body.ids.length > 2000 || req.body.ids.some(id => typeof id !== 'string')) throw fail(400,'Selección de equipos inválida.');
    const ids = new Set(req.body.ids); const db = await readSnapshot(pool);
    res.json({ rows: db.entities.Equipo.filter(row => ids.has(row.id)) });
  });
  app.get('/api/equipment-images/:id/:field/:hash', async (req,res) => {
    const equipment = await readEquipmentRecord(pool,req.params.id);
    const row = equipment && filterVisible(req.actor,'Equipo',[equipment])[0];
    const image = readEquipmentImage(row,req.params.field,req.params.hash);
    if (!image) throw fail(404,'Imagen no disponible.');
    res.type(image.type).send(image.bytes);
  });
  app.post('/api/mutate', (req,_res,next) => {
    if (req.actor.rol !== 'Administrador') return next(fail(403,'Esta acción está disponible solo para administración.'));
    next();
  }, express.json({ limit:'32mb' }), async (req,res) => {
    const body = req.body;
    if (!body || !Number.isSafeInteger(body.revision) || !['create','update','remove','import','importClients','importHistoricalReports','restore'].includes(body.action)) throw fail(400,'Operación inválida.');
    if (!['importClients','importHistoricalReports','restore'].includes(body.action) && !['Cliente','Contacto','Sede','Equipo','Catalogos','Hallazgo','PlanPM'].includes(body.entity)) throw fail(400,'Entidad no editable.');
    if (['import','importClients'].includes(body.action) && (!Array.isArray(body.rows) || body.rows.length>2000)) throw fail(400,'Importa un máximo de 2000 filas.');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction(); const db = await readDatabase(conn,true);
      if (body.revision !== db.revision) throw fail(409,'Los datos cambiaron en otro dispositivo. Recarga y revisa antes de guardar.');
      // Existing images stay in MySQL while the shared domain edits compact references.
      // Resolve them against this locked snapshot before saving; never concatenate
      // every existing photo into the domain's intermediate JSON string.
      let saved = JSON.stringify(presentDatabase(db));
      const source = new LocalDataSource({getItem:key=>key===STORAGE_KEY?saved:null,setItem:(_key,value)=>{saved=value;}},{demoHistory:false,maxRows:Infinity});
      let result;
      try {
        if (body.action==='importClients') result = source.importClients(req.actor,body.rows,db.revision);
        else if (body.action==='importHistoricalReports') result = source.importHistoricalReports(req.actor,body.payload,db.revision);
        else if (body.action==='restore') source.restore(req.actor,body.database,db.revision,body.exportedAt);
        else {
          const repo = source.repository(body.entity,req.actor);
          if (body.action==='create') result = await repo.create(body.fields);
          if (body.action==='update') result = await repo.update(body.id,body.fields);
          if (body.action==='remove') await repo.remove(body.id);
          if (body.action==='import') await repo.import(body.rows,db.revision);
        }
      } catch (error) { if (error instanceof ValidationError) throw fail(400,error.message); throw error; }
      const next = JSON.parse(saved);
      try { resolveEquipmentImages(next,db); } catch (error) { if (error instanceof ValidationError) throw fail(400,error.message); throw error; }
      await saveDatabase(conn,next,db); await conn.commit(); snapshots.publish(next);
      res.json({result:body.entity === 'Equipo' && result ? presentEquipment(next.entities.Equipo.find(row => row.id === result.id)) : result,database:visible(next,req.actor)});
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });
  app.use('/api', (_req,_res,next)=>next(fail(404,'Ruta no encontrada.')));
  app.use(express.static(dist,{index:false,dotfiles:'deny',setHeaders:(res,path)=>res.set('Cache-Control',path.includes('/assets/')?'public,max-age=31536000,immutable':'no-cache')}));
  app.get('/{*path}', (_req,res)=>{res.set('Cache-Control','no-cache');res.sendFile(resolve(dist,'index.html'));});
  app.use((error,req,res,_next)=>{
    if (error.type === 'entity.too.large') return res.status(413).json({error:'El envío supera el tamaño permitido. Reduce los adjuntos o el archivo.'});
    if (error.type === 'entity.parse.failed') return res.status(400).json({error:'La solicitud no contiene un JSON válido.'});
    if (error.expose === true && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) return res.status(error.status).json({error:error.message});
    const reference = logFailure(error, { event:'request', method:req.method, route:req.route?.path || '(middleware)', status:500 }, logger);
    res.status(500).json({error:`El servicio no está disponible. Intenta nuevamente en unos minutos. Referencia: ${reference}`,reference});
  });
  return app;
}
