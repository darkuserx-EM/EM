import MfaSettings from './MfaSettings';
import { useState, type FormEvent } from 'react';
import { ErrorNotice, Modal } from '../../components/ui';
import { useActor } from '../../app/state';
import { useAuth } from '../../app/auth';
import { api } from '../../data/remote';
import { remoteSource } from '../../data/source';

export function AccountDialog({onClose}: {onClose: () => void}) {
  const actor = useActor();
  const [mode, setMode] = useState<'password' | 'sessions'>('password');
  const [scope, setScope] = useState('others');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const signOut = () => { remoteSource.clear(); useAuth.getState().setActor(undefined); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'password') {
        if (values.get('newPassword') !== values.get('confirmPassword')) throw new Error('Las contraseñas nuevas no coinciden.');
        await api('password',{currentPassword:values.get('currentPassword'),newPassword:values.get('newPassword')});
        setNotice('Contraseña actualizada. Se cerraron las demás sesiones; puedes continuar aquí.');
      } else {
        await api('sessions/revoke',{currentPassword:values.get('currentPassword'),scope});
        if (scope === 'all') { signOut(); return; }
        setNotice('Se cerraron las demás sesiones. Esta permanece abierta.');
      }
      form.reset();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try { await api('logout',{}); signOut(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="Mi cuenta" onClose={() => { if (!busy) onClose(); }}>
    <p className="modal-intro">{actor.nombre} · {actor.rol}</p>
    <div className="account-options" role="group" aria-label="Seguridad de la cuenta">
      <button type="button" className={`button ${mode === 'password' ? 'button-dark' : ''}`} aria-pressed={mode === 'password'} disabled={busy} onClick={() => {setMode('password');setError('');setNotice('');}}>Cambiar contraseña</button>
      <button type="button" className={`button ${mode === 'sessions' ? 'button-dark' : ''}`} aria-pressed={mode === 'sessions'} disabled={busy} onClick={() => {setMode('sessions');setError('');setNotice('');}}>Cerrar otras sesiones</button>
    </div>
    <form onSubmit={submit} key={mode} className="account-form">
      <fieldset disabled={busy} className="account-fields">
        <label>Contraseña actual<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/></label>
        {mode === 'password' ? <>
          <label>Nueva contraseña<input name="newPassword" type="password" autoComplete="new-password" required minLength={14} maxLength={128}/><small>Entre 14 y 128 caracteres. Puedes usar una frase larga.</small></label>
          <label>Repetir nueva contraseña<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={14} maxLength={128}/></label>
          <p className="field-help">Al cambiarla se cerrarán tus sesiones en los demás navegadores y dispositivos.</p>
        </> : <label>Sesiones que deseas cerrar<select value={scope} onChange={event => setScope(event.target.value)}><option value="others">Las demás sesiones; continuar aquí</option><option value="all">Todas, incluida esta sesión</option></select><small>Los dispositivos afectados deberán iniciar sesión nuevamente.</small></label>}
      </fieldset>
      {notice && <p className="auth-notice" role="status">{notice}</p>}<ErrorNotice message={error}/>
      <button type="submit" className="button button-dark" disabled={busy}>{busy ? 'Procesando…' : mode === 'password' ? 'Guardar nueva contraseña' : scope === 'all' ? 'Cerrar todas mis sesiones' : 'Cerrar las demás sesiones'}</button>
    </form>
    {actor.rol === 'Administrador' && <MfaSettings/>}
    <div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={logout}>Cerrar esta sesión</button></div>
  </Modal>;
}
