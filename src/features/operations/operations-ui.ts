import type { EntityRecord } from '../../domain/model';
import { orderDay } from '../../domain/dashboard';
import { orderStates, orderTypes, operationPriorities, ticketStates as ticketStateOptions } from '../../domain/operations';

export const serviceStates = orderStates;
export const serviceTypes = orderTypes;
export const ticketStates = ticketStateOptions;
export const priorities = operationPriorities;
export const serviceLabel = (row: EntityRecord) => row.orden_origen ? `OS ${row.orden_origen}` : row.codigo;
export const equipmentLabel = (row?: EntityRecord) => row ? `${row.codigo}${row.id_interno_cliente ? ` · ${row.id_interno_cliente}` : ''} · ${row.marca} ${row.modelo} · serie ${row.serie}` : 'Equipo no disponible';
export const isOperationalOrder = (row: EntityRecord) => row.schema_operacion === 1 && row.importado !== true;

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

export interface OperationFilters { search: string; client: string; equipment: string; technician: string; state: string; from: string; to: string; origin?: string }
export const emptyOperationFilters: OperationFilters = { search: '', client: '', equipment: '', technician: '', state: '', from: '', to: '', origin: '' };
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
export function filterOperations(rows: EntityRecord[], filters: OperationFilters, equipment: EntityRecord[], clients: EntityRecord[]): EntityRecord[] {
  const query = filters.search.trim().toLocaleLowerCase('es');
  return rows.filter(row => {
    const day = orderDay(row);
    const machine = equipment.find(item => item.id === row.equipo_id);
    const client = clients.find(item => item.id === row.cliente_id);
    return (!filters.client || row.cliente_id === filters.client) && (!filters.equipment || row.equipo_id === filters.equipment)
      && (!filters.technician || (row.tecnico_id || row.responsable_id) === filters.technician)
      && (!filters.state || (filters.state === 'abiertas' ? isOperationalOrder(row) && !['Completada', 'Cancelada'].includes(String(row.estado)) : row.estado === filters.state))
      && (!filters.from || (!!day && day >= filters.from)) && (!filters.to || (!!day && day <= filters.to))
      && (!filters.origin || (filters.origin === 'actual' ? isOperationalOrder(row) : !isOperationalOrder(row)))
      && (!query || [row.codigo, row.orden_origen, row.titulo, row.sintoma, row.motivo, row.diagnostico, machine?.codigo, machine?.id_interno_cliente, machine?.marca, machine?.modelo, machine?.serie, client?.nombre, client?.nombre_comercial].join(' ').toLocaleLowerCase('es').includes(query));
  }).sort((a, b) => String(b.fecha || b.fecha_programada || b.fecha_creacion).localeCompare(String(a.fecha || a.fecha_programada || a.fecha_creacion)));
}
