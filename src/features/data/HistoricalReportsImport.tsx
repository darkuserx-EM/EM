import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AlertTriangle, Download, FileUp, LoaderCircle } from 'lucide-react';
import { useActor, useRevision, useRows, useToast } from '../../app/state';
import { ErrorNotice, Modal } from '../../components/ui';
import { remoteSource, serverMode } from '../../data/source';
import { historicalMeterRegressions, historicalPendingNotice, historicalReadingNotice, historicalStatusCounts, historicalTemplatePath, parseHistoricalReports } from '../../data/historical-reports';
import type { EntityRecord } from '../../domain/model';

function byName(rows: EntityRecord[], id: string) { return rows.find(row => row.id === id); }

export function HistoricalReportsImport({ onClose }: { onClose: () => void }) {
  const actor = useActor(); const revision = useRevision(); const notify = useToast(state => state.notify);
  const clients = useRows('Cliente').rows; const sites = useRows('Sede').rows;
  const equipmentRows = useRows('Equipo'); const reportRows = useRows('OrdenServicio'); const readingRows = useRows('LecturaHorometro');
  // La vista previa compara con equipos, reportes y lecturas del portal: espera a que estén completos.
  const portalReady = equipmentRows.ready && reportRows.ready && readingRows.ready;
  const input = useRef<HTMLInputElement>(null);
  const [clienteId, setClienteId] = useState(''); const [sedeId, setSedeId] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseHistoricalReports> | null>(null);
  const [filename, setFilename] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const client = byName(clients, clienteId); const site = byName(sites, sedeId);
  const clientSites = sites.filter(row => row.cliente_id === clienteId);
  const regressions = useMemo(() => parsed ? historicalMeterRegressions(parsed.payload.reportes) : [], [parsed]);
  const statusCounts = useMemo(() => parsed ? historicalStatusCounts(parsed.payload.reportes) : [], [parsed]);

  const chooseClient = (id: string) => { setClienteId(id); setSedeId(''); setParsed(null); };
  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setError(''); setParsed(null); setFilename(file.name);
    if (file.size > 8 * 1024 * 1024) { setError('El archivo supera el límite de 8 MB.'); return; }
    try {
      const content = /.xlsx$/i.test(file.name) ? await file.arrayBuffer() : await file.text();
      const result = parseHistoricalReports(content, clienteId, sedeId, equipmentRows.rows, reportRows.rows, readingRows.rows);
      setParsed(result);
      if (result.errors.length) setError(result.errors.slice(0, 5).join(' '));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo leer el archivo.'); }
    finally { event.target.value = ''; }
  };
  const save = async () => {
    if (!parsed || parsed.errors.length || !parsed.newReportCount && !parsed.newEquipmentCount) return;
    setBusy(true); setError('');
    try {
      const result = await remoteSource.importHistoricalReports(actor, parsed.payload, revision);
      notify(`Importación lista: ${result.equipos} equipos, ${result.reportes} reportes y ${result.lecturas} lecturas. Omitidos: ${result.repetidos} reportes repetidos y ${result.lecturas_repetidas} lecturas ya registradas.`);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la importación.'); }
    finally { setBusy(false); }
  };

  return <Modal title="Importar historial de reportes" onClose={onClose} wide className="historical-import-modal">
    <p className="modal-intro">Carga equipos y reportes anteriores desde el archivo de AppSheet. Primero revisamos el contenido; solo se agregan filas nuevas.</p>
    {!serverMode && <ErrorNotice message="Esta carga requiere la versión en línea conectada a MySQL." />}
    <div className="historical-import-fields">
      <label>Cliente<select value={clienteId} onChange={event => chooseClient(event.target.value)} disabled={busy}><option value="">Selecciona el cliente</option>{clients.map(row => <option key={row.id} value={row.id}>{row.nombre_comercial || row.nombre} · {row.codigo}</option>)}</select></label>
      <label>Sede (opcional)<select value={sedeId} onChange={event => { setSedeId(event.target.value); setParsed(null); }} disabled={!clienteId || busy}><option value="">Sin sede asignada</option>{clientSites.map(row => <option key={row.id} value={row.id}>{row.nombre}</option>)}</select></label>
    </div>
    {client && <p className="field-help">Los reportes se vincularán a <strong>{client.nombre_comercial || client.nombre}</strong>{site ? <> y mostrarán la ubicación <strong>{site.nombre}</strong></> : ' y quedarán sin ubicación'}. Los equipos nuevos quedarán como “Pendiente de revisión” hasta confirmar su estado actual.</p>}
    <div className="historical-file-picker"><FileUp size={21} /><div><strong>{filename || 'Archivo de reportes (Excel, TSV o TXT)'}</strong><span>{portalReady ? 'Plantilla Excel o exportación de AppSheet · fechas día/mes/año · hasta 8 MB' : 'Cargando equipos, reportes y lecturas del portal…'}</span></div><a className="button" href={historicalTemplatePath} download><Download size={16} />Descargar plantilla</a><button className="button" onClick={() => input.current?.click()} disabled={!clienteId || !portalReady || busy}>Seleccionar archivo</button><input ref={input} type="file" accept=".xlsx,.txt,.tsv,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/tab-separated-values" onChange={selectFile} className="visually-hidden" aria-label="Archivo histórico de reportes" /></div>
    {parsed && <>
      <div className="historical-import-stats"><div><strong>{parsed.newEquipmentCount}</strong><span>equipos nuevos</span></div><div><strong>{parsed.newReportCount}</strong><span>reportes nuevos</span></div><div><strong>{parsed.newReadingCount}</strong><span>lecturas H1 nuevas</span></div><div><strong>{parsed.repeatedReports}</strong><span>ya registrados</span></div></div>
      {!!statusCounts.length && <div className="historical-status-list"><strong>Estados del archivo</strong>{statusCounts.map(([state, count]) => <span key={state}>{state}: {count}</span>)}</div>}
      {!!regressions.length && <div className="historical-warning"><AlertTriangle size={17} /><span>{regressions.length} descensos de horómetro detectados en {new Set(regressions.map(item => item.serie)).size} equipos. Se conservarán los datos originales; los tramos con retroceso quedarán sin cálculo de uso hasta revisar la lectura.</span></div>}
      <p className="field-help">{[historicalReadingNotice(parsed.repeatedReadings), historicalPendingNotice(statusCounts), 'H3 se guardará en millas. El archivo incluye nombres de fotos, pero no los archivos de imagen.'].filter(Boolean).join(' ')}</p>
      {parsed.errors.length > 0 && <div className="historical-warning"><AlertTriangle size={17} /><span>Se encontraron inconsistencias. Corrige el archivo antes de importar.</span></div>}
    </>}
    <ErrorNotice message={error} />
    <div className="modal-actions"><button className="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="button button-dark" onClick={save} disabled={!serverMode || !parsed || parsed.errors.length > 0 || busy || (!parsed.newReportCount && !parsed.newEquipmentCount)}>{busy && <LoaderCircle size={16} className="spin" />}{busy ? 'Guardando…' : 'Registrar equipos y reportes'}</button></div>
  </Modal>;
}
