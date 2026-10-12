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
