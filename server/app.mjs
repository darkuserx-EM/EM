import express from 'express';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalDataSource, STORAGE_KEY, filterVisible, entityNames, ValidationError } from './generated/domain.mjs';
import { readSnapshot, readDatabase, readEquipmentRecord, saveDatabase, consumeLoginAttempt } from './database.mjs';
import { hashPassword, verifyPassword, digest, equal, token, cookieToken } from './security.mjs';
import { presentDatabase, presentEquipment, readEquipmentImage } from './equipment-images.mjs';
import { logFailure, parseTrustProxy } from './diagnostics.mjs';
import { createSnapshotCache } from './snapshot-cache.mjs';
import { registerAccountRoutes } from './account.mjs';
import { registerAdminUserRoutes } from './admin-users.mjs';
import { registerAttachmentRoutes } from './attachments.mjs';
import { registerAttachmentBackupRoutes } from './attachment-backup.mjs';
import { registerMediaUploadRoutes, persistEquipmentMedia, hydrateEquipment } from './media.mjs';
import { registerFullBackupRoutes } from './full-backup.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status, expose: true });
const syncToken = (revision, actor) => digest(JSON.stringify(['portal-sync-v1', revision, actor]));
const visible = (db, actor) => ({ ...presentDatabase({ ...db, entities: Object.fromEntries(entityNames.map(name => [name, filterVisible(actor, name, db.entities[name], db.entities)])) }), syncToken: syncToken(db.revision, actor), access: actor });
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
  app.get('/api/health', async (_req,res) => { try { await pool.query('SELECT 1'); res.json({ status:'ok', database:'connected', release:'0.3.0' }); } catch (error) {
    const reference = logFailure(error, { event:'health', status:503 }, logger);
    res.status(503).json({ status:'unavailable', reference });
  } });
  app.use('/api', rateLimit({ windowMs:60000, limit:240, standardHeaders:'draft-8', legacyHeaders:false, message:{error:'Demasiadas solicitudes. Intenta de nuevo en un minuto.'} }));
  app.use('/api', (req,_res,next) => {
    const imageUpload = req.method === 'POST' && req.path === '/equipment-media/upload' && ['image/png','image/jpeg','image/webp'].includes(req.get('content-type'));
    if (!['GET','HEAD'].includes(req.method) && (req.get('origin') !== origin || (!req.is('application/json') && !imageUpload))) return next(fail(403,'La solicitud debe realizarse desde el portal.'));
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
    const [rows] = await pool.execute('SELECT * FROM em_users WHERE email=? AND active=TRUE AND (expires_at IS NULL OR expires_at>?)',[email,Date.now()]);
    // Derive even for an unknown account to avoid fast username enumeration.
    const dummy = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
    if (!await verifyPassword(req.body.password,rows[0]?.password_hash || dummy) || !rows[0]) throw fail(401,'Correo o contraseña incorrectos.');
    const session = token();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [current] = await conn.execute('SELECT id,password_hash,active,expires_at FROM em_users WHERE id=? FOR UPDATE',[rows[0].id]);
      if (!current[0]?.active || (current[0].expires_at && Number(current[0].expires_at) <= Date.now()) || current[0].password_hash !== rows[0].password_hash) throw fail(401,'Correo o contraseña incorrectos.');
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
    const [rows] = await pool.execute('SELECT s.csrf, s.token_hash, u.* FROM em_sessions s JOIN em_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=TRUE AND (u.expires_at IS NULL OR u.expires_at>?)',[digest(session),Date.now(),Date.now()]);
    if (!rows[0]) throw fail(401,'Tu sesión terminó. Vuelve a ingresar.');
    req.actor = actorOf(rows[0]); req.sessionHash = rows[0].token_hash; req.csrf = rows[0].csrf;
    req.mustChangePassword = Boolean(rows[0].must_change_password);
    if (!['GET','HEAD'].includes(req.method) && !equal(req.get('x-csrf-token'),req.csrf)) throw fail(403,'La sesión de esta solicitud no es válida. Recarga el portal.');
    if (req.mustChangePassword && !['/session','/password','/logout'].includes(req.path)) return _res.status(403).json({error:'Debes cambiar tu contraseña temporal antes de continuar.',code:'PASSWORD_CHANGE_REQUIRED'});
    next();
  });
  app.get('/api/session', (req,res) => res.json({actor:req.actor,csrf:req.csrf,mustChangePassword:req.mustChangePassword}));
  // Small authenticated requests are parsed only after session and CSRF checks.
  app.use('/api', (req,res,next) => ['/mutate','/attachments','/admin/attachments/restore','/equipment-media/upload','/admin/media/restore'].includes(req.path) && req.method === 'POST' ? next() : smallJson(req,res,next));
  registerAccountRoutes(app, pool);
  registerAdminUserRoutes(app, {pool,smallJson,logger});
  registerAttachmentRoutes(app, {pool,smallJson,logger});
  registerAttachmentBackupRoutes(app, {pool,logger});
  registerMediaUploadRoutes(app, {pool});
  registerFullBackupRoutes(app, {pool,logger});
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
    const db = await readSnapshot(pool);
    db.entities.Equipo = await hydrateEquipment(pool,db.entities.Equipo);
    res.json(db);
  });
  app.post('/api/equipment-export', async (req,res) => {
    if (req.actor.rol !== 'Administrador') throw fail(403,'Esta acción está disponible solo para administración.');
    if (!Array.isArray(req.body.ids) || req.body.ids.length > 2000 || req.body.ids.some(id => typeof id !== 'string')) throw fail(400,'Selección de equipos inválida.');
    const ids = new Set(req.body.ids); const db = await readSnapshot(pool);
    const imageFields = ['foto_equipo','placa_datos','foto_frontal','foto_trasera','foto_lateral_1','foto_lateral_2'];
    res.json({ rows: db.entities.Equipo.filter(row => ids.has(row.id)).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !imageFields.includes(key)))), includesImages: false });
  });
  app.get('/api/equipment-images/:id/:field/:hash', async (req,res) => {
    const equipment = await readEquipmentRecord(pool,req.params.id);
    let scope;
    if (equipment && req.actor.rol === 'Técnico' && req.actor.tecnico_id) {
      const [orders] = await pool.execute("SELECT payload FROM em_records WHERE entity='OrdenServicio' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.equipo_id'))=? AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.tecnico_id'))=?", [equipment.id,req.actor.tecnico_id]);
      scope = { OrdenServicio: orders.map(order => JSON.parse(order.payload)) };
    }
    const row = equipment && filterVisible(req.actor,'Equipo',[equipment],scope)[0];
    let image = readEquipmentImage(row,req.params.field,req.params.hash);
    if (row && row[req.params.field] === `media:${req.params.hash}` && ['foto_equipo','placa_datos','foto_frontal','foto_trasera','foto_lateral_1','foto_lateral_2'].includes(req.params.field)) {
      const preview = req.query.preview === '1';
      // Select just the requested representation; a thumbnail request does not read the original BLOB.
      const [files] = await pool.execute(`SELECT mime,${preview ? 'COALESCE(thumbnail,content)' : 'content'} AS bytes,${preview ? 'thumbnail IS NOT NULL' : 'FALSE'} AS preview FROM em_media WHERE equipment_id=? AND field=? AND hash=?`, [row.id,req.params.field,req.params.hash]);
      if (files.length) image = { type: files[0].preview ? 'image/webp' : files[0].mime, bytes: files[0].bytes };
    }
    if (!image) throw fail(404,'Imagen no disponible.');
    // Revalidate authorization on every request, including conditional requests.
    // An immutable browser cache would outlive account revocation or reassignment.
    res.set('Cache-Control','private, no-cache').set('ETag',`"${req.params.hash}-${req.query.preview === '1' ? 'preview-v1' : 'original'}"`);
    res.type(image.type).send(image.bytes);
  });
  app.post('/api/mutate', (req,res,next) => express.json({ limit:req.actor.rol === 'Administrador' ? '32mb' : '128kb' })(req,res,next), async (req,res) => {
    const body = req.body;
    if (body?.mediaUploads !== undefined && (!body.mediaUploads || typeof body.mediaUploads !== 'object' || Array.isArray(body.mediaUploads) || Object.entries(body.mediaUploads).some(([field,id]) => !['foto_equipo','placa_datos','foto_frontal','foto_trasera','foto_lateral_1','foto_lateral_2'].includes(field) || typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)))) throw fail(400,'La carga de fotografías no es válida.');
    if (req.actor.rol !== 'Administrador') {
      const operational = ['Ticket','OrdenServicio','LecturaHorometro'].includes(body?.entity);
      const manager = req.actor.rol === 'Coordinador' && operational && ['create','update'].includes(body?.action);
      const technician = req.actor.rol === 'Técnico' && ((body?.entity === 'OrdenServicio' && body?.action === 'update') || (body?.entity === 'LecturaHorometro' && body?.action === 'create'));
      const client = req.actor.rol === 'Cliente' && body?.entity === 'Ticket' && body?.action === 'create';
      if (!manager && !technician && !client) throw fail(403,'No tienes permiso para realizar esta operación.');
    }
    if (!body || !Number.isSafeInteger(body.revision) || !['create','update','remove','import','importClients','importHistoricalReports','restore'].includes(body.action)) throw fail(400,'Operación inválida.');
    if (!['importClients','importHistoricalReports','restore'].includes(body.action) && !['Cliente','Contacto','Sede','Equipo','Catalogos','Hallazgo','PlanPM','Ticket','OrdenServicio','LecturaHorometro'].includes(body.entity)) throw fail(400,'Entidad no editable.');
    if (['create','update'].includes(body.action) && (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields) || Object.entries(body.fields).some(([key,value]) => ['__proto__','constructor','prototype'].includes(key) || (value !== null && !['string','number','boolean'].includes(typeof value))))) throw fail(400,'Los campos del registro no son válidos.');
    if (body.action === 'update' && ['Ticket','OrdenServicio','LecturaHorometro'].includes(body.entity) && typeof body.fields.expected_updated_at !== 'string') throw fail(400,'Recarga el registro antes de editarlo.');
    if (['import','importClients'].includes(body.action) && (!Array.isArray(body.rows) || body.rows.length>2000)) throw fail(400,'Importa un máximo de 2000 filas.');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction(); const db = await readDatabase(conn,true);
      const replay = body.action === 'create' && ['Ticket','OrdenServicio','LecturaHorometro'].includes(body.entity) && body.fields?.solicitud_id && db.entities[body.entity].some(row => row.solicitud_id === body.fields.solicitud_id && row.creado_por === req.actor.id);
      // Operational writes validate their own record version and all current links
      // inside this lock. Unrelated changes must not reject a technician's work.
      const recordConcurrency = ['Ticket','OrdenServicio','LecturaHorometro'].includes(body.entity) && ['create','update'].includes(body.action);
      if (body.revision !== db.revision && !replay && !recordConcurrency) throw fail(409,'Los datos cambiaron en otro dispositivo. Recarga y revisa antes de guardar.');
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
      } catch (error) { if (error instanceof ValidationError) throw fail([403,409].includes(error.status) ? error.status : 400,error.message); throw error; }
      const next = JSON.parse(saved);
      await persistEquipmentMedia(conn,next,db,{actor:req.actor,uploads:body.mediaUploads,targetId:body.entity==='Equipo' ? result?.id : undefined,restore:body.action==='restore'});
      await saveDatabase(conn,next,db); await conn.commit(); snapshots.publish(next);
      const publicResult = result && body.entity && req.actor.rol !== 'Administrador' ? filterVisible(req.actor,body.entity,[result],next.entities)[0] : result;
      res.json({result:body.entity === 'Equipo' && result ? presentEquipment(next.entities.Equipo.find(row => row.id === result.id)) : publicResult,database:visible(next,req.actor)});
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });
  app.use('/api', (_req,_res,next)=>next(fail(404,'Ruta no encontrada.')));
  if (production) app.get('/revision/TCL-001', (_req,res) => res.status(404).type('text/plain').send('Página no disponible.'));
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
