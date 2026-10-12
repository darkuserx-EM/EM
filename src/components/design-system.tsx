import { useId, useRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

/*
 * Componentes compartidos del sistema de diseño (docs/SISTEMA-DE-DISENO.md · Componentes).
 * Reutilizan las clases existentes (.button, .status, .panel, .record-field) con tokens en src/design/base.css,
 * así que una pantalla puede migrar sin cambios visuales. Pantallas nuevas: usar estos componentes, no clases sueltas.
 */

export type ButtonVariant = 'secondary' | 'primary' | 'danger';
type ButtonLook = { variant?: ButtonVariant; size?: 'md' | 'sm'; icon?: ReactNode; className?: string };
export const buttonClass = ({ variant = 'secondary', size = 'md', className = '' }: ButtonLook = {}) =>
  ['button', variant === 'primary' && 'button-dark', variant === 'danger' && 'button-danger', size === 'sm' && 'button-small', className].filter(Boolean).join(' ');

/** Botón de acción. Es type="button" por defecto: un formulario solo se envía con type="submit" explícito. */
export function Button({ variant, size, icon, className, type = 'button', children, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & ButtonLook) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props}>{icon}{children}</button>;
}

/** Enlace interno con aspecto de botón (react-router). */
export function ButtonLink({ variant, size, icon, className, children, ...props }: Omit<LinkProps, 'className'> & ButtonLook) {
  return <Link className={buttonClass({ variant, size, className })} {...props}>{icon}{children}</Link>;
}

/** Botón solo con ícono: la etiqueta es obligatoria (lectores de pantalla y texto emergente). */
export function IconButton({ label, icon, className = '', type = 'button', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children' | 'className'> & { label: string; icon: ReactNode; className?: string }) {
  return <button type={type} className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>{icon}</button>;
}

export type BadgeTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';
const badgeClass: Record<BadgeTone, string> = { success: 'green', info: 'blue', warning: 'amber', danger: 'red', neutral: 'neutral' };
/** Tono de las etiquetas de estado de equipos y clientes (lo usa Status en ui.tsx). */
export const statusTone = (value: string): BadgeTone => ['Operativo', 'En renta', 'Activo'].includes(value) ? 'success' : ['Disponible', 'En mantenimiento'].includes(value) ? 'info' : ['En reparación', 'Mantenimiento pendiente', 'Prospecto', 'En tránsito'].includes(value) ? 'warning' : ['No operativo', 'En taller'].includes(value) ? 'danger' : 'neutral';
/** Etiqueta de estado con tono semántico (colores en base.css · .status). */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`status ${badgeClass[tone]}`}><i aria-hidden="true" />{children}</span>;
}

/** Panel con encabezado opcional (título, descripción y acciones). */
export function Panel({ title, description, actions, className = '', children }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; children?: ReactNode }) {
  return <section className={`panel ${className}`.trim()}>{(title || actions) && <div className="panel-heading"><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{actions}</div>}{children}</section>;
}

export type FieldControl = { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true; required?: true };
/**
 * Campo con etiqueta, ayuda y error vinculados por id. El control lo pone la pantalla:
 * <Field label="Marca" required>{control => <input {...control} value={marca} onChange={…} />}</Field>
 */
export function Field({ label, help, error, required = false, wide = false, children }: { label: ReactNode; help?: ReactNode; error?: string; required?: boolean; wide?: boolean; children: (control: FieldControl) => ReactNode }) {
  const id = useId(); const helpId = `${id}-ayuda`; const errorId = `${id}-error`;
  const describedBy = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return <div className={`record-field ${wide ? 'record-field-wide' : ''}`.trim()}>
    <label htmlFor={id}>{label}{required && <span className="required-mark" aria-hidden="true"> *</span>}</label>
    {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required: required ? true : undefined })}
    {help && <small id={helpId}>{help}</small>}
    {error && <small id={errorId} className="field-error">{error}</small>}
  </div>;
}

export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number };
/** Pestaña siguiente según la tecla (flechas, Inicio y Fin); null si la tecla no navega. */
export const nextTab = (key: string, index: number, count: number) =>
  key === 'ArrowRight' ? (index + 1) % count : key === 'ArrowLeft' ? (index - 1 + count) % count : key === 'Home' ? 0 : key === 'End' ? count - 1 : null;
/** Pestañas accesibles (role="tablist"): una sola pestaña enfocable y navegación con flechas. */
export function Tabs<T extends string>({ items, value, onChange, label, panelId, variant = 'line' }: { items: TabItem<T>[]; value: T; onChange: (value: T) => void; label: string; panelId?: string; variant?: 'line' | 'segmented' }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTab(event.key, items.findIndex(item => item.value === value), items.length);
    if (next === null) return;
    event.preventDefault(); onChange(items[next].value); refs.current[next]?.focus();
  };
  return <div className={`tabs tabs-${variant}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
    {items.map((item, index) => <button key={item.value} ref={element => { refs.current[index] = element; }} type="button" role="tab" aria-selected={item.value === value} aria-controls={panelId} tabIndex={item.value === value ? 0 : -1} onClick={() => onChange(item.value)}>{item.label}{item.count !== undefined && <span className="tabs-count">{item.count}</span>}</button>)}
  </div>;
}

/** Tarjeta de indicador. Con onClick es un botón; si además recibe pressed, actúa como filtro (aria-pressed). Sin onClick, solo informa. */
export function KpiCard({ label, value, hint, icon, pressed, onClick }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; pressed?: boolean; onClick?: () => void }) {
  const content = <>{icon && <span className="kpi-card-icon" aria-hidden="true">{icon}</span>}<span className="kpi-card-label">{label}</span><strong className="kpi-card-value">{value}</strong>{hint && <small className="kpi-card-hint">{hint}</small>}</>;
  return onClick ? <button type="button" className="kpi-card" aria-pressed={pressed} onClick={onClick}>{content}</button> : <div className="kpi-card">{content}</div>;
}

export type StepItem = { label: ReactNode; done?: boolean; disabled?: boolean };
/**
 * Pasos de un asistente (p. ej. el reporte de una orden): marca el actual con aria-current="step".
 * Con onSelect cada paso es un botón; sin onSelect solo indica el avance. Para secciones libres sin orden, usar Tabs.
 */
export function Steps({ items, current, onSelect, label, disabled = false }: { items: StepItem[]; current: number; onSelect?: (index: number) => void; label: string; disabled?: boolean }) {
  return <nav className="steps" aria-label={label}><ol>{items.map((item, index) => {
    const content = <><span className="steps-number" aria-hidden="true">{item.done && index !== current ? '✓' : index + 1}</span>{item.label}{item.done && index !== current && <span className="sr-only"> (completado)</span>}</>;
    const className = `steps-item${item.done ? ' is-done' : ''}`;
    return <li key={index}>{onSelect ? <button type="button" className={className} aria-current={index === current ? 'step' : undefined} disabled={disabled || item.disabled} onClick={() => onSelect(index)}>{content}</button> : <span className={className} aria-current={index === current ? 'step' : undefined}>{content}</span>}</li>;
  })}</ol></nav>;
}

export type DataColumn<T> = { id: string; header: ReactNode; cell: (row: T) => ReactNode; numeric?: boolean; hideHeader?: boolean; className?: string };
/**
 * Tabla de datos con desplazamiento horizontal propio (.table-scroll) y título para lectores de pantalla.
 * hideHeader deja la cabecera solo para lectores (p. ej. «Acciones»); numeric alinea a la derecha con cifras tabulares.
 */
export function DataTable<T>({ columns, rows, rowKey, caption, empty = 'No hay registros para mostrar.', className = '', rowClassName }: { columns: DataColumn<T>[]; rows: T[]; rowKey: (row: T) => string; caption: string; empty?: ReactNode; className?: string; rowClassName?: (row: T) => string | undefined }) {
  const cellClass = (column: DataColumn<T>) => [column.numeric && 'numeric mono', column.className].filter(Boolean).join(' ') || undefined;
  return <div className="table-scroll"><table className={`data-table ${className}`.trim()}>
    <caption className="sr-only">{caption}</caption>
    <thead><tr>{columns.map(column => <th key={column.id} scope="col" className={cellClass(column)}>{column.hideHeader ? <span className="sr-only">{column.header}</span> : column.header}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map(row => <tr key={rowKey(row)} className={rowClassName?.(row)}>{columns.map(column => <td key={column.id} className={cellClass(column)}>{column.cell(row)}</td>)}</tr>) : <tr><td className="data-table-empty" colSpan={columns.length}>{empty}</td></tr>}</tbody>
  </table></div>;
}

/** Paginación para DataTable: resumen a la izquierda, Anterior y Siguiente a la derecha. */
export function Pagination({ page, pageCount, onChange, summary }: { page: number; pageCount: number; onChange: (page: number) => void; summary?: ReactNode }) {
  return <div className="pagination"><span>{summary ?? `Página ${page} de ${pageCount}`}</span><Button size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</Button><Button size="sm" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>Siguiente</Button></div>;
}
