import { useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { useActor, useRevision, useRows, useToast } from '../../app/state';
import { Field } from '../../components/design-system';
import { ErrorNotice, Modal } from '../../components/ui';
import { remoteSource, serverMode } from '../../data/source';
import { formatDate, formatNumber, formatTime } from '../../domain/format';
import { planHistoricalReadingCleanup } from '../../domain/historical-readings';
import type { EntityRecord } from '../../domain/model';

const readingLabel = (row: EntityRecord) => `${formatNumber(Number(row.valor))} h${typeof row.odometro_millas === 'number' ? ` · ${formatNumber(row.odometro_millas)} mi` : ''}`;

export function HistoricalReadingsCleanup({ onClose }: { onClose: () => void }) {
  const actor = useActor(); const revision = useRevision(); const notify = useToast(state => state.notify);
  const clients = useRows('Cliente').rows; const equipmentRows = useRows('Equipo'); const orderRows = useRows('OrdenServicio'); const readingRows = useRows('LecturaHorometro');
  const ready = equipmentRows.ready && orderRows.ready && readingRows.ready;
  const [clienteId, setClienteId] = useState(''); const [excludedText, setExcludedText] = useState('');
  const [checked, setChecked] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const excluded = useMemo(() => excludedText.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean), [excludedText]);
  const importedOrders = useMemo(() => orderRows.rows.filter(row => row.importado === true && row.cliente_id === clienteId), [orderRows.rows, clienteId]);
  const unknown = excluded.filter(value => !importedOrders.some(row => [row.origen_id, row.orden_origen].some(id => String(id ?? '').toLocaleLowerCase() === value.toLocaleLowerCase())));
  const plan = useMemo(() => clienteId && ready ? planHistoricalReadingCleanup({ OrdenServicio: orderRows.rows, LecturaHorometro: readingRows.rows }, clienteId, excluded) : [], [clienteId, ready, orderRows.rows, readingRows.rows, excluded]);
  const equipment = useMemo(() => new Map(equipmentRows.rows.map(row => [row.id, row])), [equipmentRows.rows]);
  const count = (reason: string) => plan.filter(item => item.reason === reason).length;
  const chooseClient = (id: string) => { setClienteId(id); setExcludedText(''); setChecked(false); setError(''); };
  const save = async () => {
    if (!plan.length || !checked || unknown.length) return;
    setBusy(true); setError('');
    try {
      const result = await remoteSource.cleanHistoricalReadings(actor, { cliente_id: clienteId, excluir: excluded, lecturas: plan.map(item => item.reading.id) }, revision);
      notify(`Depuración lista: ${result.eliminadas} lecturas eliminadas. El detalle quedó en la bitácora.`);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la depuración.'); }
    finally { setBusy(false); }
  };

  return <Modal title="Depurar lecturas del historial" onClose={onClose} wide className="historical-import-modal">
    <p className="modal-intro">Busca lecturas de horómetro creadas por la importación de historial que repiten una lectura conservada del mismo equipo (mismo valor y día, o igual a la lectura de ingreso), que repiten otra importada del mismo día o que son de un reporte que quieras excluir. Primero se muestran; solo se eliminan al confirmar. Los reportes no se modifican.</p>
    {!serverMode && <ErrorNotice message="Esta depuración requiere la versión en línea conectada a MySQL." />}
    <div className="record-fields">
      <Field label="Cliente">{control => <select {...control} value={clienteId} onChange={event => chooseClient(event.target.value)} disabled={busy || !ready}><option value="">{ready ? 'Selecciona el cliente' : 'Cargando reportes y lecturas…'}</option>{clients.map(row => <option key={row.id} value={row.id}>{row.nombre_comercial || row.nombre} · {row.codigo}</option>)}</select>}</Field>
      <Field label="Reportes excluidos (opcional)" help="ID de origen u orden original de reportes importados cuya lectura no corresponde al equipo. Separa varios con coma." error={unknown.length ? `No hay reportes importados de este cliente con: ${unknown.join(', ')}` : undefined}>{control => <input {...control} value={excludedText} onChange={event => { setExcludedText(event.target.value); setChecked(false); }} disabled={!clienteId || busy} />}</Field>
    </div>
    {clienteId && ready && <>
      <div className="historical-import-stats"><div><strong>{plan.length}</strong><span>lecturas a eliminar</span></div><div><strong>{count('Repite una lectura conservada')}</strong><span>repiten una conservada</span></div><div><strong>{count('Repite otra lectura importada')}</strong><span>repiten otra importada</span></div><div><strong>{count('Reporte excluido')}</strong><span>de reportes excluidos</span></div></div>
      {!importedOrders.length ? <p className="field-help">Este cliente no tiene reportes importados.</p> : !plan.length ? <p className="field-help">No hay lecturas importadas que sobren para este cliente.</p> : <>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Equipo</th><th>Lectura importada</th><th>Orden original</th><th>Motivo</th><th>Se conserva</th></tr></thead><tbody>{plan.map(({ reading, order, reason, kept }) => {
          const machine = equipment.get(String(reading.equipo_id));
          return <tr key={reading.id}><td>{machine ? `${machine.id_interno_cliente || machine.codigo} · ${machine.marca} ${machine.modelo}` : 'Equipo no encontrado'}<small className="block muted">{machine ? `Serie ${machine.serie}` : ''}</small></td><td className="nowrap">{readingLabel(reading)}<small className="block muted">{formatDate(String(reading.fecha))} {formatTime(String(reading.fecha))} · {String(reading.codigo)}</small></td><td>{String(order.orden_origen)}<small className="block muted">ID {String(order.origen_id)}</small></td><td>{reason}</td><td>{kept ? <>{readingLabel(kept)}{kept.es_estimado === true ? ' · estimada' : ''}<small className="block muted">{formatDate(String(kept.fecha))} · {String(kept.origen || 'Sin origen')}</small></> : '—'}</td></tr>;
        })}</tbody></table></div>
        <div className="historical-warning"><AlertTriangle size={17} /><span>Eliminar lecturas no se puede deshacer desde el portal. Descarga antes un respaldo completo. La bitácora registrará cuántas lecturas se eliminaron y sus códigos.</span></div>
        <label className="check-field restore-check"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} disabled={busy} />Revisé la lista y descargué un respaldo completo. Elimina estas {plan.length} lecturas.</label>
      </>}
    </>}
    <ErrorNotice message={error} />
    <div className="modal-actions"><button className="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="button button-dark" onClick={save} disabled={!serverMode || !plan.length || !checked || unknown.length > 0 || busy}>{busy && <LoaderCircle size={16} className="spin" />}{busy ? 'Eliminando…' : 'Eliminar lecturas'}</button></div>
  </Modal>;
}
