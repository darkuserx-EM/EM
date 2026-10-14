import { useState, type FormEvent } from 'react';
import { useActor, useToast } from '../../app/state';
import { ErrorNotice, Modal, useUnsavedChanges } from '../../components/ui';
import { getDataSource } from '../../data/source';
import type { EntityRecord } from '../../domain/model';

export default function ReopenTicket({ ticket, onClose, onSaved }: { ticket: EntityRecord; onClose: () => void; onSaved: () => void }) {
  const actor = useActor(); const notify = useToast(state => state.notify);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const guard = useUnsavedChanges(!!reason.trim(), onClose);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      await getDataSource().repository('Ticket', actor).update(ticket.id, { estado: 'En revisión', reapertura_motivo: reason.trim(), expected_updated_at: ticket.fecha_actualizacion });
      notify(`${ticket.codigo} reabierta. Ya puedes crear su orden.`); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo reabrir. Revisa el estado actual.'); }
    finally { setBusy(false); }
  }
  return <Modal title={`Reabrir ${ticket.codigo}`} onClose={() => { if (!busy) guard.requestClose(); }}>{guard.prompt}<form onSubmit={save} className="os-form-grid">
    <p className="os-span">Esta solicitud se resolvió sin una orden. Volverá a En revisión y conservará su código, descripción, archivos e historial.</p>
    <label className="os-field os-span">Motivo de reapertura *<textarea required minLength={8} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} placeholder="Ej.: se cerró por error antes de registrar la orden de atención." /></label>
    <div className="os-span"><ErrorNotice message={error} /></div>
    <footer className="modal-actions os-span"><button type="button" className="button" disabled={busy} onClick={guard.requestClose}>Cancelar</button><button className="button button-dark" disabled={busy}>{busy ? 'Reabriendo…' : 'Reabrir solicitud'}</button></footer>
  </form></Modal>;
}
