import { select, selectQuery } from './sql.mjs';
import { errorCode } from './errors.mjs';
import { oneOf } from './guards.mjs';
import { randomUUID, randomBytes } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { hashPassword, verifyPassword } from './security.mjs';
import { readDatabase, saveDatabase } from './database.mjs';
/** @param {number} status @param {string} message */
const fail = (status, message) => Object.assign(new Error(message), {status, expose:true});
/** @param {unknown} role */
const management = role => oneOf(['Administrador','Coordinador'],role);
/** @param {import("./http-contracts.js").AdminUserBody} body @param {import("../src/domain/model.js").Role} role */
function lifetime(body, role) {
  if (body.days === null && management(role)) return null;
  const days=Number(body.days ?? 90);
  if (!Number.isInteger(days) || days<1 || days>365) throw fail(400,'La vigencia debe ser de 1 a 365 días.');
  return days;
}
/** @param {import("mysql2/promise").PoolConnection} conn @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").AdminUserBody>} req @param {boolean} reauthenticate */
async function authorize(conn,req,reauthenticate) {

/** @type {import("./contracts.js").UserRow[]} */
    const rows = await select(conn,'SELECT * FROM em_users WHERE id=? FOR UPDATE',[req.actor.id]);
  const actor=rows[0];
  if (!actor?.active || actor.role!=='Administrador' || (actor.expires_at && Number(actor.expires_at)<=Date.now())) throw fail(403,'La cuenta ya no puede administrar accesos.');
  if (reauthenticate && (typeof req.body?.currentPassword!=='string' || req.body.currentPassword.length>128 || !await verifyPassword(req.body.currentPassword,actor.password_hash))) throw fail(400,'Confirma tu contraseña actual de administrador.');
}
/** @param {import("mysql2/promise").PoolConnection} conn @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").AdminUserBody>} req @param {string} target @param {string} action */
async function event(conn,req,target,action) {
  await conn.execute('INSERT INTO em_security_events (id,actor_id,target_id,action,created_at) VALUES (?,?,?,?,?)',[randomUUID(),req.actor.id,target,action,Date.now()]);
}
/** @param {import("express").Express} app @param {{pool:import("mysql2/promise").Pool}} options */
export function registerAdminUserRoutes(app,{pool}) {
  /** @type {import("./http-contracts.js").PortalMiddleware} */
  const admin =(req,_res,next)=>req.actor.rol==='Administrador'?next():next(fail(403,'Solo administración puede gestionar cuentas.'));
  const limit=rateLimit({windowMs:900000,limit:60,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Demasiadas gestiones de cuentas. Espera 15 minutos.'}});
  app.get('/api/admin/users',admin,/** @param {import('./http-contracts.js').PortalRequest} _req @param {import('./http-contracts.js').PortalResponse<import('./http-contracts.js').AdminUserReply>} res */ async(_req,res)=>{

/** @type {Omit<import("./contracts.js").UserRow,"password_hash"|"creation_request"|"totp_secret"|"totp_pending"|"totp_pending_expires"|"totp_last_step"|"totp_enabled">[]} */
    const users = await selectQuery(pool,'SELECT id,email,name,role,client_id,technician_id,active,expires_at,must_change_password FROM em_users ORDER BY name');
    res.json({users});
  });
  app.post('/api/admin/users',admin,limit,/** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").AdminUserBody>} req @param {import("./http-contracts.js").PortalResponse<import("./http-contracts.js").AdminUserReply>} res */ async (req,res)=>{
    const b=req.body||{},email=String(b.email||'').trim().toLowerCase(),name=String(b.name||'').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!name||name.length>160) throw fail(400,'Indica nombre y correo válidos.');
    if (!oneOf(['Técnico','Cliente','Coordinador','Administrador'],b.role)) throw fail(400,'Selecciona un perfil válido.');
    const days=lifetime(b,b.role),password=b.password??randomBytes(24).toString('base64url'),requestId=b.requestId||randomUUID();
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requestId)) throw fail(400,'Identificador de alta inválido.');
    if (typeof password!=='string'||password.length<14||password.length>128) throw fail(400,'Usa una contraseña entre 14 y 128 caracteres.');
    const specialty=typeof b.specialty==='string'?b.specialty.trim():'';
    if (b.role==='Técnico'&&!b.technicianId&&(!specialty||specialty.length>120)) throw fail(400,'Indica la especialidad del técnico (máximo 120 caracteres).');
    const hash=await hashPassword(password),id=randomUUID(),expiresAt=days===null?null:Date.now()+days*86400000;
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction();const previous=await readDatabase(conn,true,{includeAudit:false}),db=structuredClone(previous);
      await authorize(conn,req,management(b.role));

/** @type {import("./contracts.js").UserRow[]} */
    const existing = await select(conn,'SELECT * FROM em_users WHERE email=?',[email]);
      if (existing[0]?.active&&existing[0].must_change_password&&existing[0].creation_request===requestId&&existing[0].role===b.role&&existing[0].name===name&&(b.role!=='Cliente'||existing[0].client_id===b.clientId)&&await verifyPassword(password,existing[0].password_hash)) {
        await conn.commit();return res.json({id:existing[0].id,email,password,expiresAt:existing[0].expires_at===null?null:Number(existing[0].expires_at),technicianId:existing[0].technician_id,clientId:existing[0].client_id});
      }
      if (existing.length) throw fail(409,'Ya existe una cuenta con ese correo. Revisa la lista antes de repetir.');
      /** @type {string|null} */
      let technicianId=null;
      /** @type {string|null} */
      let clientId=null;
      if (b.role==='Cliente') {
        clientId=String(b.clientId||'');if (!db.entities.Cliente.some(row=>row.id===clientId)) throw fail(400,'Selecciona el cliente al que tendrá acceso.');
      } else if (b.role==='Técnico') {
        technicianId=b.technicianId||randomUUID();
        if (b.technicianId&&!db.entities.Tecnico.some(row=>row.id===technicianId)) throw fail(400,'El técnico seleccionado no existe.');
        if (!b.technicianId) {
          const next=Math.max(0,...db.entities.Tecnico.map(row=>Number(String(row.codigo).replace(/^TEC-/,''))||0))+1,now=new Date().toISOString();
          db.entities.Tecnico.push({id:technicianId,codigo:'TEC-'+String(next).padStart(3,'0'),nombre:name,especialidad:specialty,activo:true,fecha_creacion:now,fecha_actualizacion:now,creado_por:req.actor.id,actualizado_por:req.actor.id});
          db.revision++;await saveDatabase(conn,db,previous);
        }
      }
      await conn.execute('INSERT INTO em_users (id,email,name,role,password_hash,client_id,technician_id,expires_at,creation_request,must_change_password) VALUES (?,?,?,?,?,?,?,?,?,TRUE)',[id,email,name,b.role,hash,clientId,technicianId,expiresAt,requestId]);
      await event(conn,req,id,'account.created');await conn.commit();res.status(201).json({id,email,password,expiresAt,technicianId,clientId});
    } catch(error) {await conn.rollback();if(errorCode(error)==='ER_DUP_ENTRY')throw fail(409,'La cuenta ya existe.');throw error;}finally{conn.release();}
  });
  for(const action of ['renew','reactivate','reset-password','revoke']) app.post('/api/admin/users/:id/'+action,admin,limit,/** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").AdminUserBody>} req @param {import("./http-contracts.js").PortalResponse<import("./http-contracts.js").AdminUserReply>} res */ async (req,res)=>{
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Serialize administration before locking users, as in account creation.
      await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE');

/** @type {import("./contracts.js").UserRow[]} */
    const targets = await select(conn,'SELECT * FROM em_users WHERE id=?',[req.params.id]);
      const target=targets[0];if(!target)throw fail(404,'Cuenta no encontrada.');
      await authorize(conn,req,management(target.role)||action==='reset-password');
      await conn.execute('SELECT id FROM em_users WHERE id=? FOR UPDATE',[target.id]);
      if(action==='revoke'&&target.id===req.actor.id)throw fail(400,'No puedes revocar tu propia cuenta.');
      async function preserveAdmin() {

/** @type {{id:string}[]} */
    const others = await select(conn,"SELECT id FROM em_users WHERE role='Administrador' AND active=TRUE AND expires_at IS NULL AND id<>? FOR UPDATE",[target.id]);
        if(!others.length)throw fail(400,'Debe permanecer un administrador activo sin vencimiento.');
      }
      if(target.role==='Administrador'&&action==='revoke')await preserveAdmin();
      let password,expiresAt;
      if(action==='renew'||action==='reactivate') {
        if(action==='renew'&&!target.active)throw fail(400,'La cuenta está revocada. Usa Reactivar.');
        const days=lifetime(req.body||{},target.role);
        if(target.role==='Administrador'&&days!==null)await preserveAdmin();
        if(action==='renew'&&!target.expires_at&&days!==null)throw fail(400,'La cuenta no tiene vencimiento que renovar.');
        expiresAt=days===null?null:(action==='renew'?Math.max(Date.now(),Number(target.expires_at)):Date.now())+days*86400000;
        await conn.execute('UPDATE em_users SET active=TRUE,expires_at=? WHERE id=?',[expiresAt,target.id]);
      }else if(action==='reset-password') {
        password=randomBytes(24).toString('base64url');
        await conn.execute('UPDATE em_users SET password_hash=?,must_change_password=TRUE WHERE id=?',[await hashPassword(password),target.id]);
      }else await conn.execute('UPDATE em_users SET active=FALSE WHERE id=?',[target.id]);
      if(action!=='renew')await conn.execute('DELETE FROM em_sessions WHERE user_id=?',[target.id]);
      await event(conn,req,target.id,'account.'+({renew:'renewed',reactivate:'reactivated','reset-password':'password-reset',revoke:'revoked'}[action]));
      await conn.commit();res.json({ok:true,email:target.email,...(password?{password}:{}),...(expiresAt!==undefined?{expiresAt}:{})});
    }catch(error){await conn.rollback();throw error;}finally{conn.release();}
  });
}
