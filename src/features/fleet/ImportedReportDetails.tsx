import type { EntityRecord } from '../../domain/model';
import { formatDate, formatNumber, formatTime } from '../../domain/format';
import './imported-history.css';

export function EstimateNote({ original, note, unit }: { original: EntityRecord[string]; note: EntityRecord[string]; unit: string }) {
  return <span className="reading-estimate"><span className="estimate-tag">Estimado</span><small>Original: {typeof original === 'number' ? formatNumber(original) : 'Sin dato'} {unit}</small>{note && <details><summary>Ver estimación</summary><p>{note}</p></details>}</span>;
}

export function ImportedReportDetails({ report }: { report: EntityRecord }) {
  if (!report.importado) return null;
  const attachments = String(report.adjuntos_referencias || '').split('\n').filter(Boolean);
  return <div className="imported-report-details">
    <dl className="imported-report-meta">
      <div><dt>Orden de servicio original</dt><dd>{report.orden_origen || 'Sin número'}</dd></div>
      <div><dt>Prioridad registrada</dt><dd>{report.prioridad || 'Sin dato'}</dd></div>
      <div><dt>Inicio registrado</dt><dd>{formatDate(String(report.fecha))} · {formatTime(String(report.fecha))}</dd></div>
      {report.fecha_fin && <div><dt>Final registrado</dt><dd>{formatDate(String(report.fecha_fin))} · {formatTime(String(report.fecha_fin))}</dd></div>}
      <div><dt>Nombre del cliente en el reporte</dt><dd>{report.recibido_por || 'Sin nombre registrado'}</dd></div>
      <div><dt>Odómetro H3 · millas</dt><dd>{typeof report.odometro_millas === 'number' ? formatNumber(report.odometro_millas) : 'Sin lectura'}{report.odometro_estimado === true && <EstimateNote original={report.odometro_original} note={report.odometro_nota_estimacion} unit="millas" />}</dd></div>
    </dl>
    {report.horometro_estimado === true && <div className="imported-report-meter"><h3>Horómetro H1 · {formatNumber(Number(report.horometro))} h</h3><EstimateNote original={report.horometro_original} note={report.horometro_nota_estimacion} unit="h" /></div>}
    {report.notas_seguridad && <section className="report-safety-notes"><h3>Notas de seguridad y recomendaciones</h3><p>{report.notas_seguridad}</p><small>Observaciones de esta visita. Su resolución debe revisarse en los servicios posteriores.</small></section>}
    <p className="imported-report-caveat">El estado y las horas de inicio y final se conservan del reporte original. Estas horas no equivalen a mano de obra validada.{report.estado === 'Pendiente' ? ' Este reporte figura como pendiente en el origen; no confirma un pendiente actual del equipo.' : ''}</p>
    {attachments.length > 0 && <details className="report-pending-files"><summary>{attachments.length} referencia{attachments.length === 1 ? '' : 's'} a fotos o firma · archivos pendientes</summary><p>El listado incluye los nombres de los archivos, pero no sus imágenes.</p><ul>{attachments.map((file, index) => <li key={index}>{file}</li>)}</ul></details>}
    <p className="report-source">Historial importado · ID de origen: {report.origen_id}</p>
  </div>;
}
