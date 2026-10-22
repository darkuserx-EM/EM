import { useState, type FormEvent } from 'react';
import { useActor, useToast } from '../../app/state';
import { ErrorNotice, Modal, useUnsavedChanges } from '../../components/ui';
import { getDataSource } from '../../data/source';
import type { EntityRecord } from '../../domain/model';

export default function CancelTicket({ ticket, linkedOrder, onClose, onSaved }: { ticket: EntityRecord; linkedOrder?: EntityRecord; onClose: () => void; onSaved: () => void }) {
  const actor = useActor(); const notify = useToast(state => state.notify);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const blocked = !!linkedOrder && linkedOrder.estado !== 'Cancelada';
  const guard = useUnsavedChanges(!!reason.trim(), onClose);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || blocked) return;
    setBusy(true); setError('');
    try {
      await getDataSource().repository('Ticket', actor).update(ticket.id, { estado: 'Cancelado', cancelacion_motivo: reason.trim(), expected_updated_at: ticket.fecha_actualizacion });
      notify(`${ticket.codigo} cancelada. Se conserva el historial y las evidencias.`); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cancelar. Revisa el estado actual.'); }
    finally { setBusy(false); }
  }
  return <Modal title={`Cancelar ${ticket.codigo}`} onClose={() => { if (!busy) guard.requestClose(); }}>{guard.prompt}<form onSubmit={save} className="os-form-grid">
    <p className="os-span">La solicitud quedará Cancelada. Se conservarán su descripción, archivos e historial. Si tiene órdenes abiertas, cancélalas primero desde Órdenes de servicio. Una orden completada impide esta cancelación.</p>
    {linkedOrder && <p className="os-span">Orden vinculada: {linkedOrder.codigo} · {String(linkedOrder.estado)}. {blocked ? 'Vuelve al detalle y abre «Ver orden» para revisarla antes de cancelar la solicitud.' : 'La orden ya está cancelada; se conservarán ambas con su historial.'}</p>}
    <label className="os-field os-span">Motivo de cancelación *<textarea required minLength={8} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} placeholder="Ej.: el cliente canceló la visita y no se realizará el trabajo." /></label>
    <div className="os-span"><ErrorNotice message={error} /></div>
    <footer className="modal-actions os-span"><button type="button" className="button" disabled={busy} onClick={guard.requestClose}>Volver</button><button className="button button-danger" disabled={busy || blocked}>{busy ? 'Cancelando…' : 'Cancelar solicitud'}</button></footer>
  </form></Modal>;
}
