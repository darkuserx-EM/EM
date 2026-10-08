import { AlertTriangle } from 'lucide-react';
import { Status } from '../../components/ui';
import type { EntityRecord } from '../../domain/model';
import { formatDate, formatTime } from '../../domain/format';
import { administrativeState, maintenanceState, maintenanceStates, operationalState, operationalStates, retiredEquipment, summarizeEquipment } from '../../domain/equipment-status';
import './equipment-status.css';

export function EquipmentStatus({ equipment }: { equipment: EntityRecord }) {
  return <span className="equipment-status-badges"><Status value={operationalState(equipment)} />{maintenanceState(equipment) === 'Mantenimiento pendiente' && <span className="maintenance-warning"><AlertTriangle size={13} aria-hidden="true" />Mantenimiento pendiente</span>}{retiredEquipment(equipment) && <span className="equipment-retired">{administrativeState(equipment) || 'Fuera de flota'}</span>}</span>;
}
export function EquipmentStatusNote({ equipment, showAuthor = false }: { equipment: EntityRecord; showAuthor?: boolean }) {
  const date = String(equipment.estado_actualizado_el ?? '');
  return <div className="equipment-status-note">{equipment.motivo_estado && <p>{equipment.motivo_estado}</p>}<small>{date && Number.isFinite(Date.parse(date)) ? <>Estado actualizado el {formatDate(date)} a las {formatTime(date)}{showAuthor && equipment.estado_actualizado_por ? ` · ${equipment.estado_actualizado_por}` : ''}</> : operationalState(equipment) === 'Pendiente de revisión' ? 'Estado operativo por confirmar; no hay una actualización registrada.' : 'Sin fecha de actualización registrada para esta clasificación.'}</small></div>;
}
export function FleetSummary({ equipment, selected = 'Todos', onSelect, loading = false }: { equipment: EntityRecord[]; selected?: string; onSelect?: (value: string) => void; loading?: boolean }) {
  const summary = summarizeEquipment(equipment);
  const cards = [{ label: 'Total', value: 'Todos', count: summary.total }, ...operationalStates.map(state => ({ label: state, value: state, count: summary.counts[state] }))];
  return <section className="fleet-overview" aria-label="Resumen de estados operativos" aria-busy={loading}><div className="fleet-state-cards">{cards.map(card => onSelect ? <button type="button" key={card.value} aria-pressed={selected === card.value} onClick={() => onSelect(card.value)}><span>{card.label}</span><strong>{loading ? '…' : card.count}</strong></button> : <div key={card.value}><span>{card.label}</span><strong>{loading ? '…' : card.count}</strong></div>)}</div><p className="fleet-maintenance-count"><AlertTriangle size={14} aria-hidden="true" /><span>{loading ? '…' : summary.maintenancePending} con mantenimiento pendiente <small>· Aviso independiente del estado operativo.</small></span></p></section>;
}
export function FleetFilters({ status, onStatus, maintenance, onMaintenance, includeRetired, onIncludeRetired }: { status: string; onStatus: (value: string) => void; maintenance: string; onMaintenance: (value: string) => void; includeRetired: boolean; onIncludeRetired: (value: boolean) => void }) {
  return <div className="fleet-status-filters"><label>Estado operativo<select aria-label="Filtrar estado operativo" value={status} onChange={event => onStatus(event.target.value)}><option value="Todos">Todos los estados</option>{operationalStates.map(state => <option key={state}>{state}</option>)}</select></label><label>Mantenimiento<select aria-label="Filtrar mantenimiento" value={maintenance} onChange={event => onMaintenance(event.target.value)}><option value="Todos">Todos los avisos</option>{maintenanceStates.map(state => <option key={state}>{state}</option>)}</select></label><label className="fleet-include-retired"><input type="checkbox" checked={includeRetired} onChange={event => onIncludeRetired(event.target.checked)} />Incluir vendidos y bajas</label></div>;
}
