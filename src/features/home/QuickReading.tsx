import { assignedTo } from '../../domain/order-team';
import { useRef, useState, type FormEvent } from 'react';
import { useActor, useToast } from '../../app/state';
import { ErrorNotice, Modal } from '../../components/ui';
import { getDataSource } from '../../data/source';
import type { EntityRecord } from '../../domain/model';
import { latestReading } from '../../domain/home-overview';
import { operationalOrders } from '../../domain/planning';
import { dateTimeInput, fromDateTimeInput, equipmentLabel } from '../operations/operations-ui';

export default function QuickReading({ equipment, orders, readings, onClose }: { equipment: EntityRecord[]; orders: EntityRecord[]; readings: EntityRecord[]; onClose: () => void }) {
  const actor = useActor(), notify = useToast(state => state.notify), technician = actor.rol === 'Técnico';
  const open = operationalOrders(orders).filter(row => !['Completada', 'Cancelada'].includes(String(row.estado)) && (!technician || assignedTo(row, actor.tecnico_id)));
  const allowed = equipment.filter(row => !technician || open.some(order => order.equipo_id === row.id));
  const [equipmentId, setEquipment] = useState(''), [orderId, setOrder] = useState(''), [value, setValue] = useState('');
  const [when, setWhen] = useState(() => dateTimeInput(new Date().toISOString()));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const attempt = useRef({ fingerprint: '', id: crypto.randomUUID() });
  const previous = latestReading(readings, equipmentId);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError('');
    if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) { setError('Indica la lectura observada; un campo vacío no equivale a cero.'); return; }
    setBusy(true);
    try {
      const fields = { equipo_id: equipmentId, orden_id: orderId, valor: Number(value), fecha: fromDateTimeInput(when) };
      const fingerprint = JSON.stringify(fields);
      if (attempt.current.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID() };
      await getDataSource().repository('LecturaHorometro', actor).create({ ...fields, solicitud_id: attempt.current.id });
      notify('Lectura guardada en el historial del equipo.'); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar. Conservamos los datos para reintentar.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Registrar horómetro" onClose={() => { if (!busy) onClose(); }} className="home-reading-modal">
    <p className="field-help">Registra el valor que muestra el equipo. Las lecturas anteriores se conservan.</p>
    <form onSubmit={save}><fieldset disabled={busy}>
      <label>Equipo<select required value={equipmentId} onChange={event => { setEquipment(event.target.value); setOrder(''); }}><option value="">Selecciona el equipo</option>{allowed.map(row => <option key={row.id} value={row.id}>{equipmentLabel(row)}</option>)}</select></label>
      {!allowed.length && <p className="field-help">{technician ? 'Necesitas una orden abierta asignada para registrar una lectura.' : 'Primero registra un equipo en la flota.'}</p>}
      {equipmentId && <div className="home-reading-previous">{previous ? <>Última lectura: <strong>{Number(previous.valor).toLocaleString('es-GT')} h</strong> · {dateTimeInput(previous.fecha).replace('T', ' ')}{previous.es_estimado === true && ' · estimada'}</> : 'Sin lectura anterior registrada.'}</div>}
      <label>Orden de servicio{technician ? ' *' : ' (opcional)'}<select required={technician} value={orderId} onChange={event => setOrder(event.target.value)}><option value="">{technician ? 'Selecciona tu orden' : 'Registro independiente'}</option>{open.filter(row => row.equipo_id === equipmentId).map(row => <option key={row.id} value={row.id}>{row.codigo} · {row.tipo}</option>)}</select></label>
      <div className="home-reading-fields"><label>Fecha y hora · Guatemala<input required type="datetime-local" value={when} onChange={event => setWhen(event.target.value)}/></label><label>Horómetro H1 · horas<input autoComplete="off" required type="number" min="0" step="0.01" value={value} onChange={event => setValue(event.target.value)}/></label></div>
      <p className="field-help">Una lectura menor o anterior a la última requiere revisión. No corrige ni reinicia el contador.</p>
      <ErrorNotice message={error}/><div className="modal-actions"><button className="button" type="button" onClick={onClose}>Cancelar</button><button className="button button-dark" type="submit" disabled={!allowed.length}>{busy ? 'Guardando…' : 'Guardar lectura'}</button></div>
    </fieldset></form>
  </Modal>;
}
