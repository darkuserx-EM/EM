import { randomUUID, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './security.mjs';
import { readDatabase, saveDatabase } from './database.mjs';
const fail = (status,message) => Object.assign(new Error(message),{status,expose:true});
export function registerAdminUserRoutes(app,{pool}) {
  const admin = (req,_res,next) => req.actor.rol === 'Administrador' ? next() : next(fail(403,'Solo administración puede gestionar cuentas.'));
  app.get('/api/admin/users',admin,async (_req,res) => {
    const [users] = await pool.query('SELECT id,email,name,role,client_id,technician_id,active,expires_at FROM em_users ORDER BY name');
    res.json({users});
  });
  app.post('/api/admin/users',admin,async (req,res) => {
    const b=req.body || {}; const email=String(b.email || '').trim().toLowerCase(); const name=String(b.name || '').trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || !name || name.length>160) throw fail(400,'Indica nombre y correo válidos.');
    if(!['Técnico','Cliente'].includes(b.role)) throw fail(400,'Selecciona Técnico o Cliente.');
    const days=Number(b.days ?? 7); if(!Number.isInteger(days) || days<1 || days>365) throw fail(400,'La vigencia debe ser de 1 a 365 días.');
    const password=b.password ?? randomBytes(24).toString('base64url');
    const requestId=b.requestId || randomUUID();
    if(!/^[a-f0-9-]{36}$/i.test(requestId)) throw fail(400,'Identificador de alta inválido.');
    if(typeof password!=='string' || password.length<14 || password.length>128) throw fail(400,'Usa una contraseña entre 14 y 128 caracteres.');
    const hash=await hashPassword(password); const id=randomUUID(); const expiresAt=Date.now()+days*86400000;
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction(); const previous=await readDatabase(conn,true); const db=structuredClone(previous);
      const [existing]=await conn.execute('SELECT * FROM em_users WHERE email=?',[email]);
      if(existing[0]?.creation_request===requestId && existing[0].role===b.role && existing[0].name===name && (b.role!=='Cliente'||existing[0].client_id===b.clientId) && await verifyPassword(password,existing[0].password_hash)) {
        await conn.commit();return res.json({id:existing[0].id,email,password,expiresAt:Number(existing[0].expires_at),technicianId:existing[0].technician_id,clientId:existing[0].client_id});
      }
      if(existing.length) throw fail(409,'Ya existe una cuenta con ese correo. Revisa la lista antes de repetir.');
      let technicianId=null; let clientId=null;
      if(b.role==='Cliente') {
        clientId=String(b.clientId || '');
        if(!db.entities.Cliente.some(row=>row.id===clientId)) throw fail(400,'Selecciona el cliente al que tendrá acceso.');
      } else {
        technicianId=b.technicianId || randomUUID();
        if(b.technicianId && !db.entities.Tecnico.some(row=>row.id===technicianId)) throw fail(400,'El técnico seleccionado no existe.');
        if(!b.technicianId) {
          const next=Math.max(0,...db.entities.Tecnico.map(row=>Number(String(row.codigo).replace(/^TEC-/,''))||0))+1;
          const now=new Date().toISOString();
          db.entities.Tecnico.push({id:technicianId,codigo:`TEC-${String(next).padStart(3,'0')}`,nombre:name,especialidad:'Por definir',activo:true,fecha_creacion:now,fecha_actualizacion:now,creado_por:req.actor.id,actualizado_por:req.actor.id});
          db.revision++; await saveDatabase(conn,db,previous);
        }
      }
      await conn.execute('INSERT INTO em_users (id,email,name,role,password_hash,client_id,technician_id,expires_at,creation_request) VALUES (?,?,?,?,?,?,?,?,?)',[id,email,name,b.role,hash,clientId,technicianId,expiresAt,requestId]);
      await conn.execute('INSERT INTO em_security_events (id,actor_id,target_id,action,created_at) VALUES (?,?,?,?,?)',[randomUUID(),req.actor.id,id,'account.created',Date.now()]);
      await conn.commit(); res.status(201).json({id,email,password,expiresAt,technicianId,clientId});
    } catch(error) {await conn.rollback(); if(error.code==='ER_DUP_ENTRY') throw fail(409,'La cuenta ya existe.'); throw error;} finally {conn.release();}
  });
  app.post('/api/admin/users/:id/revoke',admin,async (req,res) => {
    if(req.params.id===req.actor.id) throw fail(400,'No puedes revocar tu propia cuenta desde esta opción.');
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction(); const [users]=await conn.execute('SELECT id,role FROM em_users WHERE id=? FOR UPDATE',[req.params.id]);
      if(!users.length) throw fail(404,'Cuenta no encontrada.');
      if(users[0].role==='Administrador') throw fail(400,'Esta opción solo revoca cuentas operativas.');
      await conn.execute('UPDATE em_users SET active=FALSE WHERE id=?',[req.params.id]);
      await conn.execute('DELETE FROM em_sessions WHERE user_id=?',[req.params.id]);
      await conn.execute('INSERT INTO em_security_events (id,actor_id,target_id,action,created_at) VALUES (?,?,?,?,?)',[randomUUID(),req.actor.id,req.params.id,'account.revoked',Date.now()]);
      await conn.commit(); res.json({ok:true});
    } catch(error) {await conn.rollback();throw error;} finally {conn.release();}
  });
}
