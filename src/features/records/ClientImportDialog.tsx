import { useRef, useState, type ChangeEvent } from 'react';
import { Check, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useActor, useToast } from '../../app/state';
import { ErrorNotice, Modal } from '../../components/ui';
import { getDataSource, serverMode } from '../../data/source';
import { readWorkbook } from '../../data/excel';
import { parseClientWorkbook } from '../../data/client-excel';
import { clientImportEntities, type ClientImportPreview } from '../../domain/client-import';

export default function ClientImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (clientId?: string) => void }) {
  const actor = useActor(); const notify = useToast(state => state.notify);
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ClientImportPreview[]>([]);
  const [revision, setRevision] = useState(0); const [filename, setFilename] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const invalid = rows.filter(row => row.errors.length).length;
  const added = rows.filter(row => row.action === 'Agregar').length;
  const read = async (event: ChangeEvent<HTMLInputElement>) => {
    const target = event.currentTarget; const file = target.files?.[0]; if (!file) return;
    setBusy(true); setError(''); setRows([]); setFilename(file.name);
    try {
      const workbook = await readWorkbook(file, true);
      const incoming = parseClientWorkbook(workbook); const source = getDataSource();
      setRevision(source.getRevision()); setRows(source.previewClientImport(actor, incoming));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); target.value = ''; }
  };
  const confirm = async () => {
    if (busy || !rows.length || invalid) return;
    setBusy(true); setError('');
    try {
      const clientId = await getDataSource().importClients(actor, rows.map(row => row.input), revision);
      const clients = rows.filter(row => row.input.entity === 'Cliente').length;
      notify(`Importación completada: ${clients} ${clients === 1 ? 'cliente' : 'clientes'} y ${rows.length - clients} contactos/sedes. ${serverMode ? 'Guardado en el servidor.' : 'Guardado en este navegador.'}`);
      onImported(clientId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const visibleRows = [...rows].sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0)).slice(0, 50);
  return <Modal title="Importar clientes desde Excel" onClose={() => { if (!busy) onClose(); }} wide>
    <p className="modal-intro">Completa la hoja <strong>Cliente</strong>: una fila por empresa. Puedes cargar 3, 4 o más clientes a la vez. Las hojas <strong>Contacto</strong> y <strong>Sede</strong> son opcionales; usa la misma <strong>referencia_cliente</strong> para vincularlas.</p>
    <div className="import-controls"><a className="button" href="/templates/Plantilla-clientes-EMSA.xlsx" download><Download size={16} />Descargar plantilla</a><button className="button button-dark" onClick={() => input.current?.click()} disabled={busy}><Upload size={16} />{busy ? 'Procesando…' : 'Seleccionar Excel'}</button><input ref={input} type="file" accept=".xlsx" className="visually-hidden" aria-label="Archivo Excel de clientes" onChange={read} disabled={busy} /></div>
    <p className="field-help">Nombre y estado son obligatorios. Para agregar, deja id vacío; para actualizar, conserva el id del Excel exportado. Las columnas ausentes conservan el dato actual; las celdas vacías de columnas presentes lo borran. Se ignoran filas vacías. Máximo 2000 filas y 8 MB.</p>
    <ErrorNotice message={error} />
    {filename && <div className="filename"><FileSpreadsheet size={17} />{filename}</div>}
    {!!rows.length && <>
      <div className="client-import-counts">{clientImportEntities.map(entity => <span key={entity}>{entity}: <strong>{rows.filter(row => row.input.entity === entity).length}</strong></span>)}</div>
      <div className="preview-summary"><span><strong>{added}</strong> altas</span><span><strong>{rows.length - added}</strong> actualizaciones</span><span className={invalid ? 'text-red' : 'text-green'}><strong>{invalid}</strong> filas con errores</span></div>
      <div className="table-scroll preview-table"><table className="data-table"><thead><tr><th>Hoja / fila</th><th>Acción</th><th>Nombre</th><th>Cliente</th><th>Validación</th></tr></thead><tbody>{visibleRows.map(row => <tr key={`${row.input.entity}-${row.input.line}`}><td>{row.input.entity} · {row.input.line}</td><td>{row.action}</td><td>{String(row.input.fields.nombre ?? '')}</td><td>{row.clientName}</td><td>{row.errors.length ? <span className="text-red">{row.errors.join(' · ')}</span> : <span className="text-green">Lista para guardar</span>}</td></tr>)}</tbody></table></div>
      {rows.length > 50 && <p className="field-help">Se muestran 50 filas, primero las que tienen errores. La validación incluye las {rows.length} filas.</p>}
      <p className="field-help">{invalid ? 'Corrige los errores en el archivo y vuelve a seleccionarlo. No se guardará ninguna fila hasta que todo el archivo sea válido.' : 'Revisa las altas y actualizaciones antes de confirmar. El archivo se guarda completo en una sola operación.'}</p>
    </>}
    <div className="modal-actions"><button className="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="button button-dark" onClick={confirm} disabled={busy || !rows.length || invalid > 0}><Check size={16} />Confirmar importación</button></div>
  </Modal>;
}
