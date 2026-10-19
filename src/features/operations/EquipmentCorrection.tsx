import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { useActor, useRevision, useToast } from '../../app/state';
import { ErrorNotice, Modal, useUnsavedChanges } from '../../components/ui';
import { getDataSource } from '../../data/source';
import { clientDisplayName } from '../../domain/client-profile';
import { closedOperation, type EquipmentCorrectionSummary } from '../../domain/equipment-correction';
import { formatDate, formatNumber } from '../../domain/format';
import type { Actor, EntityRecord } from '../../domain/model';
import { equipmentLabel } from './operations-ui';

/** Coordinación o administración; con una orden completada o la solicitud resuelta, solo administración. El servidor vuelve a comprobarlo. */
export function canCorrectEquipment(actor: Actor, ticket: EntityRecord | undefined, orders: EntityRecord[]) {
  const rows = [...(ticket ? [ticket] : []), ...orders];
  return ['Administrador', 'Coordinador'].includes(actor.rol) && rows.length > 0 && rows.every(row => row.schema_operacion === 1 && row.importado !== true) &&
    ticket?.estado !== 'Cancelado' && !orders.some(row => row.estado === 'Cancelada') && (actor.rol === 'Administrador' || !closedOperation(ticket, orders));
}

const join = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : items[0] || '';
const count = (value: number, one: string, many: string) => value ? [`${value} ${value === 1 ? one : many}`] : [];
/** «La orden OS-103 y 2 lecturas pasarán a…»: lo que se moverá, en una frase. */
function movedSentence(summary: EquipmentCorrectionSummary) {
  const items = [...(summary.solicitud ? [`la solicitud ${summary.solicitud}`] : []), ...(summary.ordenes.length ? [`${summary.ordenes.length === 1 ? 'la orden' : 'las órdenes'} ${join(summary.ordenes)}`] : []),
    ...count(summary.lecturas.length, 'lectura', 'lecturas'), ...count(summary.repuestos, 'repuesto', 'repuestos'), ...count(summary.horas, 'registro de horas', 'registros de horas'), ...count(summary.hallazgos, 'hallazgo', 'hallazgos')];
  const text = join(items);
  return { text: text.charAt(0).toUpperCase() + text.slice(1), plural: items.length > 1 || summary.ordenes.length > 1 };
}

/** Fila del detalle de la orden sin solicitud: equipo registrado y acceso a la corrección. */
export function EquipmentCorrectionBar({ equipment, disabled, onOpen }: { equipment?: EntityRecord; disabled: boolean; onOpen: () => void }) {
  return <div className="os-sharing"><span>Equipo registrado: {equipmentLabel(equipment)}</span><button className="button button-small" disabled={disabled} onClick={onOpen}><ArrowLeftRight size={15} />Corregir equipo</button></div>;
}

/** «Corregir equipo» de una solicitud (con sus órdenes) o de una orden sin solicitud creada con la máquina equivocada. */
export function EquipmentCorrection({ ticket, order, equipment, clients, onClose, onDone }: { ticket?: EntityRecord; order?: EntityRecord; equipment: EntityRecord[]; clients: EntityRecord[]; onClose: () => void; onDone: () => void }) {
  const actor = useActor(); const revision = useRevision(); const notify = useToast(state => state.notify);
  const operation = (ticket || order)!;
  const current = equipment.find(row => row.id === operation.equipo_id);
  const options = equipment.filter(row => row.id !== operation.equipo_id && !!operation.cliente_id && row.cliente_id === operation.cliente_id);
  const [target, setTarget] = useState(''); const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ key: string; summary?: EquipmentCorrectionSummary; error?: string }>({ key: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const guard = useUnsavedChanges(!!target || !!reason.trim(), onClose);
  const request = ticket ? { ticket_id: ticket.id } : { orden_id: operation.id };
  const key = JSON.stringify([target, revision]);
  // La vista previa la calcula el servidor con todos los datos: qué se mueve y si alguna regla lo impide. No guarda nada.
  // Mientras se guarda no se repite: al terminar cambia la revisión y la ventana se cierra.
  useEffect(() => {
    if (!target || busy) return;
    let active = true;
    // En modo local la respuesta es inmediata (y un error, una excepción); en modo servidor es una promesa.
    Promise.resolve().then(() => getDataSource().changeOperationEquipment(actor, { ...(ticket ? { ticket_id: ticket.id } : { orden_id: operation.id }), equipo_id: target, vista_previa: true }, revision))
      .then(summary => { if (active) setPreview({ key, summary }); }, (cause: unknown) => { if (active) setPreview({ key, error: cause instanceof Error ? cause.message : 'No se pudo revisar la corrección.' }); });
    return () => { active = false; };
  }, [actor, busy, key, operation.id, revision, target, ticket]);
  const summary = target && preview.key === key ? preview.summary : undefined;
  const previewError = target && preview.key === key ? preview.error || '' : '';
  const destination = equipment.find(row => row.id === target); const sentence = summary && movedSentence(summary);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || !summary) return;
    setBusy(true); setError('');
    try {
      const result = await getDataSource().changeOperationEquipment(actor, { ...request, equipo_id: target, motivo: reason.trim() }, revision);
      notify(`${[result.solicitud, ...result.ordenes].filter(Boolean).join(', ')} ${result.solicitud || result.ordenes.length > 1 ? 'pasaron' : 'pasó'} a ${destination?.id_interno_cliente || destination?.codigo || 'el equipo correcto'}.`);
      onDone();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo corregir el equipo. Revisa los datos actuales.'); }
    finally { setBusy(false); }
  }
  return <Modal title={`Corregir equipo · ${operation.codigo}`} onClose={() => { if (!busy) guard.requestClose(); }}>{guard.prompt}<form onSubmit={save} className="os-form-grid">
    <p className="os-intro os-span">Úsalo cuando {ticket ? 'la solicitud se registró' : 'la orden se registró'} con el equipo equivocado. {ticket ? 'La solicitud y sus órdenes pasan' : 'La orden pasa'} al equipo correcto del mismo cliente junto con sus lecturas, repuestos, horas y hallazgos. Adjuntos, fotos y firma se conservan.</p>
    <div className="os-equipment-context os-span"><small>Equipo registrado</small><strong>{equipmentLabel(current)}</strong><small>{clientDisplayName(clients.find(row => row.id === operation.cliente_id))}</small></div>
    <label className="os-field os-span">Equipo correcto *<select required value={target} onChange={event => { setTarget(event.target.value); setError(''); }} disabled={busy || !options.length}><option value="">{options.length ? 'Selecciona el equipo' : 'Este cliente no tiene otros equipos en el portal'}</option>{options.map(row => <option key={row.id} value={row.id}>{equipmentLabel(row)}</option>)}</select></label>
    {target && !summary && !previewError && <p className="os-help os-span" role="status">Revisando qué se moverá…</p>}
    {summary && <section className="equipment-fix-summary os-span" aria-live="polite">
      <p><strong>{sentence!.text}</strong> {sentence!.plural ? 'pasarán' : 'pasará'} a <strong>{equipmentLabel(destination)}</strong>.</p>
      {!!summary.lecturas.length && <ul>{summary.lecturas.map(row => <li key={row.codigo}>{row.codigo}: {row.valor === null ? 'sin horómetro' : `${formatNumber(row.valor)} h`} del {row.fecha ? formatDate(row.fecha) : 'día sin registrar'}</li>)}</ul>}
      <p className="os-help">{summary.ultima_lectura_destino ? `Última lectura del equipo correcto: ${formatNumber(summary.ultima_lectura_destino.valor)} h del ${formatDate(summary.ultima_lectura_destino.fecha)}.` : 'El equipo correcto aún no tiene lecturas.'}{summary.solo_administracion ? ' Incluye una orden completada o una solicitud resuelta: solo administración puede corregirla.' : ''}</p>
      {summary.avisos.map(item => <p key={item} className="equipment-fix-warning">{item}</p>)}
    </section>}
    <div className="os-span"><ErrorNotice message={previewError} /></div>
    <label className="os-field os-span">Motivo de la corrección *<textarea required minLength={8} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} placeholder="Ej.: la falla era del RD05 y se registró por error con el RD11." /><small>Queda en la bitácora con una copia íntegra de lo que se movió, el equipo anterior y quién hizo la corrección.</small></label>
    <div className="os-span"><ErrorNotice message={error} /></div>
    <footer className="modal-actions os-span"><button type="button" className="button" disabled={busy} onClick={guard.requestClose}>Cancelar</button><button className="button button-dark" disabled={busy || !summary || reason.trim().length < 8}>{busy ? 'Guardando…' : 'Corregir equipo'}</button></footer>
  </form></Modal>;
}
