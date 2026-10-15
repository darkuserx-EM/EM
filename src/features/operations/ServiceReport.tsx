import { useEffect, type ReactNode } from 'react';
import { BrandMark } from '../../components/design-system';
import { clientDisplayName } from '../../domain/client-profile';
import { formatDate, formatNumber, formatTime } from '../../domain/format';
import type { EntityRecord } from '../../domain/model';
import { orderTechnicians } from '../../domain/order-team';
import { ImportedReportDetails } from '../fleet/ImportedReportDetails';
import { signatureUrl, signedLabel, type Signature } from '../attachments/signature';
import { OperationStatus } from './OperationStatus';
import { isOperationalOrder, operationDateLabel, serviceLabel } from './operations-ui';

/** Datos de contacto de la empresa en el encabezado del reporte. */
export const company = { name: 'Expertos en Montacargas, S.A.', web: 'www.expertosenmontacargas.com', email: 'servicios@expertosenmontacargas.com', phone: '4066-1485' };

const withTime = (value: unknown): value is string => typeof value === 'string' && value.includes('T') && Number.isFinite(Date.parse(value));
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : '';
// Cada carácter se escapa como punto de código CSS: incluso un código importado con comillas
// o etiquetas permanece como texto y no puede cerrar el estilo ni inyectar reglas.
const pageCode = (value: string) => `"${Array.from(value, char => `\\${char.codePointAt(0)!.toString(16)} `).join('')}"`;
const duration = (minutes: number) => [Math.floor(minutes / 60) && `${Math.floor(minutes / 60)} h`, minutes % 60 && `${minutes % 60} min`].filter(Boolean).join(' ');

/** Horario del servicio: inicio y fin, con la duración cuando hay hora de fin. Sin hora real, la programada. */
export function serviceHours(order: EntityRecord) {
  if (!withTime(order.fecha)) return text(order.hora_programada) ? `Programado a las ${text(order.hora_programada)}` : 'Sin hora registrada';
  const start = formatTime(order.fecha);
  if (!withTime(order.fecha_fin)) return `Desde las ${start}`;
  const minutes = Math.round((Date.parse(order.fecha_fin) - Date.parse(order.fecha)) / 60000);
  const end = operationDateLabel(order.fecha_fin) === operationDateLabel(order.fecha) ? formatTime(order.fecha_fin) : `${formatDate(order.fecha_fin)} ${formatTime(order.fecha_fin)}`;
  return `${start} a ${end}${minutes > 0 ? ` · ${duration(minutes)}` : ''}`;
}

const reading = (value: unknown, unit: string) => typeof value === 'number' ? `${formatNumber(value)} ${unit}` : 'Sin lectura';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

/**
 * Reporte de servicio: lo que ve el cliente en el portal y lo que se imprime o guarda en PDF.
 * Orden de lectura: quién y cuándo, qué equipo, el resultado, el detalle del trabajo, materiales, avisos y conformidad.
 * Con firma de quien recibe, la imagen reemplaza su línea y la conformidad también se ve en pantalla.
 */
export function ServiceReport({ order, equipment, client, site, technicians, signature }: { order: EntityRecord; equipment?: EntityRecord; client?: EntityRecord; site?: EntityRecord; technicians: EntityRecord[]; signature?: Signature | null }) {
  const operational = isOperationalOrder(order); const code = serviceLabel(order);
  // Al guardar como PDF, el navegador propone el título de la página como nombre del archivo.
  useEffect(() => { const previous = document.title; document.title = `Reporte de servicio ${code} · Expertos en Montacargas`; return () => { document.title = previous; }; }, [code]);
  const assigned = orderTechnicians(order); const names = assigned.map(id => text(technicians.find(row => row.id === id)?.nombre));
  // Sin acceso a los nombres (por ejemplo, el cliente), el reporte no dice «sin técnico» si la orden sí lo tiene.
  const [lead, ...support] = names.length && names.every(Boolean) ? names : [text(order.tecnico) || (assigned.length ? `Técnico de ${company.name}` : 'Sin técnico asignado')];
  const detail = [['Síntoma o solicitud', text(order.sintoma) || text(order.motivo)], ['Diagnóstico', text(order.diagnostico)], ['Causa confirmada', text(order.causa_confirmada)], ['Trabajo realizado', text(order.trabajo_realizado) || text(order.trabajo)], ['Pruebas realizadas', text(order.pruebas_realizadas)]].filter(([, value]) => value);
  const result = text(order.resultado_pruebas), supplies = text(order.insumos) || text(order.insumos_origen), parts = text(order.repuestos) || text(order.repuestos_origen);
  const recommendations = text(order.recomendaciones), safety = order.importado ? '' : text(order.notas_seguridad);
  return <article className="os-print-report service-report">
    <style>{`@page service-report { @top-right { content: ${pageCode(code)}; } }`}</style>
    <header className="sr-header">
      <div className="sr-company"><BrandMark className="sr-logo" /><strong>{company.name}</strong></div>
      <div className="sr-title"><span className="sr-kicker">Reporte de servicio</span><h2>{code}</h2><OperationStatus value={order.estado} /></div>
    </header>
    <dl className="sr-summary">
      <Field label="Cliente">{clientDisplayName(client)}</Field>
      <Field label="Sede">{text(site?.nombre) || 'Sin sede registrada'}</Field>
      <Field label="Tipo de servicio">{text(order.tipo) || 'Servicio'}</Field>
      <Field label="Fecha">{operationDateLabel(order.fecha || order.fecha_programada)}</Field>
      <Field label="Horario">{serviceHours(order)}</Field>
      <Field label={support.length ? 'Técnicos' : 'Técnico'}>{[`${lead}${support.length ? ', responsable' : ''}`, ...support.map(name => `${name}, apoyo`)].join('\n')}</Field>
    </dl>
    <section className="sr-section" aria-labelledby="sr-equipo">
      <h3 id="sr-equipo">Equipo</h3>
      <dl className="sr-equipment">
        <Field label="Marca y modelo">{equipment ? `${text(equipment.marca)} ${text(equipment.modelo)}`.trim() || 'Sin dato' : 'Equipo no disponible'}</Field>
        <Field label="Serie">{text(equipment?.serie) || 'Sin dato'}</Field>
        <Field label="ID del cliente">{text(equipment?.id_interno_cliente) || 'Sin ID'}</Field>
        <Field label="Código EMSA">{text(equipment?.codigo) || 'Sin código'}</Field>
        <Field label="Horómetro">{reading(order.horometro, 'h')}</Field>
        <Field label="Odómetro">{reading(order.odometro_millas, 'millas')}</Field>
      </dl>
    </section>
    {result && <section className="sr-result" aria-labelledby="sr-resultado"><h3 id="sr-resultado">Resultado</h3><p>{result}</p></section>}
    {detail.length > 0 && <section className="sr-section" aria-labelledby="sr-detalle"><h3 id="sr-detalle">Detalle del trabajo</h3><dl className="sr-detail">{detail.map(([label, value]) => <Field key={label} label={label}>{value}</Field>)}</dl></section>}
    <section className="sr-section" aria-labelledby="sr-materiales">
      <h3 id="sr-materiales">Materiales</h3>
      <dl className="sr-materials"><Field label="Insumos">{supplies || <span className="sr-empty">Ninguno registrado</span>}</Field><Field label="Repuestos">{parts || <span className="sr-empty">Ninguno registrado</span>}</Field></dl>
    </section>
    {recommendations && <section className="sr-note" aria-labelledby="sr-recomendaciones"><h3 id="sr-recomendaciones">Recomendaciones</h3><p>{recommendations}</p></section>}
    {safety && <section className="sr-note sr-warning" aria-labelledby="sr-seguridad"><h3 id="sr-seguridad">Seguridad y restricciones</h3><p>{safety}</p></section>}
    <ImportedReportDetails report={order} />
    {operational && <section className={signature ? 'sr-sign sr-signed' : 'sr-sign'} aria-labelledby="sr-conformidad">
      <h3 id="sr-conformidad" className="sr-sign-title">Conformidad del servicio</h3>
      <div className="sr-sign-tech"><span className="sr-line" /><strong>{lead}</strong><small>Técnico responsable · firma</small></div>
      {signature ? <div><img className="sr-signature" src={signatureUrl(signature)} alt={`Firma de ${signature.signer}`} /><strong>{signature.signer}</strong><small>Recibido por · {signedLabel(signature).toLocaleLowerCase('es')}</small>{signature.capturedBy && <small className="sr-sign-capture">Capturada en el portal por {signature.capturedBy}</small>}</div>
        : <div><span className="sr-line" /><strong>{text(order.recibido_por) || 'Nombre de quien recibe'}</strong><small>Recibido por · firma</small></div>}
    </section>}
    <footer className="sr-footer">
      {operational && <p>El cierre del servicio no reemplaza la revisión del estado operativo ni de los hallazgos de seguridad del equipo.</p>}
      <p>{code} · Generado el {formatDate(new Date().toISOString())} desde el Portal EM.</p>
    </footer>
  </article>;
}
