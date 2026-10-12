import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../data/remote';
import { ErrorNotice } from '../../components/ui';

export default function MfaSettings() {
  const [status,setStatus]=useState<{configured:boolean;enabled:boolean}>();
  const [secret,setSecret]=useState(''),[codes,setCodes]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{api<{configured:boolean;enabled:boolean}>('2fa/status').then(setStatus).catch(cause=>setError((cause as Error).message));},[]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget,values=new FormData(form);setBusy(true);setError('');
    try {
      const action=status?.enabled?'disable':secret?'enable':'setup';
      const result=await api<{secret?:string;recoveryCodes?:string[]}>(`2fa/${action}`,{currentPassword:values.get('currentPassword'),code:values.get('code')});
      if(result.secret)setSecret(result.secret);
      else {setSecret('');setCodes(result.recoveryCodes||[]);setStatus({configured:true,enabled:action==='enable'});}
      form.reset();
    }catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  return <section className="account-form" aria-label="Segundo factor">
    <h2>Segundo factor</h2><ErrorNotice message={error}/>
    {!status?<p>Consultando configuración…</p>:!status.configured?<p>Disponible cuando se configure la clave de cifrado en el alojamiento. Tu acceso actual se mantiene.</p>:<>
      <p>{status.enabled?'Activado. Al ingresar también necesitas tu aplicación de autenticación o un código de recuperación.':'Agrega una segunda verificación a tu cuenta administrativa.'}</p>
      {codes.length>0?<div role="status"><h3>Guarda tus códigos de recuperación</h3><p>Solo se muestran ahora. Cada uno se usa una vez. Guárdalos en un lugar privado, separado del teléfono.</p><ul>{codes.map(code=><li key={code}><code>{code}</code></li>)}</ul><button className="button" type="button" onClick={()=>setCodes([])}>Ya guardé los códigos</button></div>:<form onSubmit={submit}>
        <fieldset className="account-fields" disabled={busy}>
          {secret&&<><p>Agrega una cuenta manualmente en tu aplicación de autenticación: Portal EM, clave de abajo, basada en tiempo (TOTP), 6 dígitos y 30 segundos.</p><label>Clave de configuración<input readOnly value={secret} autoComplete="off"/></label><small>Esta configuración vence en 10 minutos. No compartas la clave.</small></>}
          <label>Confirma tu contraseña actual<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/></label>
          {(secret||status.enabled)&&<label>{status.enabled?'Código vigente o de recuperación':'Código de la aplicación'}<input name="code" autoComplete="one-time-code" required maxLength={100}/></label>}
          <button className="button" type="submit">{busy?'Procesando…':status.enabled?'Desactivar segundo factor':secret?'Verificar y activar':'Configurar segundo factor'}</button>
        </fieldset>
      </form>}
    </>}
  </section>;
}
