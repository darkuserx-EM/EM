import { useState, type FormEvent } from 'react';
import { useActor, useRows, useToast } from '../../app/state';
import { ErrorNotice, Modal, useUnsavedChanges } from '../../components/ui';
import { getDataSource } from '../../data/source';
import { enabledEquipment } from '../../domain/technician-work';
import type { EntityRecord } from '../../domain/model';
import { equipmentLabel } from '../operations/operations-ui';
import { clientDisplayName } from '../../domain/client-profile';

function EquipmentGrant({ technician, onClose }: { technician: EntityRecord; onClose: () => void }) {
  const actor = useActor(); const notify = useToast(state => state.notify);
  const equipment = useRows('Equipo', true); const clients = useRows('Cliente', true);
  const [selected, setSelected] = useState(() => enabledEquipment(technician)); const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const guard = useUnsavedChanges(JSON.stringify([...selected].sort()) !== JSON.stringify(enabledEquipment(technician).sort()), onClose);
  const ready = equipment.ready && clients.ready; const queryError = equipment.error || clients.error;
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || !ready || queryError) return;
    setBusy(true); setError('');
    try {
      await getDataSource().repository('Tecnico', actor).update(technician.id, { equipos_habilitados: JSON.stringify(selected), expected_updated_at: technician.fecha_actualizacion });
      notify('Equipos habilitados actualizados.'); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar.'); }
    finally { setBusy(false); }
  }
  return <Modal title={`Equipos de ${technician.nombre}`} wide onClose={() => { if (!busy) guard.requestClose(); }}>{guard.prompt}<form onSubmit={save}>
    <p>El técnico podrá crear sus propias órdenes en estos equipos. También conserva el acceso correspondiente a sus solicitudes y órdenes asignadas.</p>
    <div className="ops-filters"><label>Buscar equipo o cliente<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label><span>{selected.length} habilitados</span></div>
    <div className="technician-equipment-list">{equipment.rows.filter(row => `${equipmentLabel(row)} ${clientDisplayName(clients.rows.find(client => client.id === row.cliente_id))}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))).map(row => <label key={row.id}><input type="checkbox" checked={selected.includes(row.id)} disabled={busy} onChange={event => setSelected(previous => event.target.checked ? [...previous, row.id] : previous.filter(id => id !== row.id))} /><span><strong>{equipmentLabel(row)}</strong><small>{clientDisplayName(clients.rows.find(client => client.id === row.cliente_id))}</small></span></label>)}</div>
    <ErrorNotice message={error || queryError} /><footer className="modal-actions"><button type="button" className="button" disabled={busy} onClick={guard.requestClose}>Cancelar</button><button className="button button-dark" disabled={busy || !ready || !!queryError}>{busy ? 'Guardando…' : 'Guardar equipos habilitados'}</button></footer>
  </form></Modal>;
}
export default function TechnicianEquipmentAccess() {
  const actor = useActor(); const technicians = useRows('Tecnico', true); const [editing, setEditing] = useState<EntityRecord | null>(null);
  if (actor.rol !== 'Administrador') return null;
  return <section className="panel"><div className="panel-heading"><div><h2>Equipos habilitados para técnicos</h2><p>Permite crear órdenes sin solicitud previa; cada orden queda asignada al propio técnico.</p></div></div><ErrorNotice message={technicians.error} />
    <div className="table-scroll"><table className="data-table"><caption className="visually-hidden">Autorización de equipos por técnico</caption><thead><tr><th>Técnico</th><th>Equipos habilitados</th><th>Acción</th></tr></thead><tbody>{technicians.rows.filter(row => row.activo !== false).map(row => <tr key={row.id}><td>{row.nombre}</td><td>{enabledEquipment(row).length}</td><td><button className="button button-small" onClick={() => setEditing(row)}>Configurar equipos</button></td></tr>)}</tbody></table></div>
    {!technicians.ready && <p role="status">Cargando técnicos…</p>}{editing && <EquipmentGrant key={editing.id} technician={editing} onClose={() => setEditing(null)} />}
  </section>;
}
