import {useEffect,useState,useRef,type FormEvent} from 'react';
import {api} from '../../data/remote';
import {useRows,useActor} from '../../app/state';
import {clientDisplayName} from '../../domain/client-profile';
import {ErrorNotice,Modal} from '../../components/ui';
import {Badge} from '../../components/design-system';
type User={id:string;email:string;name:string;role:string;active:number;expires_at:number|null;must_change_password:number;technician_id?:string|null};
type Action='renew'|'reactivate'|'reset-password'|'revoke'|'technician';
type Credentials={email:string;password:string;expiresAt?:number|null};
const privileged=(role:string)=>['Administrador','Coordinador'].includes(role);
const labels:Record<Action,string>={renew:'Renovar',reactivate:'Reactivar','reset-password':'Restablecer contraseña',revoke:'Revocar',technician:'Participar en trabajos'};
const newAttempt=()=>({requestId:crypto.randomUUID(),password:Array.from(crypto.getRandomValues(new Uint8Array(24))).map(v=>v.toString(16).padStart(2,'0')).join('')});
export default function UserAccounts(){
 const actor=useActor(),clients=useRows('Cliente'),technicians=useRows('Tecnico');
 const [users,setUsers]=useState<User[]>([]),[role,setRole]=useState('Técnico'),[techId,setTechId]=useState(''),[unlimited,setUnlimited]=useState(false);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[credentials,setCredentials]=useState<Credentials|null>(null);
 const [operation,setOperation]=useState<{user:User;action:Action}|null>(null),[notice,setNotice]=useState('');
 const attempt=useRef(newAttempt());
 const refresh=()=>api<{users:User[]}>('admin/users').then(result=>setUsers(result.users));
 useEffect(()=>{refresh().catch(cause=>setError(cause.message));},[]);
 async function create(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,data=new FormData(form);setBusy(true);setError('');setNotice('');setCredentials(null);
  try{
   const result=await api<Credentials>('admin/users',{...attempt.current,name:data.get('name'),email:data.get('email'),role,clientId:data.get('clientId'),technicianId:techId,specialty:data.get('specialty'),currentPassword:data.get('currentPassword'),days:privileged(role)&&unlimited?null:Number(data.get('days'))});
   setCredentials(result);form.reset();setTechId('');attempt.current=newAttempt();await refresh();
  }catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
 }
 async function manage(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!operation)return;const data=new FormData(e.currentTarget);setBusy(true);setError('');setCredentials(null);
  try{
   const result=await api<Credentials>('admin/users/'+encodeURIComponent(operation.user.id)+'/'+operation.action,{days:data.get('unlimited')?null:Number(data.get('days')||90),currentPassword:data.get('currentPassword'),technicianId:data.get('technicianId')});
   if(result.password)setCredentials(result);else setNotice('Acceso actualizado. Los registros de trabajo se conservan.');
   setOperation(null);await refresh();
  }catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
 }
 return <section className="panel access-accounts"><h2>Cuentas de acceso</h2><p className="field-help">Cada perfil conserva su ámbito de trabajo. Las contraseñas temporales deben cambiarse al ingresar.</p><ErrorNotice message={error}/>{notice&&<p role="status">{notice}</p>}
 <form onSubmit={create}><fieldset disabled={busy} className="ops-filters">
  <label>Nombre<input required name="name" maxLength={160}/></label><label>Correo de acceso<input required name="email" type="email" maxLength={254}/></label>
  <label>Perfil<select value={role} onChange={e=>{setRole(e.target.value);setUnlimited(e.target.value==='Administrador');}}><option>Técnico</option><option>Cliente</option><option>Coordinador</option><option>Administrador</option></select></label>
  {role==='Cliente'&&<label>Empresa autorizada<select name="clientId" required><option value="">Selecciona…</option>{clients.rows.map(row=><option key={row.id} value={row.id}>{clientDisplayName(row)}</option>)}</select></label>}
  {['Técnico','Coordinador'].includes(role)&&<><label>Registro del técnico<select value={techId} onChange={e=>setTechId(e.target.value)}><option value="">Crear nuevo técnico</option>{technicians.rows.map(row=><option key={row.id} value={row.id}>{row.nombre}</option>)}</select></label>{!techId&&<label>Especialidad<input name="specialty" required maxLength={120}/></label>}</>}
  {privileged(role)&&<label className="check-field"><input type="checkbox" checked={unlimited} onChange={e=>setUnlimited(e.target.checked)}/>Sin vencimiento</label>}
  {!(privileged(role)&&unlimited)&&<label>Vigencia en días<input type="number" name="days" defaultValue={90} required min={1} max={365}/></label>}
  {privileged(role)&&<label>Tu contraseña de administrador<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/></label>}
  <button className="button button-dark" type="submit">{busy?'Guardando…':'Crear cuenta'}</button></fieldset></form>
 {credentials&&<div className="access-credentials" role="status"><strong>Guarda esta contraseña temporal ahora; no se volverá a mostrar.</strong><p>{credentials.email}</p><code>{credentials.password}</code>{credentials.expiresAt!==undefined&&<p>{credentials.expiresAt?'Vence: '+new Date(credentials.expiresAt).toLocaleString('es-GT',{timeZone:'America/Guatemala'}):'Sin vencimiento'}</p>}<p>La persona deberá cambiarla antes de acceder a los datos.</p><button className="button button-small" onClick={()=>setCredentials(null)}>Ya la guardé · ocultar</button></div>}
 <div className="table-scroll"><table className="data-table"><thead><tr><th>Persona</th><th>Perfil</th><th>Estado y vigencia</th><th>Acceso</th></tr></thead><tbody>{users.map(user=>{
  const days=user.expires_at?Math.ceil((Number(user.expires_at)-Date.now())/86400000):null;
  const expired=days!==null&&days<=0,soon=days!==null&&days>0&&days<=7;
  return <tr key={user.id}><td><strong>{user.name}</strong><small style={{display:'block'}}>{user.email}</small></td><td>{user.role}{user.technician_id&&<small>Participa en trabajos</small>}</td><td><Badge tone={!user.active||expired?'danger':soon?'warning':'success'}>{!user.active?'Revocada':expired?'Vencida':soon?'Vence en '+days+' días':'Activa'}</Badge><small style={{display:'block'}}>{user.expires_at?new Date(Number(user.expires_at)).toLocaleDateString('es-GT',{timeZone:'America/Guatemala'}):'Sin vencimiento'}</small>{!!user.must_change_password&&<small>Cambio de contraseña pendiente</small>}</td><td><div className="ops-table-actions">{(user.active?['renew','reset-password','revoke',...(user.role==='Coordinador'&&!user.technician_id?['technician']:[])]:['reactivate','reset-password']).map(action=>{
   if(user.id===actor.id&&['revoke','reset-password'].includes(action))return null;
   if(action==='renew'&&!user.expires_at)return null;
   return <button key={action} className="button button-small" disabled={busy} onClick={()=>{setError('');setCredentials(null);setOperation({user,action:action as Action});}}>{labels[action as Action]}</button>;
  })}</div></td></tr>;
 })}</tbody></table></div>
 {operation&&<Modal title={labels[operation.action]+' · '+operation.user.name} onClose={()=>{if(!busy)setOperation(null);}}><form onSubmit={manage}><fieldset disabled={busy} className="account-fields"><p>{operation.action==='technician'?'Vincula su participación sin cambiar su perfil, contraseña ni historial.':operation.action==='revoke'?'Se cerrarán sus sesiones. Su historial de trabajo se conservará.':operation.action==='reset-password'?'Se cerrarán todas sus sesiones y recibirá una contraseña temporal nueva. Si la cuenta está vencida o revocada, también debes renovar o reactivar su acceso.':operation.action==='renew'?'La vigencia se amplía desde el vencimiento actual o desde hoy si ya venció.':'La cuenta recuperará acceso con una nueva vigencia; deberá iniciar sesión nuevamente.'}</p>
 {operation.action==='technician'&&<label>Registro del técnico<select name="technicianId"><option value="">Crear registro con el nombre del coordinador</option>{technicians.rows.filter(row=>row.activo!==false).map(row=><option key={row.id} value={row.id}>{row.nombre}</option>)}</select></label>}
 {['renew','reactivate'].includes(operation.action)&&<><label>Vigencia en días<input type="number" name="days" min={1} max={365} required defaultValue={90}/></label>{privileged(operation.user.role)&&<label className="check-field"><input name="unlimited" type="checkbox" defaultChecked={!operation.user.expires_at}/>Sin vencimiento</label>}</>}
 {(privileged(operation.user.role)||operation.action==='reset-password')&&<label>Tu contraseña de administrador<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/></label>}
 <ErrorNotice message={error}/><div className="modal-actions"><button className="button" type="button" onClick={()=>setOperation(null)}>Cancelar</button><button className="button button-dark" type="submit">{busy?'Procesando…':labels[operation.action]}</button></div></fieldset></form></Modal>}
 </section>;
}
