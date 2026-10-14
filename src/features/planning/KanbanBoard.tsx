import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, GripVertical, UserRound } from 'lucide-react';
import type { Actor, EntityRecord } from '../../domain/model';
import { boardMoveAllowed, boardStates, calendarLabel, planningEquipmentLabel, type BoardState } from '../../domain/planning';
import { validDay } from '../../domain/maintenance-plan';
import { clientDisplayName } from '../../domain/client-profile';
import { canCreateTicketOrder } from '../../domain/technician-work';

const descriptions: Record<BoardState, string> = { Borrador: 'Por definir y asignar', Programada: 'Visita con fecha y técnico', 'En proceso': 'Trabajo en curso', 'En espera': 'Pendiente de continuar', Completada: 'Reportes cerrados' };
export function KanbanBoard({ orders, tickets = [], equipment, clients, technicians, actor, pending, today, onMove }: { orders: EntityRecord[]; tickets?: EntityRecord[]; equipment: EntityRecord[]; clients: EntityRecord[]; technicians: EntityRecord[]; actor: Actor; pending: string; today: string; onMove: (order: EntityRecord, state: BoardState) => void }) {
  const [dragged, setDragged] = useState(''); const [over, setOver] = useState<BoardState | ''>('');
  return <div className="planning-board" aria-label="Solicitudes y órdenes por estado">
    <section className="planning-column" id="solicitudes-por-atender" aria-label={`Solicitudes por atender: ${tickets.length}`}><header><h2>Solicitudes por atender<span>{tickets.length}</span></h2><p>Abiertas, con o sin fecha, todavía sin orden.</p></header><div className="planning-column-cards">
      {tickets.map(ticket => <article key={ticket.id} className="planning-card"><div className="planning-card-top"><span>{ticket.codigo}</span><span className="planning-priority">{ticket.prioridad}</span></div>
        <Link className="planning-card-name" to={`/tickets?ticket=${encodeURIComponent(ticket.id)}`}>{ticket.titulo}<strong>{planningEquipmentLabel(equipment.find(row => row.id === ticket.equipo_id))}</strong></Link>
        <p className="planning-card-client">{clientDisplayName(clients.find(row => row.id === ticket.cliente_id))}</p>
        <div className="planning-card-date"><CalendarDays size={14}/><span>{validDay(ticket.fecha_programada) ? calendarLabel(ticket.fecha_programada, { day: 'numeric', month: 'short' }) : 'Por programar'} · {ticket.estado}</span></div>
        <div className="planning-card-technician"><UserRound size={14}/><span>{technicians.find(row => row.id === ticket.responsable_id)?.nombre || 'Sin técnico'}</span></div>
        {canCreateTicketOrder(actor, ticket) && <Link className="button button-small" to={`/ordenes?ticket=${encodeURIComponent(ticket.id)}`}>Crear orden de atención</Link>}
      </article>)}{!tickets.length && <p className="planning-column-empty">Sin solicitudes por atender</p>}
    </div></section>{boardStates.map(state => {
    const items = orders.filter(order => order.estado === state).sort((a, b) => String(a.fecha_programada || '9999').localeCompare(String(b.fecha_programada || '9999')) || a.codigo.localeCompare(b.codigo));
    const dragOrder = orders.find(order => order.id === dragged); const allowed = !!dragOrder && boardMoveAllowed(dragOrder, state, actor.rol) && !pending;
    return <section key={state} className={`planning-column state-${state.toLowerCase().replaceAll(' ', '-')} ${over === state && allowed ? 'drop-target' : ''}`} aria-label={`${state}: ${items.length} órdenes`} onDragOver={event => { if (allowed) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(state); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(''); }} onDrop={event => { event.preventDefault(); if (dragOrder && allowed) onMove(dragOrder, state); setDragged(''); setOver(''); }}>
      <header><div><h2><i />{state}<span>{items.length}</span></h2><p>{descriptions[state]}</p></div></header>
      <div className="planning-column-cards">{items.map(order => {
        const machine = equipment.find(row => row.id === order.equipo_id); const client = clients.find(row => row.id === order.cliente_id || row.id === machine?.cliente_id); const technician = technicians.find(row => row.id === order.tecnico_id);
        const moves = boardStates.filter(target => boardMoveAllowed(order, target, actor.rol)); const late = validDay(order.fecha_programada) && order.fecha_programada < today && !['Completada', 'Cancelada'].includes(String(order.estado));
        return <article key={order.id} className={`planning-card ${pending === order.id ? 'saving' : ''} ${late ? 'overdue' : ''}`} draggable={!!moves.length && !pending} onDragStart={event => { setDragged(order.id); event.dataTransfer.setData('text/plain', order.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragged(''); setOver(''); }}>
          <div className="planning-card-top"><span>{order.codigo}</span><span className={`planning-priority ${['Alta','Crítica','Urgente'].includes(String(order.prioridad)) ? 'urgent' : ''}`}>{String(order.prioridad || 'Normal')}</span>{!!moves.length && <GripVertical size={14} aria-hidden="true" />}</div>
          <Link className="planning-card-name" to={`/ordenes?orden=${encodeURIComponent(order.id)}`}>{String(order.tipo || 'Servicio')}<strong>{planningEquipmentLabel(machine)}</strong></Link>
          <p className="planning-card-client">{client ? clientDisplayName(client) : 'Sin cliente asignado'}</p>
          {order.sintoma && <p className="planning-card-description">{String(order.sintoma)}</p>}
          <div className={`planning-card-date ${late ? 'overdue' : ''}`}><CalendarDays size={14} /><span>{validDay(order.fecha_programada) ? `${calendarLabel(order.fecha_programada, { day: 'numeric', month: 'short' })}${order.hora_programada ? ` · ${order.hora_programada}` : ''}` : 'Sin fecha'}{late && ' · atrasada'}</span></div>
          <div className="planning-card-technician"><UserRound size={14} /><span>{technician?.nombre || (actor.tecnico_id === order.tecnico_id ? actor.nombre : order.tecnico_id ? 'Técnico asignado' : 'Sin técnico')}</span></div>
          {!!moves.length && <label className="planning-move-label"><span>Mover orden</span><select value="" disabled={!!pending} onChange={event => { if (event.target.value) onMove(order, event.target.value as BoardState); }} aria-label={`Mover ${order.codigo}`}><option value="">{pending === order.id ? 'Guardando…' : 'Seleccionar estado…'}</option>{moves.map(target => <option key={target} value={target}>{target === 'Completada' ? 'Revisar y completar reporte…' : target}</option>)}</select></label>}
          {state === 'Completada' && <Link className="planning-report-link" to={`/ordenes?orden=${encodeURIComponent(order.id)}`}>Consultar reporte →</Link>}
        </article>;
      })}{!items.length && <p className="planning-column-empty">Sin órdenes en esta etapa</p>}</div>
    </section>;
  })}</div>;
}
