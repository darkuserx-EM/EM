import { operationalState, maintenanceState } from './equipment-status';
import type { Actor, EntityName, EntityRecord } from './model';
import { ValidationError } from './errors';

export function canAccessModule(actor: Actor, module: string): boolean {
  if (actor.rol === 'Administrador') return module !== 'portal';
  if (actor.rol === 'Cliente') return module === 'portal';
  if (actor.rol === 'Técnico') return ['inicio', 'ordenes', 'horas', 'viaticos', 'plan'].includes(module);
  return ['inicio', 'flota', 'clientes', 'contratos', 'tickets', 'ordenes', 'preventivos', 'calendario', 'checklists', 'reportes', 'plan', 'dashboard'].includes(module);
}
export function canWriteCatalogs(actor: Actor) { return actor.rol === 'Administrador'; }
export function filterVisible(actor: Actor, entity: EntityName, rows: EntityRecord[]) {
  if (actor.rol === 'Administrador') return rows;
  // Internal cost fields must also be absent from repository exports.
  rows = rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('costo_'))) as EntityRecord);
  if (entity === 'Usuario') return rows.filter(row => row.id === actor.id);
  if (actor.rol === 'Cliente') {
    if (entity === 'Cliente') return rows.filter(row => row.id === actor.cliente_id);
    if (entity === 'Equipo') return rows.filter(row => row.cliente_id === actor.cliente_id).map(row => {
      const { estado, estado_administrativo, estado_actualizado_por, ...visible } = row;
      return { ...visible, estado_operativo: operationalState(row), estado_mantenimiento: maintenanceState(row), fuera_de_flota: ['Vendido', 'Baja'].includes(String(estado_administrativo ?? estado)) } as EntityRecord;
    });
    if (['Ticket', 'OrdenServicio', 'CheckList'].includes(entity)) return rows.filter(row => row.cliente_id === actor.cliente_id);
    return [];
  }
  if (actor.rol === 'Técnico') {
    if (entity === 'Tecnico') return rows.filter(row => row.id === actor.tecnico_id);
    if (['OrdenServicio', 'OTHoras', 'Gasto', 'Liquidacion'].includes(entity)) return rows.filter(row => row.tecnico_id === actor.tecnico_id);
    return [];
  }
  if (['Gasto', 'Liquidacion', 'Bitacora'].includes(entity)) return [];
  return rows;
}
export function assertAdmin(actor: Actor) {
  if (actor.rol !== 'Administrador') throw new ValidationError('Esta acción está disponible solo para administración.');
}
