import { select, selectQuery, change as sqlChange } from './sql.mjs';
import {consumeLoginAttempt} from './database.mjs';
import {randomBytes,randomUUID} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {digest,token,verifyPassword} from './security.mjs';
import {base32,seal,unseal,totpStep} from './totp.mjs';
/** @param {number} status @param {string} message */
const fail =(status,message)=>Object.assign(new Error(message),{status,expose:true});
/** @param {import("./contracts.js").UserRow|undefined} user @returns {user is import("./contracts.js").UserRow} */
const active=user=>!!user?.active&&(!user.expires_at||Number(user.expires_at)>Date.now());
/** @param {string} code */
const recoveryHash=code=>digest(String(code).replace(/[\s-]/g,'').toLowerCase());
/** @param {import("mysql2/promise").PoolConnection} conn @param {string} id @param {string} action */
const event=(conn,id,action)=>conn.execute('INSERT INTO em_security_events (id,actor_id,target_id,action,created_at) VALUES (?,?,?,?,?)',[randomUUID(),id,id,action,Date.now()]);
/** @param {import("mysql2/promise").Pool} pool @param {Buffer|null} key */
export async function verifyMfaConfiguration(pool,key) {
/** @type {Pick<import("./contracts.js").UserRow,"id"|"totp_secret">[]} */
    const users = await selectQuery(pool,'SELECT id,totp_secret FROM em_users WHERE totp_enabled=TRUE');for(const user of users)unseal(user.totp_secret,key,user.id);}
/** @param {import("mysql2/promise").PoolConnection} conn @param {Pick<import("./contracts.js").UserRow,"id"|"password_hash">} user */
export async function mfaChallenge(conn,user) {const challenge=token();await conn.execute('DELETE FROM em_mfa_challenges WHERE expires_at<=? LIMIT 100',[Date.now()]);await conn.execute('DELETE FROM em_mfa_challenges WHERE user_id=?',[user.id]);await conn.execute('INSERT INTO em_mfa_challenges (token_hash,user_id,password_version,expires_at,attempts) VALUES (?,?,?,?,0)',[digest(challenge),user.id,digest(user.password_hash),Date.now()+300000]);return {needsTotp:true,challenge};}
/** @param {import("mysql2/promise").PoolConnection} conn @param {import("./contracts.js").UserRow} user @param {unknown} code @param {Buffer|null} key */
async function consumeFactor(conn,user,code,key) {
 if(typeof code!=='string'||code.length>100)return false;
 if(/^\d{6}$/.test(code)){const step=totpStep(unseal(user.totp_secret,key,user.id),code,Number(user.totp_last_step??-1));if(step===null)return false;await conn.execute('UPDATE em_users SET totp_last_step=? WHERE id=?',[step,user.id]);return true;}
 const result=await sqlChange(conn,'UPDATE em_recovery_codes SET used_at=? WHERE user_id=? AND code_hash=? AND used_at IS NULL',[Date.now(),user.id,recoveryHash(code)]);return result.affectedRows===1;
}
/** @param {import("express").Express} app @param {{pool:import("mysql2/promise").Pool,key:Buffer|null,production:boolean,loginLimit:import("express").RequestHandler,smallJson:import("express").RequestHandler}} options */
export function registerMfaLogin(app,{pool,key,production,loginLimit,smallJson}) {
 app.post('/api/login/totp',loginLimit,smallJson,/** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").MfaBody>} req @param {import("./http-contracts.js").PortalResponse<import("./http-contracts.js").LoginReply>} res */ async (req,res)=>{
  const {challenge,code}=req.body||{};if(typeof challenge!=='string'||challenge.length>128||typeof code!=='string'||code.length>100)throw fail(401,'Código o solicitud inválidos.');

/** @type {{user_id:string}[]} */
    const initial = await select(pool,'SELECT user_id FROM em_mfa_challenges WHERE token_hash=?',[digest(challenge)]);if(!initial[0])throw fail(401,'La solicitud venció. Inicia sesión nuevamente.');
  const attemptKey=digest('mfa:'+initial[0].user_id);if(!await consumeLoginAttempt(pool,attemptKey))throw fail(429,'Demasiados intentos de segundo factor. Espera 15 minutos.');
  const conn=await pool.getConnection();try{await conn.beginTransaction();
/** @type {import("./contracts.js").UserRow[]} */
    const users = await select(conn,'SELECT * FROM em_users WHERE id=? FOR UPDATE',[initial[0].user_id]);const user=users[0];
/** @type {import("./contracts.js").ChallengeRow[]} */
    const requests = await select(conn,'SELECT * FROM em_mfa_challenges WHERE token_hash=? FOR UPDATE',[digest(challenge)]);const request=requests[0];
   if(!active(user)||!user.totp_enabled||!request||Number(request.expires_at)<=Date.now()||Number(request.attempts)>=5||request.password_version!==digest(user.password_hash))throw fail(401,'La solicitud venció. Inicia sesión nuevamente.');
   if(!await consumeFactor(conn,user,code,key)){await conn.execute('UPDATE em_mfa_challenges SET attempts=attempts+1 WHERE token_hash=?',[digest(challenge)]);await conn.commit();throw fail(401,'Código incorrecto o ya utilizado.');}
   const session=token();await conn.execute('DELETE FROM em_mfa_challenges WHERE user_id=?',[user.id]);await conn.execute('INSERT INTO em_sessions (token_hash,user_id,csrf,expires_at,last_seen_at) VALUES (?,?,?,?,?)',[digest(session),user.id,token(),Date.now()+8*3600000,Date.now()]);await conn.execute('DELETE FROM em_login_limits WHERE bucket=?',[attemptKey]);await event(conn,user.id,'account.mfa-login');await conn.commit();
   res.cookie(production?'__Host-em_session':'em_session',session,{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge:8*3600000});res.json({ok:true});
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 });
}
/** @param {import("express").Express} app @param {{pool:import("mysql2/promise").Pool,key:Buffer|null}} options */
export function registerMfaRoutes(app,{pool,key}) {
 const limit=rateLimit({windowMs:900000,limit:12,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Demasiados intentos. Espera 15 minutos.'}});
 /** @type {import("./http-contracts.js").PortalMiddleware} */
  const admin =(req,_res,next)=>{if(req.actor.rol!=='Administrador')throw fail(403,'Solo administración puede configurar segundo factor.');return next();};
 app.get('/api/2fa/status',admin,/** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").MfaBody>} req @param {import("./http-contracts.js").PortalResponse} res */ async (req,res)=>{
/** @type {{totp_enabled:number}[]} */
    const rows = await select(pool,'SELECT totp_enabled FROM em_users WHERE id=?',[req.actor.id]);res.json({configured:!!key,enabled:!!rows[0]?.totp_enabled});});
 for(const action of ['setup','enable','disable'])app.post('/api/2fa/'+action,admin,limit,/** @param {import("./http-contracts.js").PortalRequest<import("./http-contracts.js").MfaBody>} req @param {import("./http-contracts.js").PortalResponse} res */ async (req,res)=>{
  if(!key)throw fail(409,'El segundo factor requiere configurar su clave de cifrado en el alojamiento.');
  const conn=await pool.getConnection();try{await conn.beginTransaction();
/** @type {import("./contracts.js").UserRow[]} */
    const users = await select(conn,'SELECT * FROM em_users WHERE id=? FOR UPDATE',[req.actor.id]);const user=users[0];
/** @type {{token_hash:string}[]} */
    const sessions = await select(conn,'SELECT token_hash FROM em_sessions WHERE token_hash=? AND user_id=? AND expires_at>?',[req.sessionHash,req.actor.id,Date.now()]);
   if(!active(user)||user.role!=='Administrador'||!sessions[0])throw fail(401,'Tu sesión terminó. Vuelve a ingresar.');
   if(!await verifyPassword(req.body?.currentPassword,user.password_hash))throw fail(400,'Confirma tu contraseña actual.');
   /** @type {import("./http-contracts.js").MfaReply} */
   let result={ok:true};
   if(action==='setup') {if(user.totp_enabled)throw fail(409,'El segundo factor ya está activado.');const secret=base32(randomBytes(20));await conn.execute('UPDATE em_users SET totp_pending=?,totp_pending_expires=? WHERE id=?',[seal(secret,key,user.id),Date.now()+600000,user.id]);result={secret,uri:`otpauth://totp/${encodeURIComponent('Portal EM:'+user.email)}?secret=${secret}&issuer=Portal%20EM&algorithm=SHA1&digits=6&period=30`};}
   if(action==='enable') {if(user.totp_enabled||!user.totp_pending||Number(user.totp_pending_expires)<=Date.now())throw fail(400,'Inicia nuevamente la configuración del segundo factor.');const step=totpStep(unseal(user.totp_pending,key,user.id),req.body?.code);if(step===null)throw fail(400,'El código no es válido. Revisa la hora del teléfono.');const codes=Array.from({length:10},()=>randomBytes(10).toString('hex').toUpperCase().match(/.{5}/g)?.join('-') || '');await conn.execute('DELETE FROM em_recovery_codes WHERE user_id=?',[user.id]);for(const code of codes)await conn.execute('INSERT INTO em_recovery_codes (user_id,code_hash) VALUES (?,?)',[user.id,recoveryHash(code)]);await conn.execute('UPDATE em_users SET totp_enabled=TRUE,totp_secret=totp_pending,totp_pending=NULL,totp_pending_expires=NULL,totp_last_step=? WHERE id=?',[step,user.id]);result={ok:true,recoveryCodes:codes};}
   if(action==='disable') {if(!user.totp_enabled||!await consumeFactor(conn,user,req.body?.code,key))throw fail(400,'Confirma con un código vigente o de recuperación.');await conn.execute('UPDATE em_users SET totp_enabled=FALSE,totp_secret=NULL,totp_pending=NULL,totp_pending_expires=NULL,totp_last_step=NULL WHERE id=?',[user.id]);await conn.execute('DELETE FROM em_recovery_codes WHERE user_id=?',[user.id]);}
   if(action!=='setup'){await conn.execute('DELETE FROM em_sessions WHERE user_id=? AND token_hash<>?',[user.id,req.sessionHash]);await conn.execute('DELETE FROM em_mfa_challenges WHERE user_id=?',[user.id]);await event(conn,user.id,'account.mfa-'+(action==='enable'?'enabled':'disabled'));}
   await conn.commit();res.json(result);
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 });
}
