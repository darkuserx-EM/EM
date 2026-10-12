import SecurityEvents from './SecurityEvents';
import UserAccounts from './UserAccounts';
import { serverMode } from '../../data/source';
import { Check, LockKeyhole, Route, ShieldCheck } from 'lucide-react';
import { SectionTitle } from '../../components/ui';
import { DataTable } from '../../components/design-system';
import { stages } from '../../domain/model';
import { demoUsers } from '../../data/seed';
import './admin.css';

const permissionProfiles = ['Área', 'Administrador', 'Coordinador', 'Técnico', 'Cliente', 'Operador'];

export function AccessPage() {
  const rows = [
    ['Clientes y flota', 'Completo', 'Consulta', '—', 'Su empresa', 'Un equipo por QR'],
    ['Importar y exportar Excel', 'Completo', '—', '—', '—', '—'],
    ['Tickets y órdenes', 'Completo', 'Completo', 'Sus OT', 'Su empresa', '—'],
    ['Contratos, checklist, horas y viáticos', 'Pendiente', 'Pendiente', 'Pendiente', '—', '—'],
    ['Costos internos', 'Completo', 'Por definir', '—', '—', '—'],
    ['Configuración y respaldos', 'Completo', '—', '—', '—', '—'],
  ];
  return <><SectionTitle eyebrow="CADA PERSONA, SU ESPACIO" title="Roles y accesos" description="Una base de permisos para que cada perfil tenga la vista que necesita." />{serverMode && <><UserAccounts /><SecurityEvents /></>}<div className="info-banner"><LockKeyhole size={22} /><div><strong>{serverMode ? 'Acceso por cuenta y sesión.' : 'Accesos simulados durante la demostración.'}</strong><p>{serverMode ? 'El servidor verifica la identidad y filtra cada recurso. Administración gestiona cuentas; los técnicos trabajan en sus órdenes y cada cliente consulta únicamente su empresa.' : 'La navegación y los datos de ejemplo se filtran por perfil. La protección real deberá aplicarse en el servidor antes de incorporar información operativa.'}</p></div></div><section className="panel"><div className="panel-heading"><div><h2>Matriz de permisos</h2><p>Los módulos se habilitan conforme a las etapas del proyecto.</p></div><ShieldCheck size={23} /></div><DataTable className="permission-table" caption="Permisos por perfil" rows={rows} rowKey={row => row[0]} columns={permissionProfiles.map((label, index) => ({ id: label, header: label, cell: (row: string[]) => index === 0 ? <strong>{row[0]}</strong> : row[index] === 'Completo' ? <span className="permission-yes"><Check size={14} />Completo</span> : row[index] }))} /><p className="table-note">Pendiente de definir: visibilidad de costos del coordinador. Por ahora, su navegación no incluye costos ni configuración. El operador tendrá un enlace para un solo equipo, sin cuenta.</p></section>{!serverMode && <><h2 className="standalone-title">Perfiles para probar la navegación</h2><div className="user-grid">{demoUsers.map(user => <div className="panel user-card" key={user.id}><span className="role-avatar"><ShieldCheck size={21} /></span><div><strong>{user.nombre}</strong><small>{user.rol}</small></div></div>)}</div><p className="field-help">Usa el selector de la esquina superior derecha para cambiar de perfil.</p></>}</>;
}
export function PlanPage() {
  return <><SectionTitle eyebrow="PASO A PASO, CONTIGO" title="Plan de trabajo" description="Diez entregas pequeñas para revisar, ajustar y avanzar con claridad." /><div className="plan-summary panel"><div className="large-icon green"><Route size={28} /></div><div><h2>Operación y acceso por perfiles</h2><p>Clientes, flota, solicitudes, órdenes, mantenimiento, agenda y planificador conectados. Contratos, checklist diario, horas y viáticos continúan pendientes por alcance.</p></div><span className="review-pill">En revisión</span></div><div className="roadmap">{stages.map(stage => <article className={`roadmap-item ${[1,3,4,5,6,9,10].includes(stage.id) ? 'current' : ''}`} key={stage.id}><div className="roadmap-number">{String(stage.id).padStart(2, '0')}</div><div><h2>{stage.title}</h2><p>{stage.detail}</p></div><span className={`roadmap-status ${[1,3,4,5,6,9,10].includes(stage.id) ? 'text-green' : ''}`}>{[2,7,8].includes(stage.id) ? 'Alcance parcial / pendiente' : <><Check size={15}/>Disponible para validación</>}</span></article>)}</div><div className="info-banner"><ShieldCheck size={22} /><div><strong>Operación conectada y cambios verificables.</strong><p>Servidor y MySQL conectados. Revisa los módulos habilitados y conserva respaldos antes de importaciones o cambios masivos. Los adjuntos de órdenes tienen acceso privado por usuario.</p></div></div></>;
}
