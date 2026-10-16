import type { EntityRecord, Scalar } from '../../domain/model';
import { supportFields } from '../../domain/order-team';
import {emptyOperationFilters,type OperationFilters} from '../../domain/operation-query';
export {filterOperations,emptyOperationFilters,isOperationalOrder,type OperationFilters} from '../../domain/operation-query';
import { orderStates, orderTypes, operationPriorities, ticketStates as ticketStateOptions } from '../../domain/operations';

export const serviceStates = orderStates;
export const serviceTypes = orderTypes;
export const ticketStates = ticketStateOptions;
export const priorities = operationPriorities;
export const serviceLabel = (row: EntityRecord) => row.orden_origen ? `OS ${row.orden_origen}` : row.codigo;
export const equipmentLabel = (row?: EntityRecord) => row ? `${row.codigo}${row.id_interno_cliente ? ` · ${row.id_interno_cliente}` : ''} · ${row.marca} ${row.modelo} · serie ${row.serie}` : 'Equipo no disponible';


/** Calendar inputs always use Guatemala's civil date, including UTC records. */
export function operationDay(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function operationDateLabel(value: unknown): string {
  const day = operationDay(value);
  return day ? day.split('-').reverse().join('/') : 'Sin fecha';
}
export function dateTimeInput(value: unknown): string {
  const day = operationDay(value);
  if (!day || typeof value !== 'string') return '';
  const date = new Date(value);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guatemala', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${day}T${time}`;
}
export const fromDateTimeInput = (value: string) => value ? new Date(`${value}-06:00`).toISOString() : '';

/** Campos del formulario de la orden (ServiceOrderForm): los que se documentan en campo y los de asignación. */
export const orderExecutionFields = ['estado', 'fecha', 'fecha_fin', 'sintoma', 'diagnostico', 'trabajo_realizado', 'recomendaciones', 'insumos', 'repuestos', 'pruebas_realizadas', 'resultado_pruebas', 'recibido_por', 'notas_seguridad', 'horometro', 'odometro_millas'];
export const orderAssignmentFields = [...supportFields, 'equipo_id', 'cliente_id', 'sede_id', 'ticket_id', 'tecnico_id', 'tipo', 'prioridad', 'fecha_programada', 'hora_programada'];
/** «Guardar avance» envía solo lo que cambió desde el último guardado: no reescribe lo que otra persona del equipo cambió entretanto. */
export function changedFields(fields: Record<string, Scalar>, values: Record<string, string>, saved: Record<string, string>): Record<string, Scalar> {
  return Object.fromEntries(Object.entries(fields).filter(([key]) => values[key] !== saved[key]));
}
/** Valores del formulario después de guardar: el nuevo punto de partida es la orden que devolvió el servidor, campo por campo. */
export function savedFormValues(saved: EntityRecord, values: Record<string, string>): Record<string, string> {
  return { ...values, ...Object.fromEntries([...orderAssignmentFields, ...orderExecutionFields].map(key => [key, String(saved[key] ?? '')])), fecha: dateTimeInput(saved.fecha), fecha_fin: dateTimeInput(saved.fecha_fin), visible_cliente: saved.visible_cliente === true ? 'true' : 'false' };
}

/** Blank optional meters are absent values; zero must be explicitly observed. */
export function optionalMeterFields(values: Record<string, string>, original?: EntityRecord): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const key of ['horometro', 'odometro_millas']) {
    const value = values[key]?.trim() || '';
    const label = key === 'horometro' ? 'horómetro H1' : 'odómetro H3';
    if (!value) {
      if (typeof original?.[key] === 'number') throw new Error(`Conserva el ${label} registrado. La eliminación de una lectura requiere una revisión documentada.`);
      continue;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`Revisa el ${label}: debe ser un número mayor o igual a cero.`);
    fields[key] = number;
  }
  return fields;
}

export function operationFiltersFromParams(params: URLSearchParams): OperationFilters {
  const filters = { ...emptyOperationFilters };
  for (const key of Object.keys(filters) as (keyof OperationFilters)[]) filters[key] = params.get(key) || '';
  if (!['', 'actual', 'historico'].includes(filters.origin || '')) filters.origin = '';
  return filters;
}
export function operationFilterParams(filters: Partial<OperationFilters>, initial = new URLSearchParams()) {
  const params = new URLSearchParams(initial);
  for (const key of Object.keys(emptyOperationFilters) as (keyof OperationFilters)[]) {
    if (filters[key]) params.set(key, filters[key]!); else params.delete(key);
  }
  return params;
}
export const orderListLink = (filters: Partial<OperationFilters>, orderId?: string) => {
  const params = operationFilterParams(filters);
  if (orderId) params.set('orden', orderId);
  return `/ordenes${params.size ? `?${params}` : ''}`;
};
