import { rateLimit } from 'express-rate-limit';
import { hashPassword, verifyPassword } from './security.mjs';

const fail = (status, message) => Object.assign(new Error(message), {status, expose:true});
export function registerAccountRoutes(app, pool) {
  const limit = rateLimit({windowMs:900000,limit:15,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Demasiados intentos. Espera 15 minutos.'}});
  async function change(req, res, kind) {
    const body = req.body;
    if (!body || typeof body.currentPassword !== 'string' || body.currentPassword.length > 128) throw fail(400,'Indica tu contraseña actual.');
    if (kind === 'password' && (typeof body.newPassword !== 'string' || body.newPassword.length < 14 || body.newPassword.length > 128)) throw fail(400,'Usa una contraseña de entre 14 y 128 caracteres.');
    if (kind === 'sessions' && !['others','all'].includes(body.scope)) throw fail(400,'Selecciona las sesiones que deseas cerrar.');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Same user lock as login: a revoked or old-password login cannot race back in.
      const [users] = await conn.execute('SELECT id,password_hash,active FROM em_users WHERE id=? FOR UPDATE',[req.actor.id]);
      const [sessions] = await conn.execute('SELECT token_hash FROM em_sessions WHERE user_id=? AND token_hash=? AND expires_at>? FOR UPDATE',[req.actor.id,req.sessionHash,Date.now()]);
      if (!users[0]?.active || !sessions[0]) throw fail(401,'Tu sesión terminó. Vuelve a ingresar.');
      if (!await verifyPassword(body.currentPassword,users[0].password_hash)) throw fail(400,'La contraseña actual no es correcta.');
      if (kind === 'password') {
        if (body.newPassword === body.currentPassword) throw fail(400,'Elige una contraseña diferente de la actual.');
        await conn.execute('UPDATE em_users SET password_hash=? WHERE id=?',[await hashPassword(body.newPassword),req.actor.id]);
      }
      const all = kind === 'sessions' && body.scope === 'all';
      await conn.execute(`DELETE FROM em_sessions WHERE user_id=?${all ? '' : ' AND token_hash<>?'}`,all ? [req.actor.id] : [req.actor.id,req.sessionHash]);
      await conn.commit();
      if (all) res.clearCookie('em_session',{path:'/',secure:app.get('portal production'),httpOnly:true,sameSite:'strict'});
      res.json({ok:true,signedOut:all});
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }
  app.post('/api/password', limit, (req,res) => change(req,res,'password'));
  app.post('/api/sessions/revoke', limit, (req,res) => change(req,res,'sessions'));
}
