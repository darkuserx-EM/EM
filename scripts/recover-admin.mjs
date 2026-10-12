import {createInterface} from 'node:readline/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {connectDatabase,migrate} from '../server/database.mjs';
import {hashPassword} from '../server/security.mjs';

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Ejecuta esta recuperación en una terminal privada e interactiva del servidor.');
const reader=createInterface({input:process.stdin,output:process.stdout});let pool;
try {
 const email=(await reader.question('Correo del administrador existente: ')).trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new Error('Correo inválido.');
 console.log('Recupera solo esta cuenta administrativa: cierra sus sesiones, activa acceso sin vencimiento y exige cambiar la contraseña temporal. Conserva los registros.');
 if(await reader.question(`Escribe RECUPERAR ${email} para continuar: `)!==`RECUPERAR ${email}`)throw new Error('Recuperación cancelada.');
 const resetMfa=process.argv.includes('--reset-mfa');
 if(resetMfa && await reader.question('También desactiva el segundo factor. Escribe DESACTIVAR 2FA: ')!=='DESACTIVAR 2FA')throw new Error('Recuperación cancelada.');
 pool=connectDatabase(process.env);await migrate(pool);const conn=await pool.getConnection();
 try {
  await conn.beginTransaction();await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE');
  const [rows]=await conn.execute("SELECT id FROM em_users WHERE email=? AND role='Administrador' FOR UPDATE",[email]);
  if(rows.length!==1)throw new Error('No existe un administrador con ese correo. No se creó ninguna cuenta.');
  const password=randomBytes(24).toString('base64url'),id=rows[0].id;
  await conn.execute('UPDATE em_users SET password_hash=?,must_change_password=TRUE,active=TRUE,expires_at=NULL WHERE id=?',[await hashPassword(password),id]);
  if(resetMfa){await conn.execute('UPDATE em_users SET totp_enabled=FALSE,totp_secret=NULL,totp_pending=NULL,totp_pending_expires=NULL,totp_last_step=NULL WHERE id=?',[id]);await conn.execute('DELETE FROM em_recovery_codes WHERE user_id=?',[id]);}
  await conn.execute('DELETE FROM em_mfa_challenges WHERE user_id=?',[id]);
  await conn.execute('DELETE FROM em_sessions WHERE user_id=?',[id]);
  await conn.execute('INSERT INTO em_security_events (id,actor_id,target_id,action,created_at) VALUES (?,?,?,?,?)',[randomUUID(),'server-recovery',id,'account.emergency-recovery',Date.now()]);
  await conn.commit();console.log('Contraseña temporal (no guardarla en logs ni tickets): '+password);
 }catch(error){await conn.rollback();throw error;}finally{conn.release();}
}finally{reader.close();if(pool)await pool.end();}
