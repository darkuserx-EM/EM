import { useState, type FormEvent } from 'react';
import { useActor, useRevision, useToast } from '../../app/state';
import { ErrorNotice, Modal } from '../../components/ui';
import { getDataSource } from '../../data/source';
import type { EntityRecord } from '../../domain/model';
import { reassignableEquipment, type ImportedReportRevision } from '../../domain/imported-reports';
import { equipmentLabel, serviceLabel } from './operations-ui';

/**
 * Corrección de un reporte histórico importado, solo para administración: anularlo (no corresponde a ningún equipo
 * de este cliente en el portal) o moverlo a otro equipo del mismo cliente. Pide motivo; la bitácora guarda la copia íntegra.
 */
export function ImportedReportCorrection({ order, equipment, onClose, onDone }: { order: EntityRecord; equipment: EntityRecord[]; onClose: () => void; onDone: (accion: ImportedReportRevision['accion']) => void }) {
  const actor = useActor(); const revision = useRevision(); const notify = useToast(state => state.notify);
  const options = reassignableEquipment(order, equipment);
  const [accion, setAccion] = useState<ImportedReportRevision['accion']>('anular'); const [target, setTarget] = useState(''); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await getDataSource().reviseImportedReport(actor, { orden_id: order.id, accion, ...(accion === 'reasignar' ? { equipo_id: target } : {}), motivo: reason }, revision);
      notify(result.accion === 'anular' ? `${result.orden} salió del historial del equipo.` : `${result.orden} pasó al equipo correcto con sus lecturas.`);
      onDone(result.accion);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo corregir el reporte.'); }
    finally { setBusy(false); }
  }
  return <Modal title={`Corregir ${serviceLabel(order)}`} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={submit} className="imported-correction">
      <p className="modal-intro">Reporte importado de AppSheet{order.orden_origen ? ` (orden original ${order.orden_origen})` : ''}. Úsalo cuando quedó registrado en la máquina equivocada.</p>
      <label className="os-check"><input type="radio" name="accion" checked={accion === 'anular'} onChange={() => setAccion('anular')} disabled={busy} /><span>Anular: no corresponde a ningún equipo de este cliente registrado en el portal. Sale del historial junto con sus lecturas de importación.</span></label>
      <label className="os-check"><input type="radio" name="accion" checked={accion === 'reasignar'} onChange={() => setAccion('reasignar')} disabled={busy || !options.length} /><span>{options.length ? 'Mover a otro equipo del mismo cliente, con sus lecturas.' : 'Mover a otro equipo: este cliente no tiene otros equipos en el portal.'}</span></label>
      {accion === 'reasignar' && <label className="record-field">Equipo correcto *<select required value={target} onChange={event => setTarget(event.target.value)} disabled={busy}><option value="">Selecciona el equipo</option>{options.map(row => <option key={row.id} value={row.id}>{equipmentLabel(row)}</option>)}</select></label>}
      <label className="record-field">Motivo de la corrección *<textarea required minLength={8} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
      <p className="field-help">Queda en la bitácora con una copia íntegra del reporte y de sus lecturas. Una lectura de otro origen no se borra: solo deja de estar vinculada al reporte.</p>
      <ErrorNotice message={error} />
      <div className="modal-actions"><button type="button" className="button" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className={accion === 'anular' ? 'button button-danger' : 'button button-dark'} disabled={busy}>{busy ? 'Guardando…' : accion === 'anular' ? 'Anular reporte' : 'Mover reporte'}</button></div>
    </form>
  </Modal>;
}
