import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Brand, ErrorNotice } from '../components/ui';
import { api, setCsrf } from '../data/remote';
import { remoteSource, serverMode } from '../data/source';
import { useAuth } from './auth';
import type { Actor } from '../domain/model';

export function AuthGate({ children }: { children: ReactNode }) {
  const actor = useAuth(state => state.actor); const setActor = useAuth(state => state.setActor);
  const [challenge,setChallenge]=useState('');
  const [mustChange, setMustChange] = useState(false);
  const [loading, setLoading] = useState(serverMode); const [setup, setSetup] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  async function session() {
    const value = await api<{ actor: Actor; csrf: string; mustChangePassword?: boolean }>('session');
    if (value.mustChangePassword) { remoteSource.clear(); setActor(undefined); setCsrf(value.csrf); setMustChange(true); setNotice(''); return; }
    setMustChange(false);
    setCsrf(value.csrf); await remoteSource.refresh();
    if (!useAuth.getState().actor) setActor(value.actor);
  }
  useEffect(() => {
    if (!serverMode) return;
    let active = true;
    (async () => { try { const status = await api<{ needsSetup: boolean }>('setup-status'); if (active) setSetup(status.needsSetup); if (!status.needsSetup) await session(); } catch (cause) { if (active && (cause as {code?:string}).code === 'SESSION_IDLE') setNotice('Tu sesión se cerró por inactividad. Vuelve a ingresar.'); else if (active && (cause as { status?: number }).status !== 401) setError((cause as Error).message); } finally { if (active) setLoading(false); } })();
    const expire = (event: Event) => { remoteSource.clear(); setActor(undefined); setMustChange(false); setNotice((event as CustomEvent<string>).detail === 'SESSION_IDLE' ? 'Tu sesión se cerró por inactividad. Vuelve a ingresar.' : 'Tu sesión terminó. Vuelve a ingresar.'); };
    const requirePassword = () => { session().catch(cause => setError((cause as Error).message)); };
    const accessChanged = (event: Event) => { setActor((event as CustomEvent<Actor>).detail); };
    window.addEventListener('portal-session-expired', expire);
    window.addEventListener('portal-access-changed', accessChanged);
    window.addEventListener('portal-password-required', requirePassword);
    return () => { active = false; window.removeEventListener('portal-session-expired', expire); window.removeEventListener('portal-access-changed', accessChanged); window.removeEventListener('portal-password-required', requirePassword); };
  }, []);
  useEffect(() => {
    if (!serverMode || !actor) return;
    let running = false;
    const refresh = async () => { if (running || document.hidden) return; running = true; try { await remoteSource.refresh(true); setError(''); } catch (cause) { setError((cause as Error).message); } finally { running = false; } };
    let lastActivity=0;
    const activity = (event: Event) => { if (!event.isTrusted || document.hidden || Date.now()-lastActivity<60000) return; lastActivity=Date.now(); api('session/activity',{}).catch(cause=>setError((cause as Error).message)); };
    for (const name of ['pointerdown','keydown','scroll']) window.addEventListener(name,activity,{passive:true});
    const timer = window.setInterval(refresh, 15000); window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); for(const name of ['pointerdown','keydown','scroll']) window.removeEventListener(name,activity); };
  }, [actor]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
    try {
      if (setup) { if (values.password !== values.confirmPassword) throw new Error('Las contraseñas no coinciden.'); await api('setup', values); form.reset(); setSetup(false); setNotice('Cuenta creada. Inicia sesión con tu correo y contraseña.'); }
      else { const result=await api<{needsTotp?:boolean;challenge?:string}>('login', values); if(result.needsTotp&&result.challenge){form.reset();setChallenge(result.challenge);setNotice('');} else await session(); }
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  if (!serverMode) return children;
  if (loading) return <div className="loading-screen">Conectando con Portal EM…</div>;
  if (mustChange) return <main className="auth-page"><section className="auth-card"><Brand/><h1>Define tu contraseña</h1><p>La contraseña recibida es temporal. Elige una propia para acceder al portal.</p><form onSubmit={async event => {
    event.preventDefault(); const values = new FormData(event.currentTarget); setBusy(true); setError('');
    try {
      if (values.get('newPassword') !== values.get('confirmPassword')) throw new Error('Las contraseñas nuevas no coinciden.');
      await api('password', { currentPassword: values.get('currentPassword'), newPassword: values.get('newPassword') }); await session();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }}><label>Contraseña temporal<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/></label><label>Nueva contraseña<input name="newPassword" type="password" autoComplete="new-password" required minLength={14} maxLength={128}/></label><label>Repetir nueva contraseña<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={14} maxLength={128}/></label><small>Entre 14 y 128 caracteres. Puedes usar una frase larga.</small><ErrorNotice message={error}/><button className="button button-dark" disabled={busy} type="submit">{busy ? 'Guardando…' : 'Guardar y entrar'}</button><button className="button" disabled={busy} type="button" onClick={async () => { try { await api('logout', {}); remoteSource.clear(); setActor(undefined); setMustChange(false); } catch (cause) { setError((cause as Error).message); } }}>Cerrar sesión</button></form></section></main>;
  if (challenge) return <main className="auth-page"><section className="auth-card"><Brand/><h1>Verifica tu acceso</h1><p>Ingresa el código de tu aplicación de autenticación o uno de tus códigos de recuperación.</p><form onSubmit={async event=>{event.preventDefault();const code=new FormData(event.currentTarget).get('code');setBusy(true);setError('');try{await api('login/totp',{challenge,code});setChallenge('');await session();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}}><label>Código de verificación<input name="code" autoComplete="one-time-code" required maxLength={100} autoFocus/></label><ErrorNotice message={error}/><button className="button button-dark" disabled={busy} type="submit">Verificar y entrar</button><button className="button" disabled={busy} type="button" onClick={()=>{setChallenge('');setError('');}}>Volver al inicio de sesión</button></form></section></main>;
  if (actor) return <>{error && <div className="connection-notice" role="status">{error} Los cambios necesitan conexión con el servidor.</div>}{children}</>;
  return <main className="auth-page"><section className="auth-card"><Brand /><span className="eyebrow">PRUEBAS DEL PORTAL OPERATIVO</span><h1>{setup ? 'Configurar administración' : 'Bienvenido a Portal EM'}</h1><p>{setup ? 'Crea la primera cuenta con la clave de instalación configurada en Hostinger.' : 'Ingresa para trabajar con la información compartida de clientes y equipos.'}</p>{notice && <p role="status" className="auth-notice">{notice}</p>}<form onSubmit={submit}>{setup && <><label>Clave de instalación<input name="setupToken" type="password" autoComplete="off" required minLength={32} /></label><label>Nombre<input name="name" autoComplete="name" required maxLength={160} /></label></>}<label>Correo electrónico<input name="email" type="email" autoComplete="username" required maxLength={254} /></label><label>Contraseña<input name="password" type="password" autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 14 : 1} maxLength={128} /></label>{setup && <label>Confirmar contraseña<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={14} maxLength={128} /></label>}<ErrorNotice message={error} /><button className="button button-dark" type="submit" disabled={busy}>{busy ? 'Conectando…' : setup ? 'Crear cuenta de administración' : 'Iniciar sesión'}</button></form><p className="auth-footnote">Expertos en Montacargas, S.A. · Ambiente de pruebas<br />Usa registros de prueba durante la validación inicial.</p></section></main>;
}
