import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Building2, Forklift, QrCode } from 'lucide-react';
import { useActor, useRows } from '../../app/state';
import { Brand, Status } from '../../components/ui';
import { formatNumber } from '../../domain/format';

export function ClientPortal() {
  const actor = useActor(); const clients = useRows('Cliente').rows; const equipment = useRows('Equipo').rows;
  return <div className="client-portal"><div className="portal-eyebrow"><span />PORTAL DEL CLIENTE · VISTA PREVIA</div><div className="portal-title"><div><h1>Tu operación,<br /><em>más cerca.</em></h1><p>{clients[0]?.nombre ?? actor.nombre} · Bienvenido a tu espacio.</p></div><Building2 size={88} strokeWidth={0.8} /></div><div className="portal-notice">Estás viendo una demostración con datos ficticios de una sola empresa. Solicitudes, seguimiento y documentos se habilitarán en la etapa 9.</div><div className="section-caption"><h2>Tus equipos</h2><span>{equipment.length} equipos de ejemplo</span></div><div className="portal-equipment-grid">{equipment.map(row => <article key={row.id} className="portal-equipment"><div className="portal-equipment-top"><Forklift size={48} strokeWidth={1} /><Status value={String(row.estado)} /></div><span className="portal-code">{row.codigo}</span><h3>{row.marca} {row.modelo}</h3><p>{row.tipo}</p><div className="portal-equipment-foot"><span>Horómetro</span><strong>{formatNumber(Number(row.horometro))} h</strong></div></article>)}</div><div className="portal-bottom"><span>Expertos en Montacargas, S.A.</span><span>Siempre en movimiento<ArrowUpRight size={15} /></span></div></div>;
}
export function OperatorPreview() {
  return <div className="operator-preview client-theme"><header><Brand /></header><main><span className="portal-eyebrow">REVISIÓN DIARIA · VISTA PREVIA</span><div className="operator-symbol"><QrCode size={64} strokeWidth={1.2} /></div><h1>Un buen día<br />empieza con<br /><em>una revisión.</em></h1><p>Este será el acceso sin cuenta para revisar un equipo desde el celular. El formulario, el QR y el registro de horómetro se construirán en la etapa 7.</p><div className="operator-placeholder"><Forklift size={23} /><div><strong>TCL-001</strong><small>Equipo ficticio de demostración</small></div></div><Link className="button button-orange" to="/inicio"><ArrowLeft size={17} />Volver al portal</Link></main><footer>EXPERTOS EN MONTACARGAS · GUATEMALA</footer></div>;
}
