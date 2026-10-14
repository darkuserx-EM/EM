import { operationalState, maintenanceState } from './equipment-status';
import type { Actor, Database, EntityName, EntityRecord } from './model';
import { ValidationError } from './errors';
import { retiredEquipment } from './equipment-status';
import { assignedTo, orderTechnicians } from './order-team';

export function canAccessModule(actor: Actor, module: string): boolean {
  if (actor.rol === 'Administrador') return module !== 'portal';
  if (actor.rol === 'Cliente') return ['portal', 'tickets', 'ordenes', 'calendario', 'reportes'].includes(module);
  if (actor.rol === 'Técnico') return ['inicio', 'tickets', 'ordenes', 'calendario', 'planificador'].includes(module);
  return ['inicio', 'flota', 'clientes', 'contratos', 'tickets', 'ordenes', 'preventivos', 'calendario', 'planificador', 'checklists', 'reportes', 'plan', 'dashboard'].includes(module);
}
export function canWriteCatalogs(actor: Actor) { return actor.rol === 'Administrador'; }
const publicFields: Partial<Record<EntityName, string[]>> = {
  Cliente: ['nombre', 'nombre_comercial', 'logo', 'estado', 'ubicacion', 'plus_code'],
  Contacto: ['cliente_id', 'nombre', 'cargo', 'telefono', 'correo', 'principal'],
  Sede: ['cliente_id', 'nombre', 'direccion', 'municipio', 'departamento', 'referencia_ubicacion', 'autoriza_contacto_id'],
  Equipo: ['marca', 'modelo', 'serie', 'id_interno_cliente', 'tipo', 'propiedad', 'cliente_id', 'sede_id', 'horometro', 'anio', 'capacidad_lb', 'altura_elevacion_in', 'altura_torre_in', 'largo_cuchillas_in', 'voltaje', 'combustible', 'bateria', 'cargador', 'llantas_delanteras', 'llantas_traseras', 'caster', 'foto_equipo', 'placa_datos', 'foto_frontal', 'foto_trasera', 'foto_lateral_1', 'foto_lateral_2', 'estado_operativo', 'estado_mantenimiento', 'fuera_de_flota'],
  OrdenServicio: ['schema_operacion', 'equipo_id', 'cliente_id', 'sede_id', 'ticket_id', 'tecnico_id', 'tecnico_apoyo_1_id', 'tecnico_apoyo_2_id', 'tecnico', 'tipo', 'prioridad', 'estado', 'fecha_programada', 'hora_programada', 'fecha', 'fecha_fin', 'sintoma', 'motivo', 'diagnostico', 'causa_confirmada', 'trabajo_realizado', 'trabajo', 'recomendaciones', 'pruebas_realizadas', 'resultado_pruebas', 'recibido_por', 'notas_seguridad', 'insumos', 'repuestos', 'horometro', 'odometro_millas', 'visible_cliente', 'ubicacion'],
  Ticket: ['schema_operacion', 'equipo_id', 'cliente_id', 'sede_id', 'titulo', 'descripcion', 'prioridad', 'estado', 'fecha_programada', 'responsable_id', 'orden_id', 'tiene_orden'],
  LecturaHorometro: ['equipo_id', 'cliente_id', 'orden_id', 'fecha', 'valor', 'odometro_millas', 'origen', 'es_estimado'],
  Tecnico: ['nombre', 'especialidad', 'activo'],
};
function project(entity: EntityName, row: EntityRecord) {
  const allowed = publicFields[entity];
  if (!allowed) return row;
  const keys = ['id', 'codigo', 'fecha_creacion', 'fecha_actualizacion', ...allowed];
  return Object.fromEntries(Object.entries(row).filter(([key]) => keys.includes(key))) as EntityRecord;
}
/** Projection after the server has authorized an operational row's SQL scope. */
export function projectOperation(actor:Actor,entity:EntityName,row:EntityRecord) {
  if(actor.rol==='Administrador')return row;
  const redacted=Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('costo_'))) as EntityRecord;
  return actor.rol==='Coordinador'?redacted:project(entity,redacted);
}
export function filterVisible(actor: Actor, entity: EntityName, rows: EntityRecord[], entities?: Pick<Database['entities'], 'Equipo' | 'OrdenServicio'> & Partial<Pick<Database['entities'], 'Ticket' | 'Tecnico'>>) {
  // Read-only metadata: suppress a duplicate appointment even when the linked
  // order is private or assigned to another technician. Never expose that order.
  if (entity === 'Ticket') {
    const linked = new Set(entities?.OrdenServicio.map(order => order.ticket_id).filter(Boolean));
    rows = rows.map(row => ({ ...row, tiene_orden: !!row.orden_id || linked.has(row.id) }));
  }
  if (actor.rol === 'Administrador') return rows;
  // Findings remain internal to administration until client visibility is designed.
  if (['Hallazgo', 'PlanPM'].includes(entity)) return [];
  // Internal cost fields must also be absent from repository exports.
  rows = rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('costo_'))) as EntityRecord);
  if (entity === 'Usuario') return rows.filter(row => row.id === actor.id);
  if (actor.rol === 'Cliente') {
    if (!actor.cliente_id) return [];
    if (entity === 'Cliente') return rows.filter(row => row.id === actor.cliente_id).map(row => project(entity, row));
    if (entity === 'Equipo') return rows.filter(row => row.cliente_id === actor.cliente_id).map(row => {
      const { estado, estado_administrativo, estado_actualizado_por, ...visible } = row;
      return project(entity, { ...visible, estado_operativo: operationalState(row), estado_mantenimiento: maintenanceState(row), fuera_de_flota: ['Vendido', 'Baja'].includes(String(estado_administrativo ?? estado)) } as EntityRecord);
    });
    if (['Ticket', 'Contacto', 'Sede'].includes(entity)) return rows.filter(row => row.cliente_id === actor.cliente_id).map(row => project(entity, row));
    if (entity === 'OrdenServicio') return rows.filter(row => row.cliente_id === actor.cliente_id && row.visible_cliente === true).map(row => project(entity, row));
    if (entity === 'LecturaHorometro') {
      const owned = new Set(entities?.Equipo.filter(row => row.cliente_id === actor.cliente_id).map(row => row.id) || []);
      return rows.filter(row => owned.has(String(row.equipo_id))).map(row => project(entity, row));
    }
    return [];
  }
  if (actor.rol === 'Técnico') {
    if (!actor.tecnico_id) return [];
    const assigned = entities?.OrdenServicio.filter(row => assignedTo(row, actor.tecnico_id)) || [];
    const tickets = entities?.Ticket?.filter(row => row.responsable_id === actor.tecnico_id) || [];
    const equipmentIds = new Set(assigned.map(row => row.equipo_id));
    const clientIds = new Set(assigned.map(row => row.cliente_id));
    const ticketEquipmentIds = new Set(tickets.map(row => row.equipo_id));
    const ticketClientIds = new Set(tickets.map(row => row.cliente_id));
    const granted = new Set(entities?.Equipo.filter(row => !retiredEquipment(row) && row.activo !== false).map(row => row.id));
    const grantedClients = new Set(entities?.Equipo.filter(row => granted.has(row.id)).map(row => row.cliente_id));
    if (entity === 'Tecnico') { const team = new Set(assigned.flatMap(orderTechnicians)); return rows.filter(row => row.activo !== false || row.id === actor.tecnico_id || team.has(row.id)).map(row => project(entity, row)); }
    if (entity === 'Ticket') return rows.filter(row => row.responsable_id === actor.tecnico_id).map(row => project(entity, row));
    if (entity === 'OrdenServicio') return rows.filter(row => assignedTo(row, actor.tecnico_id)).map(row => project(entity, row));
    if (entity === 'Equipo') return rows.filter(row => equipmentIds.has(row.id) || ticketEquipmentIds.has(row.id) || !retiredEquipment(row) && row.activo !== false).map(row => project(entity, { ...row, fuera_de_flota: retiredEquipment(row), estado_operativo: operationalState(row), estado_mantenimiento: maintenanceState(row) }));
    if (entity === 'Cliente') return rows.filter(row => clientIds.has(row.id) || ticketClientIds.has(row.id) || grantedClients.has(row.id)).map(row => project(entity, row));
    if (['Contacto', 'Sede'].includes(entity)) return rows.filter(row => clientIds.has(row.cliente_id) || ticketClientIds.has(row.cliente_id) || grantedClients.has(row.cliente_id)).map(row => project(entity, row));
    if (entity === 'LecturaHorometro') return rows.filter(row => equipmentIds.has(row.equipo_id)).map(row => project(entity, row));
    return [];
  }
  if (['Gasto', 'Liquidacion', 'Bitacora'].includes(entity)) return [];
  return rows;
}
export function assertAdmin(actor: Actor) {
  if (actor.rol !== 'Administrador') throw new ValidationError('Esta acción está disponible solo para administración.');
}
