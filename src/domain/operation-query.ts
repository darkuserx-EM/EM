import type {EntityRecord} from './model';
import {orderDay} from './dashboard';
export const isOperationalOrder = (row: EntityRecord) => row.schema_operacion === 1 && row.importado !== true;
export interface OperationFilters { search: string; client: string; equipment: string; technician: string; state: string; from: string; to: string; origin?: string }
export const emptyOperationFilters: OperationFilters = { search: '', client: '', equipment: '', technician: '', state: '', from: '', to: '', origin: '' };
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
  }).sort((a, b) => String(b.fecha || b.fecha_programada || b.fecha_creacion).localeCompare(String(a.fecha || a.fecha_programada || a.fecha_creacion)) || (a.id>b.id?-1:a.id<b.id?1:0));
}
