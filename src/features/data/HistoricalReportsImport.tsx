import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AlertTriangle, FileUp, LoaderCircle } from 'lucide-react';
import { useActor, useRevision, useRows, useToast } from '../../app/state';
import { ErrorNotice, Modal } from '../../components/ui';
import { remoteSource, serverMode } from '../../data/source';
import { historicalMeterRegressions, historicalPendingNotice, historicalStatusCounts, parseHistoricalReports } from '../../data/historical-reports';
import type { EntityRecord } from '../../domain/model';
import { reusableHistoricalReading } from '../../domain/historical-readings';
import { normalize } from '../../domain/validation';

function byName(rows: EntityRecord[], id: string) { return rows.find(row => row.id === id); }

export function HistoricalReportsImport({ onClose }: { onClose: () => void }) {
  const actor = useActor(); const revision = useRevision(); const notify = useToast(state => state.notify);
  const clients = useRows('Cliente').rows; const sites = useRows('Sede').rows;
  const equipment = useRows('Equipo').rows; const reports = useRows('OrdenServicio').rows;
  const readings = useRows('LecturaHorometro');
  const input = useRef<HTMLInputElement>(null);
  const [clienteId, setClienteId] = useState(''); const [sedeId, setSedeId] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseHistoricalReports> | null>(null);
  const [filename, setFilename] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const client = byName(clients, clienteId); const site = byName(sites, sedeId);
  const clientSites = sites.filter(row => row.cliente_id === clienteId);
  const regressions = useMemo(() => parsed ? historicalMeterRegressions(parsed.payload.reportes) : [], [parsed]);
  const statusCounts = useMemo(() => parsed ? historicalStatusCounts(parsed.payload.reportes) : [], [parsed]);
  const reconciliation = useMemo(() => {
    let reused = 0; let added = 0; const conflicts: string[] = []; const seen = new Set<string>();
    for (const report of parsed?.payload.reportes || []) {
      if (report.horometro === null) continue;
      const machine = equipment.find(row => normalize(row.serie) === normalize(report.serie));
      const key = JSON.stringify([normalize(report.serie), Date.parse(report.fecha)]);
      if (seen.has(key)) { conflicts.push(`${report.orden_origen}: hay más de un reporte del mismo equipo en el mismo instante.`); continue; }
      seen.add(key);
      try {
        const found = machine && reusableHistoricalReading(readings.rows, { equipo_id: machine.id, cliente_id: clienteId, fecha: report.fecha, valor: report.horometro, odometro_millas: report.odometro_millas, origen_id: report.origen_id });
        if (found) reused++; else added++;
      } catch (cause) { conflicts.push((cause as Error).message); }
    }
    return { reused, added, conflicts };
  }, [parsed, equipment, readings.rows, clienteId]);

  const chooseClient = (id: string) => { setClienteId(id); setSedeId(''); setParsed(null); };
  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setError(''); setParsed(null); setFilename(file.name);
    if (file.size > 8 * 1024 * 1024) { setError('El archivo supera el límite de 8 MB.'); return; }
    try {
      const result = parseHistoricalReports(await file.text(), clienteId, sedeId, equipment, reports);
      setParsed(result);
      if (result.errors.length) setError(result.errors.slice(0, 5).join(' '));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo leer el archivo.'); }
    finally { event.target.value = ''; }
  };
  const save = async () => {
    if (!parsed || parsed.errors.length || readings.loading || readings.error || reconciliation.conflicts.length || !parsed.newReportCount && !parsed.newEquipmentCount) return;
    setBusy(true); setError('');
    try {
      const result = await remoteSource.importHistoricalReports(actor, parsed.payload, revision);
      notify(`Importación lista: ${result.equipos} equipos, ${result.reportes} reportes, ${result.lecturas} lecturas nuevas y ${result.lecturas_reutilizadas || 0} reutilizadas. ${result.repetidos} reportes repetidos omitidos.`);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la importación.'); }
    finally { setBusy(false); }
  };

  return <Modal title="Importar historial de reportes" onClose={onClose} wide className="historical-import-modal">
    <p className="modal-intro">Carga equipos y reportes anteriores desde el archivo de AppSheet. Las lecturas existentes que coincidan se vinculan al reporte sin duplicarlas ni cambiar sus valores.</p>
    {!serverMode && <ErrorNotice message="Esta carga requiere la versión en línea conectada a MySQL." />}
    <div className="historical-import-fields">
      <label>Cliente<select value={clienteId} onChange={event => chooseClient(event.target.value)} disabled={busy}><option value="">Selecciona el cliente</option>{clients.map(row => <option key={row.id} value={row.id}>{row.nombre_comercial || row.nombre} · {row.codigo}</option>)}</select></label>
      <label>Sede (opcional)<select value={sedeId} onChange={event => { setSedeId(event.target.value); setParsed(null); }} disabled={!clienteId || busy}><option value="">Sin sede asignada</option>{clientSites.map(row => <option key={row.id} value={row.id}>{row.nombre}</option>)}</select></label>
    </div>
    {client && <p className="field-help">Los reportes se vincularán a <strong>{client.nombre_comercial || client.nombre}</strong>{site ? <> y mostrarán la ubicación <strong>{site.nombre}</strong></> : ' y quedarán sin ubicación'}. Los equipos nuevos quedarán como “Pendiente de revisión” hasta confirmar su estado actual.</p>}
    <div className="historical-file-picker"><FileUp size={21} /><div><strong>{filename || 'Archivo de reportes (TSV o TXT)'}</strong><span>Fechas en formato día/mes/año · hasta 8 MB</span></div><button className="button" onClick={() => input.current?.click()} disabled={!clienteId || busy}>Seleccionar archivo</button><input ref={input} type="file" accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values" onChange={selectFile} className="visually-hidden" aria-label="Archivo histórico de reportes" /></div>
    {parsed && <>
      <p role="status">{readings.loading ? 'Revisando lecturas existentes…' : `${reconciliation.added} lecturas nuevas · ${reconciliation.reused} reutilizadas · ${reconciliation.conflicts.length} conflictos por revisar`}</p>
      <ErrorNotice message={readings.error || reconciliation.conflicts.slice(0, 5).join(' ')} />
      <div className="historical-import-stats"><div><strong>{parsed.newEquipmentCount}</strong><span>equipos nuevos</span></div><div><strong>{parsed.newReportCount}</strong><span>reportes nuevos</span></div><div><strong>{parsed.payload.reportes.filter(row => row.horometro !== null).length}</strong><span>lecturas H1</span></div><div><strong>{parsed.repeatedReports}</strong><span>ya registrados</span></div></div>
      {!!statusCounts.length && <div className="historical-status-list"><strong>Estados del archivo</strong>{statusCounts.map(([state, count]) => <span key={state}>{state}: {count}</span>)}</div>}
      {!!regressions.length && <div className="historical-warning"><AlertTriangle size={17} /><span>{regressions.length} descensos de horómetro detectados en {new Set(regressions.map(item => item.serie)).size} equipos. Se conservarán los datos originales; los tramos con retroceso quedarán sin cálculo de uso hasta revisar la lectura.</span></div>}
      <p className="field-help">{[historicalPendingNotice(statusCounts), 'H3 se guardará en millas. El archivo incluye nombres de fotos, pero no los archivos de imagen.'].filter(Boolean).join(' ')}</p>
      {parsed.errors.length > 0 && <div className="historical-warning"><AlertTriangle size={17} /><span>Se encontraron inconsistencias. Corrige el archivo antes de importar.</span></div>}
    </>}
    <ErrorNotice message={error} />
    <div className="modal-actions"><button className="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="button button-dark" onClick={save} disabled={!serverMode || !parsed || parsed.errors.length > 0 || busy || readings.loading || !!readings.error || reconciliation.conflicts.length > 0 || (!parsed.newReportCount && !parsed.newEquipmentCount)}>{busy && <LoaderCircle size={16} className="spin" />}{busy ? 'Guardando…' : 'Registrar equipos y reportes'}</button></div>
  </Modal>;
}
