import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Building2, Forklift, QrCode } from 'lucide-react';
import { useActor, useRows } from '../../app/state';
import { Brand, EmptyState, ErrorNotice } from '../../components/ui';
import { formatHourMeter } from '../../domain/format';
import { filterEquipmentStatus } from '../../domain/equipment-status';
import { clientDisplayName } from '../../domain/client-profile';
import { serverMode } from '../../data/source';
import { EquipmentPhoto } from '../records/EquipmentImages';
import { EquipmentStatus, EquipmentStatusNote, FleetSummary, FleetFilters } from '../fleet/EquipmentStatus';

export function ClientPortal() {
  const actor = useActor(); const clients = useRows('Cliente'); const query = useRows('Equipo');
  const [status, setStatus] = useState('Todos'); const [maintenance, setMaintenance] = useState('Todos'); const [includeRetired, setIncludeRetired] = useState(false);
  const scope = filterEquipmentStatus(query.rows, 'Todos', 'Todos', includeRetired);
  const equipment = filterEquipmentStatus(scope, status, maintenance, true);
  return <div className="client-portal">
    <div className="portal-eyebrow"><span />PORTAL DEL CLIENTE · VISTA PREVIA</div>
    <div className="portal-title"><div><h1>Tu operación,<br /><em>más cerca.</em></h1><p>{clients.rows[0] ? clientDisplayName(clients.rows[0]) : actor.nombre} · Bienvenido a tu espacio.</p></div><Building2 size={88} strokeWidth={0.8} /></div>
    <div className="portal-notice">{serverMode ? 'Consulta el estado reportado de los equipos de tu empresa. ' : 'Vista previa con equipos ficticios de una sola empresa. '}Solicitudes, seguimiento y documentos se habilitarán en la etapa 9.</div>
    <ErrorNotice message={query.error || clients.error} />
    <FleetSummary equipment={scope} selected={status} onSelect={setStatus} loading={query.loading} />
    <FleetFilters status={status} onStatus={setStatus} maintenance={maintenance} onMaintenance={setMaintenance} includeRetired={includeRetired} onIncludeRetired={setIncludeRetired} />
    <div className="section-caption"><h2>Tus equipos</h2><span>{query.loading ? 'Cargando…' : `${equipment.length} equipos${serverMode ? '' : ' de ejemplo'}`}</span></div>
    <div className="portal-equipment-grid">{equipment.map(row => <article key={row.id} className="portal-equipment"><div className="portal-equipment-top"><EquipmentPhoto equipment={row} /><EquipmentStatus equipment={row} /></div><span className="portal-code">{row.codigo}</span><h3>{row.marca} {row.modelo}</h3><p>{row.tipo}{row.id_interno_cliente ? ` · ID: ${row.id_interno_cliente}` : ''}</p><EquipmentStatusNote equipment={row} /><div className="portal-equipment-foot"><span>Horómetro</span><strong>{formatHourMeter(row.horometro)}</strong></div></article>)}</div>
    {!query.loading && !query.error && !equipment.length && <EmptyState title="Sin equipos con estos filtros" description="Selecciona todos los estados y avisos para consultar tu flota." />}
    <div className="portal-bottom"><span>Expertos en Montacargas, S.A.</span><span>Siempre en movimiento<ArrowUpRight size={15} /></span></div>
  </div>;
}
export function OperatorPreview() {
  return <div className="operator-preview client-theme"><header><Brand /></header><main><span className="portal-eyebrow">REVISIÓN DIARIA · VISTA PREVIA</span><div className="operator-symbol"><QrCode size={64} strokeWidth={1.2} /></div><h1>Un buen día<br />empieza con<br /><em>una revisión.</em></h1><p>Este será el acceso sin cuenta para revisar un equipo desde el celular. El formulario, el QR y el registro de horómetro se construirán en la etapa 7.</p><div className="operator-placeholder"><Forklift size={23} /><div><strong>TCL-001</strong><small>Equipo ficticio de demostración</small></div></div><Link className="button button-orange" to="/inicio"><ArrowLeft size={17} />Volver al portal</Link></main><footer>EXPERTOS EN MONTACARGAS · GUATEMALA</footer></div>;
}
