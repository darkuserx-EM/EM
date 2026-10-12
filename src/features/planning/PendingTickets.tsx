import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { EntityRecord } from '../../domain/model';
import { planningEquipmentLabel } from '../../domain/planning';
import { clientDisplayName } from '../../domain/client-profile';
import { operationDateLabel } from '../operations/operations-ui';

export function PendingTickets({ tickets, equipment, clients, manager }: { tickets: EntityRecord[]; equipment: EntityRecord[]; clients: EntityRecord[]; manager: boolean }) {
  const [limit, setLimit] = useState(6);
  return <aside className="planning-pending" aria-label="Solicitudes por programar">
    <header><h2>Por programar <span>{tickets.length}</span></h2><p>Solicitudes sin fecha ni orden. Prioridad y antigüedad.</p></header>
    {!tickets.length ? <p className="planning-pending-empty">No hay solicitudes por programar con estos filtros.</p> : <ul>{tickets.slice(0, limit).map(ticket => <li key={ticket.id}>
      <div><span>{ticket.codigo}</span><span className={`planning-priority ${['Alta', 'Crítica'].includes(String(ticket.prioridad)) ? 'urgent' : ''}`}>{ticket.prioridad || 'Por revisar'}</span></div>
      <Link to={`/tickets?ticket=${encodeURIComponent(ticket.id)}`}><strong>{ticket.titulo || 'Solicitud de servicio'}</strong><span>{planningEquipmentLabel(equipment.find(row => row.id === ticket.equipo_id))}</span></Link>
      <p>{clientDisplayName(clients.find(row => row.id === ticket.cliente_id))}</p>
      <small>{ticket.estado} · Desde {operationDateLabel(ticket.fecha_creacion)}</small>
    </li>)}</ul>}
    {tickets.length > limit && <button className="button" onClick={() => setLimit(limit + 6)}>Mostrar más solicitudes</button>}
    <footer>{manager ? 'Abre una solicitud para revisarla y programar la atención.' : 'Coordinación asigna la fecha de atención.'} Sin fecha asignada, no se coloca en un día del calendario.</footer>
  </aside>;
}
