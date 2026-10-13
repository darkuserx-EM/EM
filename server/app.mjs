import { select, selectQuery, change as sqlChange } from './sql.mjs';
import { errorCode, errorField } from './errors.mjs';
import { oneOf } from './guards.mjs';
import { encryptionKey } from './totp.mjs';
import {registerOperationPages} from './operation-pages.mjs';
import {operationalEntities} from './operation-index.mjs';
import {auditSequence} from './audit-storage.mjs';
import { mfaChallenge, registerMfaLogin, registerMfaRoutes } from './mfa.mjs';
import { idleTimeout, clearSessionCookies } from './session-policy.mjs';
import { registerAuditRoutes } from './audit-log.mjs';
import express from 'express';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalDataSource, STORAGE_KEY, filterVisible, entityNames, ValidationError, IncrementalValidation } from './generated/domain.mjs';
import { readSnapshot, readDatabase, readEquipmentRecord, saveDatabase, prepareDatabaseWrite, consumeLoginAttempt } from './database.mjs';
import { hashPassword, verifyPassword, digest, equal, token, cookieToken } from './security.mjs';
import { presentDatabase, presentEquipment, readEquipmentImage } from './equipment-images.mjs';
import { logFailure, parseTrustProxy } from './diagnostics.mjs';
import { createSnapshotCache } from './snapshot-cache.mjs';
import { registerAccountRoutes } from './account.mjs';
import { registerAdminUserRoutes } from './admin-users.mjs';
import { registerAttachmentRoutes } from './attachments.mjs';
import { registerTicketAttachmentRoutes } from './ticket-attachments.mjs';
import { registerAttachmentBackupRoutes } from './attachment-backup.mjs';
import { registerMediaUploadRoutes, persistEquipmentMedia, hydrateEquipment } from './media.mjs';
import { registerFullBackupRoutes } from './full-backup.mjs';
import { localFiles } from './file-storage.mjs';
import { DriveStorageError } from './drive-storage.mjs';

/** @param {number} status @param {string} message */
const fail = (status, message) => Object.assign(new Error(message), { status, expose: true });
/** @param {number} revision @param {import("../src/domain/model.js").Actor} actor */
const syncToken = (revision, actor) => digest(JSON.stringify(['portal-sync-v1', revision, actor]));
/** @param {import("../src/domain/model.js").Database} db @param {import("../src/domain/model.js").Actor} actor @param {boolean} [paged] */
const visible = (db, actor, paged=false) => {
  const entities={...db.entities};
  for(const name of entityNames)entities[name]=name==='Bitacora'?[]:filterVisible(actor,name,db.entities[name],db.entities);
  const counts=Object.fromEntries(entityNames.map(name=>[name,entities[name].length]));
  if(paged)for(const name of operationalEntities)entities[name]=[];
  return {...presentDatabase({...db,entities}),syncToken:syncToken(db.revision,actor),access:actor,...(paged?{pagedEntities:operationalEntities,counts}:{})};
};
/** @param {import("./contracts.js").UserRow} user @returns {import("../src/domain/model.js").Actor} */
const actorOf = user => ({ id: user.id, nombre: user.name, rol: user.role, cliente_id: user.client_id || undefined, tecnico_id: user.technician_id || undefined });
/** @param {unknown} value */
const emailOf = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
/** @param {import("./http-contracts.js").AppOptions} options */
export function createApp({ pool, origin, setupToken, production = true, dist = resolve('dist'), trustProxy = '1', networkDiagnostics = false, logger = console.error, sessionIdleMinutes = '60', totpEncryptionKey,files=localFiles } ) {
  const app = express();
  const mfaKey=encryptionKey(totpEncryptionKey);
  const idleMs=idleTimeout(sessionIdleMinutes), cookieName=production?'__Host-em_session':'em_session';
  app.set('portal production', production);
  app.disable('x-powered-by'); app.set('trust proxy', parseTrustProxy(String(trustProxy)));
  const snapshots = createSnapshotCache(pool);
  /** @type {WeakMap<import("../src/domain/model.js").Database,import("../src/domain/incremental-validation.js").IncrementalValidation>} */
  const validationIndexes=new WeakMap();
  app.use(helmet({ strictTransportSecurity: production ? { maxAge: 31536000, includeSubDomains: false } : false, contentSecurityPolicy: { directives: { upgradeInsecureRequests: production ? [] : null, imgSrc: ["'self'", "data:", "blob:"] } } }));
  app.use((_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
  app.use('/api', (_req,res,next) => { res.set('Cache-Control','no-store'); next(); });
  app.get('/api/health', async (_req,res) => { try { await pool.query('SELECT 1'); res.json({ status:'ok', database:'connected', release:'0.3.0', persistence:'optimistic-v1' }); } catch (error) {
    const reference = logFailure(error, { event:'health', status:503 }, logger);
    res.status(503).json({ status:'unavailable', reference });
  } });
  app.use('/api', rateLimit({ windowMs:60000, limit:240, standardHeaders:'draft-8', legacyHeaders:false, message:{error:'Demasiadas solicitudes. Intenta de nuevo en un minuto.'} }));
  app.use('/api', (req,_res,next) => {
    const imageUpload = req.method === 'POST' && req.path === '/equipment-media/upload' && ['image/png','image/jpeg','image/webp'].includes(req.get('content-type')||'');
    if (!['GET','HEAD'].includes(req.method) && (req.get('origin') !== origin || (!req.is('application/json') && !imageUpload))) return next(fail(403,'La solicitud debe realizarse desde el portal.'));
    next();
  });
  const smallJson = express.json({ limit:'100kb' });
  const loginLimit = rateLimit({ windowMs:900000, limit:30, standardHeaders:'draft-8', legacyHeaders:false, message:{error:'Demasiados intentos. Espera 15 minutos.'} });
  app.get('/api/setup-status', async (_req,res) => {
/** @type {{n:number}[]} */
    const rows = await selectQuery(pool,'SELECT COUNT(*) AS n FROM em_users'); res.json({ needsSetup:Number(rows[0].n) === 0 }); });
  app.post('/api/setup', loginLimit, smallJson, /** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").SessionBody>} req @param {import("./http-contracts.js").PortalResponse<{created:boolean}>} res */ async (req,res)=> {
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

/** @type {{n:number}[]} */
    const users = await selectQuery(conn,'SELECT COUNT(*) AS n FROM em_users');
      if (Number(users[0].n)) throw fail(409,'La cuenta inicial ya existe. Inicia sesión.');
      await conn.execute('INSERT INTO em_users (id,email,name,role,password_hash) VALUES (?,?,?,?,?)',[randomUUID(),email,name,'Administrador',passwordHash]);
      await conn.commit(); res.status(201).json({created:true});
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  });
  app.post('/api/login', loginLimit, smallJson, /** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").SessionBody>} req @param {import("./http-contracts.js").PortalResponse<import("./http-contracts.js").LoginReply>} res */ async (req,res)=> {
    const email = emailOf(req.body?.email);
    if (!email || email.length>254 || typeof req.body.password !== 'string' || req.body.password.length>128) throw fail(401,'Correo o contraseña incorrectos.');
    const attemptKey = digest(JSON.stringify(['login-v2',email,ipKeyGenerator(req.ip||req.socket.remoteAddress||'')]));
    if (!await consumeLoginAttempt(pool,attemptKey)) throw fail(429,'Demasiados intentos. Espera 15 minutos.');

/** @type {import("./contracts.js").UserRow[]} */
    const rows = await select(pool,'SELECT * FROM em_users WHERE email=? AND active=TRUE AND (expires_at IS NULL OR expires_at>?)',[email,Date.now()]);
    // Derive even for an unknown account to avoid fast username enumeration.
    const dummy = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
    if (!await verifyPassword(req.body.password,rows[0]?.password_hash || dummy) || !rows[0]) throw fail(401,'Correo o contraseña incorrectos.');
    const session = token();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

/** @type {Pick<import("./contracts.js").UserRow,"id"|"password_hash"|"active"|"expires_at"|"totp_enabled">[]} */
    const current = await select(conn,'SELECT id,password_hash,active,expires_at,totp_enabled FROM em_users WHERE id=? FOR UPDATE',[rows[0].id]);
      if (!current[0]?.active || (current[0].expires_at && Number(current[0].expires_at) <= Date.now()) || current[0].password_hash !== rows[0].password_hash) throw fail(401,'Correo o contraseña incorrectos.');
      if(current[0].totp_enabled) {
        if(!mfaKey)throw fail(409,'El segundo factor requiere atención del administrador del alojamiento.');
        const challenge=await mfaChallenge(conn,current[0]);await conn.execute('DELETE FROM em_login_limits WHERE bucket=?',[attemptKey]);await conn.commit();return res.json(challenge);
      }
      await conn.execute('INSERT INTO em_sessions (token_hash,user_id,csrf,expires_at,last_seen_at) VALUES (?,?,?,?,?)',[digest(session),rows[0].id,token(),Date.now()+8*3600000,Date.now()]);
      await conn.execute('DELETE FROM em_login_limits WHERE bucket=?',[attemptKey]);
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    res.cookie(cookieName,session,{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge:8*3600000});
    res.json({ok:true});
  });
  registerMfaLogin(app,{pool,key:mfaKey,production,loginLimit,smallJson});
  app.use('/api', async (req,_res,next) => {
    const modern = cookieToken(req.headers.cookie,cookieName);
    const session = modern || (production ? cookieToken(req.headers.cookie,'em_session') : undefined);
    if (!session || session.length>128) throw fail(401,'Inicia sesión para continuar.');

/** @type {import("./contracts.js").SessionUserRow[]} */
    const rows = await select(pool,'SELECT s.csrf, s.token_hash, s.last_seen_at, s.expires_at AS session_expires_at, u.* FROM em_sessions s JOIN em_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=TRUE AND (u.expires_at IS NULL OR u.expires_at>?)',[digest(session),Date.now(),Date.now()]);
    if (!rows[0]) throw fail(401,'Tu sesión terminó. Vuelve a ingresar.');
    const now=Date.now(), lastSeen=Number(rows[0].last_seen_at ?? now);
    if (now-lastSeen>=idleMs) {
      await pool.execute('DELETE FROM em_sessions WHERE token_hash=? AND last_seen_at<=?',[digest(session),now-idleMs]);
      clearSessionCookies(_res,production);
      return _res.status(401).json({error:'Tu sesión se cerró por inactividad. Vuelve a ingresar.',code:'SESSION_IDLE'});
    }
    if (production && !modern) {
      _res.cookie(cookieName,session,{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:Math.max(0,Number(rows[0].session_expires_at ?? now+8*3600000)-now)});
      _res.clearCookie('em_session',{path:'/',secure:true,httpOnly:true,sameSite:'strict'});
    }
    req.actor = actorOf(rows[0]); req.sessionHash = rows[0].token_hash; req.csrf = rows[0].csrf;
    req.mustChangePassword = Boolean(rows[0].must_change_password);
    if (!['GET','HEAD'].includes(req.method) && !equal(req.get('x-csrf-token'),req.csrf)) throw fail(403,'La sesión de esta solicitud no es válida. Recarga el portal.');
    if (req.mustChangePassword && !['/session','/password','/logout'].includes(req.path)) return _res.status(403).json({error:'Debes cambiar tu contraseña temporal antes de continuar.',code:'PASSWORD_CHANGE_REQUIRED'});
    // Background reads never extend inactivity. User interaction sends a CSRF-protected heartbeat.
    if (lastSeen<=now-60000 && req.get('x-portal-poll')!=='1' && (!['GET','HEAD'].includes(req.method) || req.path==='/session')) await pool.execute('UPDATE em_sessions SET last_seen_at=? WHERE token_hash=? AND last_seen_at<=? AND last_seen_at>?',[now,req.sessionHash,now-60000,now-idleMs]);
    next();
  });
  app.post('/api/session/activity', (_req,res) => res.json({ok:true}));
  app.get('/api/session', (req,res) => res.json({actor:req.actor,csrf:req.csrf,mustChangePassword:req.mustChangePassword}));
  // Small authenticated requests are parsed only after session and CSRF checks.
  app.use('/api', (req,res,next) => ['/mutate','/attachments','/ticket-attachments','/admin/attachments/restore','/equipment-media/upload','/admin/media/restore'].includes(req.path) && req.method === 'POST' ? next() : smallJson(req,res,next));
  registerMfaRoutes(app,{pool,key:mfaKey});
  registerAccountRoutes(app, pool);
  registerAuditRoutes(app, pool);
  registerOperationPages(app,{pool,syncToken});
  registerAdminUserRoutes(app, {pool});
  registerAttachmentRoutes(app, {pool,files});
  registerTicketAttachmentRoutes(app, {pool,files});
  registerAttachmentBackupRoutes(app, {pool,logger,files});
  registerMediaUploadRoutes(app, {pool,files});
  registerFullBackupRoutes(app, {pool,logger,files});
  app.post('/api/logout', /** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").SessionBody>} req @param {import("./http-contracts.js").PortalResponse} res */ async (req,res)=> { await pool.execute('DELETE FROM em_sessions WHERE token_hash=?',[req.sessionHash]); clearSessionCookies(res,production); res.json({ok:true}); });
  app.get('/api/database', /** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").SessionBody>} req @param {import("./http-contracts.js").PortalResponse} res */ async (req,res)=> {

/** @type {{revision:number}[]} */
    const rows = await selectQuery(pool,'SELECT revision FROM em_meta WHERE id=1');
    const revision = Number(rows[0].revision);
    if (req.query.since === syncToken(revision, req.actor)) return res.status(204).end();
    res.json(visible(await snapshots.read(revision),req.actor,req.query.paged==='1'));
  });
  if (networkDiagnostics) app.get('/api/diagnostico/red', (req,res) => {
    if (req.actor.rol !== 'Administrador') throw fail(403,'Esta acción está disponible solo para administración.');
    res.json({ ip:req.ip, ips:req.ips, socket:req.socket.remoteAddress, xForwardedFor:req.get('x-forwarded-for')?.slice(0,512) ?? null, trustProxy:req.app.get('trust proxy') });
  });
  app.get('/api/backup', /** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").SessionBody>} req @param {import("./http-contracts.js").PortalResponse} res */ async (req,res)=> {
    if (req.actor.rol !== 'Administrador') throw fail(403,'Esta acción está disponible solo para administración.');
    const db = await readSnapshot(pool);
    db.entities.Equipo = await hydrateEquipment(pool,db.entities.Equipo,{files});
    res.json(db);
  });
  app.post('/api/equipment-export', /** @param {import("./http-contracts.js").PortalRequest<{ids?:unknown}>} req @param {import("./http-contracts.js").PortalResponse<{rows:Record<string,import("../src/domain/model.js").Scalar>[],includesImages:boolean}>} res */ async (req,res)=> {
    if (req.actor.rol !== 'Administrador') throw fail(403,'Esta acción está disponible solo para administración.');
    if (!Array.isArray(req.body.ids) || req.body.ids.length > 2000 || req.body.ids.some(id => typeof id !== 'string')) throw fail(400,'Selección de equipos inválida.');
    const ids = new Set(req.body.ids); const db = await readSnapshot(pool,{includeAudit:false});
    const imageFields = ['foto_equipo','placa_datos','foto_frontal','foto_trasera','foto_lateral_1','foto_lateral_2'];
    res.json({ rows: db.entities.Equipo.filter(row => ids.has(row.id)).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !imageFields.includes(key)))), includesImages: false });
  });
  app.get('/api/equipment-images/:id/:field/:hash', /** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").SessionBody>} req @param {import("./http-contracts.js").PortalResponse} res */ async (req,res)=> {
    const equipment = await readEquipmentRecord(pool,req.params.id);
    /** @type {Pick<import("../src/domain/model.js").Database["entities"],"Equipo"|"OrdenServicio"|"Ticket">|undefined} */
    let scope;
    if (equipment && req.actor.rol === 'Técnico' && req.actor.tecnico_id) {

/** @type {{payload:string}[]} */
    const orders = await select(pool,"SELECT payload FROM em_records WHERE entity='OrdenServicio' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.equipo_id'))=? AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.tecnico_id'))=?", [equipment.id,req.actor.tecnico_id]);
      /** @type {{payload:string}[]} */
      const tickets = await select(pool,"SELECT payload FROM em_records WHERE entity='Ticket' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.equipo_id'))=? AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.responsable_id'))=?", [equipment.id,req.actor.tecnico_id]);
      scope = { OrdenServicio: orders.map(order => JSON.parse(order.payload)), Ticket:tickets.map(ticket=>JSON.parse(ticket.payload)), Equipo:[] };
    }
    const row = equipment && filterVisible(req.actor,'Equipo',[equipment],scope)[0];
    /** @type {{type:string,bytes:Buffer}|null} */
    let image = readEquipmentImage(row,req.params.field,req.params.hash);
    if (row && row[req.params.field] === `media:${req.params.hash}` && ['foto_equipo','placa_datos','foto_frontal','foto_trasera','foto_lateral_1','foto_lateral_2'].includes(req.params.field)) {
      const preview = req.query.preview === '1';
      // Select just the requested representation; a thumbnail request does not read the original BLOB.

/** @type {{mime:string,bytes:Buffer,storage_key:string|null,preview:number}[]} */
    const stored = await select(pool,`SELECT mime,${preview ? 'COALESCE(thumbnail,content)' : 'content'} AS bytes,${preview ? 'IF(thumbnail IS NOT NULL,thumbnail_key,storage_key)' : 'storage_key'} AS storage_key,${preview ? 'thumbnail IS NOT NULL' : 'FALSE'} AS preview FROM em_media WHERE equipment_id=? AND field=? AND hash=?`, [row.id,req.params.field,req.params.hash]);
      if (stored.length) image = { type: stored[0].preview ? 'image/webp' : stored[0].mime, bytes: await files.read(pool,{content:stored[0].bytes,storage_key:stored[0].storage_key}) };
    }
    if (!image) throw fail(404,'Imagen no disponible.');
    // Revalidate authorization on every request, including conditional requests.
    // An immutable browser cache would outlive account revocation or reassignment.
    res.set('Cache-Control','private, no-cache').set('ETag',`"${req.params.hash}-${req.query.preview === '1' ? 'preview-v1' : 'original'}"`);
    res.type(image.type).send(image.bytes);
  });
  app.post('/api/mutate', (req,res,next) => express.json({ limit:req.actor.rol === 'Administrador' ? '32mb' : '128kb' })(req,res,next), /** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").MutationBody>} req @param {import("./http-contracts.js").PortalResponse<import("./http-contracts.js").MutationReply>} res */ async (req,res)=> {
    const body = req.body;
    if (body?.mediaUploads !== undefined && (!body.mediaUploads || typeof body.mediaUploads !== 'object' || Array.isArray(body.mediaUploads) || Object.entries(body.mediaUploads).some(([field,id]) => !['foto_equipo','placa_datos','foto_frontal','foto_trasera','foto_lateral_1','foto_lateral_2'].includes(field) || typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)))) throw fail(400,'La carga de fotografías no es válida.');
    if (req.actor.rol !== 'Administrador') {
      const operational = oneOf(['Ticket','OrdenServicio','LecturaHorometro'],body?.entity);
      const manager = req.actor.rol === 'Coordinador' && operational && ['create','update'].includes(body?.action);
      const technician = req.actor.rol === 'Técnico' && ((body?.entity === 'OrdenServicio' && body?.action === 'update') || (body?.entity === 'LecturaHorometro' && body?.action === 'create'));
      const client = req.actor.rol === 'Cliente' && body?.entity === 'Ticket' && body?.action === 'create';
      if (!manager && !technician && !client) throw fail(403,'No tienes permiso para realizar esta operación.');
    }
    if (!body || !Number.isSafeInteger(body.revision) || !['create','update','remove','import','importClients','importHistoricalReports','restore'].includes(body.action)) throw fail(400,'Operación inválida.');
    if (!['importClients','importHistoricalReports','restore'].includes(body.action) && !oneOf(['Cliente','Contacto','Sede','Equipo','Catalogos','Hallazgo','PlanPM','Ticket','OrdenServicio','LecturaHorometro'],body.entity)) throw fail(400,'Entidad no editable.');
    if (['create','update'].includes(body.action) && (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields) || Object.entries(body.fields).some(([key,value]) => ['__proto__','constructor','prototype'].includes(key) || (value !== null && !['string','number','boolean'].includes(typeof value))))) throw fail(400,'Los campos del registro no son válidos.');
    if (body.action === 'update' && oneOf(['Ticket','OrdenServicio','LecturaHorometro'],body.entity) && typeof body.fields.expected_updated_at !== 'string') throw fail(400,'Recarga el registro antes de editarlo.');
    if ((body.action==='import'||body.action==='importClients') && (!Array.isArray(body.rows) || body.rows.length>2000)) throw fail(400,'Importa un máximo de 2000 filas.');
    const recordConcurrency = oneOf(['Ticket','OrdenServicio','LecturaHorometro'],body.entity) && ['create','update'].includes(body.action);
    // Retry only a transaction known to have rolled back, never an uncertain commit.
    for(let attempt=0;attempt<5;attempt++) {
    const conn = await pool.getConnection();let committing=false;
    try {
      await conn.beginTransaction();
      const incremental=['create','update','remove'].includes(body.action);

/** @type {{revision:number}[]} */
    const baseline = await selectQuery(conn,'SELECT revision FROM em_meta WHERE id=1');
      // A cache hit is usable only for this exact committed revision. A cold or
      // externally changed baseline is fully validated on this same connection;
      // taking another pool connection here can deadlock concurrent writers.
      const db=(incremental && await snapshots.peek(Number(baseline[0].revision))) || await readDatabase(conn,false,{includeAudit:body.action==='restore'});
      let checker;
      if(incremental) {
        checker=validationIndexes.get(db)||IncrementalValidation.create(db);
        validationIndexes.set(db,checker);
      }
      /** @type {((value:unknown)=>void)|undefined} */
      const validate=checker ? value=>checker.validate(value) : undefined;
      const sequence=await auditSequence(conn);
      const replay = body.action === 'create' && oneOf(['Ticket','OrdenServicio','LecturaHorometro'],body.entity) && body.fields?.solicitud_id && db.entities[body.entity].some(row => row.solicitud_id === body.fields.solicitud_id && row.creado_por === req.actor.id);
      // Operational writes validate their own record version and all current links
      // again on each fresh baseline. Unrelated writes can retry without losing work.
      if (body.revision !== db.revision && !replay && !recordConcurrency) throw fail(409,'Los datos cambiaron en otro dispositivo. Recarga y revisa antes de guardar.');
      // Existing images stay in MySQL while the shared domain edits compact references.
      // Resolve them against this snapshot before saving; never concatenate
      // every existing photo into the domain's intermediate JSON string.
      let saved = JSON.stringify(presentDatabase(db));
      const source = new LocalDataSource({getItem:key=>key===STORAGE_KEY?saved:null,setItem:(_key,value)=>{saved=value;}},{demoHistory:false,maxRows:Infinity,auditSequence:sequence,validate});
      /** @type {import("../src/domain/model.js").EntityRecord|undefined} */
      let recordResult;
      let result;
      try {
        if (body.action==='importClients') result = source.importClients(req.actor,body.rows,db.revision);
        else if (body.action==='importHistoricalReports') result = source.importHistoricalReports(req.actor,body.payload,db.revision);
        else if (body.action==='restore') source.restore(req.actor,body.database,db.revision,body.exportedAt);
        else {
          const repo = source.repository(body.entity,req.actor);
          if (body.action==='create') result = recordResult = await repo.create(body.fields);
          if (body.action==='update') result = recordResult = await repo.update(body.id,body.fields);
          if (body.action==='remove') await repo.remove(body.id);
          if (body.action==='import') await repo.import(body.rows,db.revision);
        }
      } catch (error) { if (error instanceof ValidationError) { const status=errorField(error,'status'); throw fail(status===403||status===409 ? status : 400,error.message); } throw error; }
      /** @type {import("../src/domain/model.js").Database} */
      const next = JSON.parse(saved);
      if(next.revision===db.revision) {
        await conn.rollback();
        const row=recordResult&&body.entity&&req.actor.rol!=='Administrador'?filterVisible(req.actor,body.entity,[recordResult],db.entities)[0]:result;
        return res.json({result:row,database:visible(db,req.actor,body.paged===true)});
      }
      // All domain decisions happen before the short commit gate. The conditional
      // revision update fails if any parent, meter, uniqueness key or row changed.
      // Nothing from a stale candidate may reach the database.
      /** @type {{next:import("../src/domain/incremental-validation.js").IncrementalValidation|undefined}} */
      const validationResult={next:undefined};
      const write=recordConcurrency?prepareDatabaseWrite(next,db,{validate:checker?value=>{validationResult.next=checker.check(value);}:undefined}):undefined;
      let published;
      if(write) {
        published={...next,entities:{...next.entities,Bitacora:[]}};
        if(validationResult.next)validationResult.next=validationResult.next.check(published);
      }
      const guard=await sqlChange(conn,'UPDATE em_meta SET revision=? WHERE id=1 AND revision=?',[next.revision,db.revision]);
      if(guard.affectedRows!==1)throw Object.assign(new Error('Stale write baseline'),{code:'REVISION_CHANGED'});
      if(!recordConcurrency)await persistEquipmentMedia(conn,next,db,{actor:req.actor,uploads:body.mediaUploads,targetId:body.entity==='Equipo' ? recordResult?.id : undefined,restore:body.action==='restore'});
      if(write)await write(conn);else await saveDatabase(conn,next,db,{validate:checker ? value=>{validationResult.next=checker.check(value);} : undefined});
      // Do not retain newly emitted audit rows in the operational baseline.
      if(!published) {
        published={...next,entities:{...next.entities,Bitacora:[]}};
        if(validationResult.next)validationResult.next=validationResult.next.check(published);
      }
      if(validationResult.next)validationIndexes.set(published,validationResult.next);
      committing=true;await snapshots.publishAfterCommit(published,()=>conn.commit());
      const publicResult = recordResult && body.entity && req.actor.rol !== 'Administrador' ? filterVisible(req.actor,body.entity,[recordResult],next.entities)[0] : result;
      return res.json({result:body.entity === 'Equipo' && recordResult ? presentEquipment(next.entities.Equipo.find(row => row.id === recordResult.id)||recordResult) : publicResult,database:visible(next,req.actor,body.paged===true)});
    } catch (error) {
      await conn.rollback();
      if(!committing&&['REVISION_CHANGED','ER_LOCK_DEADLOCK','ER_CHECKREAD'].includes(errorCode(error)||'')) {
        if(recordConcurrency&&attempt<4)continue;
        throw fail(409,'Los datos cambiaron durante el guardado. Recarga el registro y revisa antes de guardar.');
      }
      throw error;
    } finally { conn.release(); }
    }
  });
  app.use('/api', (_req,_res,next)=>next(fail(404,'Ruta no encontrada.')));
  if (production) app.get('/revision/TCL-001', (_req,res) => res.status(404).type('text/plain').send('Página no disponible.'));
  app.use(express.static(dist,{index:false,dotfiles:'deny',setHeaders:(res,path)=>res.set('Cache-Control',path.includes('/assets/')?'public,max-age=31536000,immutable':'no-cache')}));
  app.get('/{*path}', (_req,res)=>{res.set('Cache-Control','no-cache');res.sendFile(resolve(dist,'index.html'));});
  app.use(/** @param {unknown} error @param {import("./http-contracts.js").PortalRequest} req @param {import("./http-contracts.js").PortalResponse<{error:string,reference?:string}>} res @param {import("express").NextFunction} _next */ (error,req,res,_next)=>{
    if (errorField(error,'type') === 'entity.too.large') return res.status(413).json({error:'El envío supera el tamaño permitido. Reduce los adjuntos o el archivo.'});
    if (errorField(error,'type') === 'entity.parse.failed') return res.status(400).json({error:'La solicitud no contiene un JSON válido.'});
    if (error instanceof DriveStorageError) {
      const reference=logFailure(error,{event:'file.storage',method:req.method,route:req.route?.path||'(middleware)',status:503},logger);
      return res.set('Retry-After','60').status(503).json({error:error.message,reference});
    }
    const status=errorField(error,'status'),message=errorField(error,'message');
    if (errorField(error,'expose') === true && typeof status==='number' && Number.isInteger(status) && status >= 400 && status < 500 && typeof message==='string') return res.status(status).json({error:message});
    const reference = logFailure(error, { event:'request', method:req.method, route:req.route?.path || '(middleware)', status:500 }, logger);
    res.status(500).json({error:`El servicio no está disponible. Intenta nuevamente en unos minutos. Referencia: ${reference}`,reference});
  });
  return app;
}
