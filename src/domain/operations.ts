import { assignedTo, orderTechnicians, supportFields, orderTeamLabel } from './order-team';
import { todayGT } from './maintenance-plan';
import type { Actor, Database, EntityName, EntityRecord, Scalar } from './model';
import { ValidationError } from './errors';
import { canCreateTicketOrder, canReopenTicket, technicianEquipmentIds, ticketHasOrder } from './technician-work';

export const ticketStates = ['Nuevo', 'En revisión', 'Programado', 'Resuelto', 'Cancelado'] as const;
export const orderStates = ['Borrador', 'Programada', 'En proceso', 'En espera', 'Completada', 'Cancelada'] as const;
export const operationPriorities = ['Baja', 'Media', 'Alta', 'Crítica'] as const;
export const orderTypes = ['Preventivo', 'Correctivo', 'Inspección', 'Mantenimiento mayor'] as const;
export const operationalEntities = ['Ticket', 'OrdenServicio', 'LecturaHorometro'] as const;
export const isOperationalEntity = (entity: EntityName) => operationalEntities.some(name => name === entity);
export const managesOperations = (actor: Actor) => ['Administrador', 'Coordinador'].includes(actor.rol);

/** Called only after a validated completion, using the full write baseline. */
export function ticketsResolvedByOrder(order: EntityRecord, entities: Database['entities']): EntityRecord[] {
  if (order.schema_operacion !== 1 || order.importado === true || order.estado !== 'Completada') return [];
  return entities.Ticket.filter(ticket => {
    if (ticket.schema_operacion !== 1 || ticket.importado === true || !['Nuevo', 'En revisión', 'Programado'].includes(String(ticket.estado))) return false;
    if (order.ticket_id !== ticket.id && ticket.orden_id !== order.id) return false;
    const related = entities.OrdenServicio.filter(row => row.ticket_id === ticket.id || ticket.orden_id === row.id);
    // Canceled, historical, ambiguous or still-open work requires manual review.
    // Keep both legacy link directions; never infer a relationship from equipment alone.
    return related.length > 0 && (!ticket.orden_id || related.some(row => row.id === ticket.orden_id)) && related.every(row =>
      row.schema_operacion === 1 && row.importado !== true && row.estado === 'Completada' &&
      row.equipo_id === ticket.equipo_id && row.cliente_id === ticket.cliente_id && (!row.ticket_id || row.ticket_id === ticket.id));
  });
}
const text = (value: unknown) => String(value ?? '').trim();
const validDay = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validInstant = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const forbidden = () => Object.assign(new ValidationError('No tienes permiso para modificar esta operación.'), { status: 403 });

/** Version gating keeps imported and pre-existing reports readable without rewriting their source. */
export function operationFieldErrors(entity: EntityName, row: Record<string, unknown>): string[] {
  if (!isOperationalEntity(entity) || row.schema_operacion !== 1) return [];
  const errors: string[] = [];
  if (!text(row.equipo_id)) errors.push('Selecciona el equipo.');
  if (row.solicitud_id && !/^[a-zA-Z0-9_-]{8,100}$/.test(text(row.solicitud_id))) errors.push('Identificador de solicitud inválido.');
  if (entity === 'LecturaHorometro') {
    if (!validInstant(row.fecha) || Date.parse(String(row.fecha)) > Date.now() + 5 * 60000) errors.push('Indica una fecha válida que no esté en el futuro.');
    if (typeof row.valor !== 'number' || !Number.isFinite(row.valor) || row.valor < 0) errors.push('El horómetro debe ser un número mayor o igual a cero.');
    if (!['Registro manual', 'Orden de servicio'].includes(text(row.origen))) errors.push('Origen de lectura inválido.');
    return errors;
  }
  if (!operationPriorities.includes(row.prioridad as typeof operationPriorities[number])) errors.push('Selecciona una prioridad válida.');
  if (row.fecha_programada && !validDay(row.fecha_programada)) errors.push('Fecha programada inválida.');
  if (entity === 'Ticket') {
    if (!text(row.titulo) || !text(row.descripcion)) errors.push('Indica título y descripción de la solicitud.');
    if (!ticketStates.includes(row.estado as typeof ticketStates[number])) errors.push('Estado de ticket inválido.');
    if (row.estado === 'Programado' && (!row.fecha_programada || !row.responsable_id)) errors.push('Para programar indica fecha y técnico responsable.');
  } else {
    if (!orderTypes.includes(row.tipo as typeof orderTypes[number])) errors.push('Selecciona un tipo de servicio válido.');
    if (!orderStates.includes(row.estado as typeof orderStates[number])) errors.push('Estado de orden inválido.');
    if (!text(row.sintoma)) errors.push('Describe el síntoma o motivo del servicio.');
    if (row.hora_programada && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text(row.hora_programada))) errors.push('Hora programada inválida.');
    if (['Programada', 'En proceso', 'En espera', 'Completada'].includes(text(row.estado)) && (!row.fecha_programada || !row.tecnico_id)) errors.push('Para programar o ejecutar la orden indica fecha y técnico.');
    if (row.estado === 'Completada' && ['diagnostico', 'trabajo_realizado', 'pruebas_realizadas', 'resultado_pruebas'].some(key => !text(row[key]))) errors.push('Para completar registra diagnóstico, trabajo realizado, pruebas realizadas y resultado.');
    for (const key of ['fecha', 'fecha_fin']) if (row[key] && !validInstant(row[key])) errors.push(`${key}: fecha inválida.`);
    if (row.fecha && row.fecha_fin && Date.parse(String(row.fecha_fin)) < Date.parse(String(row.fecha))) errors.push('El fin de atención debe ser posterior al inicio.');
  }
  return errors;
}

export function operationLinkErrors(entity: EntityName, row: EntityRecord, entities: Database['entities']): string[] {
  if (!isOperationalEntity(entity) || row.schema_operacion !== 1) return [];
  const errors: string[] = [];
  const equipment = entities.Equipo.find(item => item.id === row.equipo_id);
  if (!equipment || String(equipment.cliente_id || '') !== String(row.cliente_id || '')) errors.push('El equipo no corresponde al cliente.');
  if (row.sede_id && !entities.Sede.some(item => item.id === row.sede_id && item.cliente_id === row.cliente_id)) errors.push('La sede no corresponde al cliente.');
  const technician = entity === 'Ticket' ? row.responsable_id : row.tecnico_id;
  if (technician && !entities.Tecnico.some(item => item.id === technician && item.activo !== false)) errors.push('El técnico seleccionado no está disponible.');
  if (entity === 'OrdenServicio') {
    const ids = orderTechnicians(row);
    if (ids.length && !row.tecnico_id || new Set(ids).size !== ids.length) errors.push('Selecciona un responsable y hasta dos apoyos distintos.');
    if (ids.some(id => !entities.Tecnico.some(item => item.id === id && item.activo !== false))) errors.push('Selecciona técnicos disponibles para el trabajo.');
  }
  if (row.ticket_id && !entities.Ticket.some(item => item.id === row.ticket_id && item.equipo_id === row.equipo_id && item.cliente_id === row.cliente_id)) errors.push('El ticket no corresponde al equipo y cliente.');
  if (row.orden_id && !entities.OrdenServicio.some(item => item.id === row.orden_id && item.equipo_id === row.equipo_id && item.cliente_id === row.cliente_id)) errors.push('La orden no corresponde al equipo y cliente.');
  return errors;
}

const orderTransitions: Record<string, readonly string[]> = {
  Borrador: ['Programada', 'En proceso', 'Cancelada'], Programada: ['En proceso', 'En espera', 'Cancelada'],
  'En proceso': ['En espera', 'Completada', 'Cancelada'], 'En espera': ['Programada', 'En proceso', 'Completada', 'Cancelada'],
  Completada: [], Cancelada: [],
};
const ticketTransitions: Record<string, readonly string[]> = {
  Nuevo: ['En revisión', 'Programado', 'Resuelto', 'Cancelado'], 'En revisión': ['Programado', 'Resuelto', 'Cancelado'],
  Programado: ['En revisión', 'Resuelto', 'Cancelado'], Resuelto: [], Cancelado: [],
};
export function allowedOperationStates(entity: 'Ticket' | 'OrdenServicio', original?: EntityRecord, actor?: Actor): string[] {
  if (!original) return entity === 'Ticket' ? actor?.rol === 'Cliente' ? ['Nuevo'] : ['Nuevo', 'En revisión', 'Programado'] : ['Borrador', 'Programada', 'En proceso'];
  const transitions = entity === 'Ticket' ? ticketTransitions : orderTransitions;
  const states = [String(original.estado), ...(transitions[String(original.estado)] || [])];
  if (actor?.rol === 'Técnico') return states.filter(state => state === original.estado || ['En proceso', 'En espera', 'Completada'].includes(state) || entity === 'OrdenServicio' && original.estado === 'Borrador' && state === 'Programada');
  return states;
}
export function prepareOperation(entity: EntityName, input: Record<string, Scalar>, actor: Actor, entities: Database['entities'], original?: EntityRecord): Record<string, Scalar> {
  if (!isOperationalEntity(entity)) return input;
  const manager = managesOperations(actor);
  if (entity === 'Ticket' && (input.estado === 'Cancelado' || input.cancelacion_motivo !== undefined)) {
    if (!manager) throw forbidden();
    if (!original || original.schema_operacion !== 1 || original.importado === true || !['Nuevo','En revisión','Programado'].includes(text(original.estado)) || input.estado !== 'Cancelado') throw new ValidationError('Solo puedes cancelar una solicitud abierta.');
    if (text(input.cancelacion_motivo).length < 8 || text(input.cancelacion_motivo).length > 500) throw new ValidationError('Explica el motivo de cancelación (entre 8 y 500 caracteres).');
    if (Object.keys(input).some(key => !['estado','cancelacion_motivo'].includes(key))) throw new ValidationError('Cancela la solicitud por separado para conservar sus datos.');
    const related = entities.OrdenServicio.filter(order => order.ticket_id === original.id || order.id === original.orden_id);
    if (original.orden_id && !related.some(order => order.id === original.orden_id)) throw new ValidationError('No se pudo verificar la orden vinculada. Revisa su relación antes de cancelar.');
    if (related.some(order => order.estado === 'Completada')) throw new ValidationError('Hay una orden completada. Revisa el trabajo realizado y resuelve la solicitud; no corresponde cancelarla.');
    if (related.some(order => order.estado !== 'Cancelada' || order.schema_operacion !== 1 || order.importado === true || order.equipo_id !== original.equipo_id || order.cliente_id !== original.cliente_id || order.ticket_id && order.ticket_id !== original.id)) throw new ValidationError('Revisa y cancela primero todas las órdenes vinculadas. No se cancelan automáticamente.');
    input = { ...input, cancelacion_motivo: text(input.cancelacion_motivo) };
  }
  const reopening = entity === 'Ticket' && original?.estado === 'Resuelto' && input.estado === 'En revisión';
  if (reopening) {
    if (!canReopenTicket(actor, original!, entities.OrdenServicio)) throw forbidden();
    if (text(input.reapertura_motivo).length < 8 || text(input.reapertura_motivo).length > 500) throw new ValidationError('Explica el motivo de reapertura (entre 8 y 500 caracteres).');
    if (Object.keys(input).some(key => !['estado', 'reapertura_motivo'].includes(key))) throw new ValidationError('Reabre primero la solicitud; después podrás revisar sus datos.');
  } else if (input.reapertura_motivo !== undefined) throw new ValidationError('El motivo se registra únicamente al reabrir una solicitud resuelta sin orden.');
  const closedRevision = entity === 'OrdenServicio' && original?.schema_operacion === 1 && original.importado !== true && original.estado === 'Completada' && ['corregir', 'reabrir'].includes(text(input.revision_accion));
  if (input.revision_accion !== undefined || input.revision_motivo !== undefined) {
    if (!closedRevision || !manager) throw forbidden();
    if (text(input.revision_motivo).length < 8 || text(input.revision_motivo).length > 500) throw new ValidationError('Explica el motivo de la revisión (entre 8 y 500 caracteres).');
    if (input.revision_accion === 'reabrir') {
      if (Object.keys(input).some(key => !['revision_accion', 'revision_motivo'].includes(key))) throw new ValidationError('Reabre primero la orden; después registra el trabajo pendiente.');
      input = { ...input, estado: 'En proceso', fecha_fin: '', visible_cliente: false };
    } else {
      const correctable = ['revision_accion', 'revision_motivo', 'sintoma', 'diagnostico', 'causa_confirmada', 'trabajo_realizado', 'recomendaciones', 'pruebas_realizadas', 'resultado_pruebas', 'recibido_por', 'notas_seguridad', 'insumos', 'repuestos'];
      if (Object.keys(input).some(key => !correctable.includes(key))) throw new ValidationError('La corrección conserva equipo, cliente, participantes, fechas, estado y lecturas.');
    }
  }
  const technicianCreate = entity === 'OrdenServicio' && !original && actor.rol === 'Técnico' && !!actor.tecnico_id;
  if (technicianCreate) {
    const allowed: string[] = [...supportFields, 'solicitud_id', 'schema_operacion', 'equipo_id', 'cliente_id', 'sede_id', 'ticket_id', 'tecnico_id', 'tipo', 'prioridad', 'estado', 'fecha_programada', 'hora_programada', 'sintoma', 'visible_cliente', 'desde_solicitud'];
    allowed.push('fecha', 'fecha_fin', 'diagnostico', 'causa_confirmada', 'trabajo_realizado', 'recomendaciones', 'pruebas_realizadas', 'resultado_pruebas', 'recibido_por', 'notas_seguridad', 'insumos', 'repuestos', 'horometro', 'odometro_millas');
    if (Object.keys(input).some(key => !allowed.includes(key)) || input.tecnico_id && input.tecnico_id !== actor.tecnico_id || input.visible_cliente === true) throw forbidden();
    if (!technicianEquipmentIds(actor, entities).has(text(input.equipo_id))) throw forbidden();
    if (input.ticket_id) {
      const ticket = entities.Ticket.find(row => row.id === input.ticket_id);
      if (!ticket || ticket.responsable_id !== actor.tecnico_id) throw forbidden();
      if (!canCreateTicketOrder(actor, ticket, entities.OrdenServicio)) throw Object.assign(new ValidationError('La solicitud ya tiene orden, está cerrada o no está asignada a ti. Revisa su estado actual.'), { status: 409 });
      if (input.equipo_id !== ticket.equipo_id) throw forbidden();
    }
    input = { ...input, tecnico_id: actor.tecnico_id!, visible_cliente: false };
  }
  if (entity === 'OrdenServicio' && !original && input.ticket_id && input.desde_solicitud === true) {
    const ticket = entities.Ticket.find(row => row.id === input.ticket_id);
    if (ticket && ticketHasOrder(ticket, entities.OrdenServicio)) throw Object.assign(new ValidationError('La solicitud ya tiene una orden. Abre la orden existente para continuar.'), { status: 409 });
  }
  const requestedEquipment = entities.Equipo.find(item => item.id === (original?.equipo_id || input.equipo_id));
  if (!manager) {
    const clientRequest = entity === 'Ticket' && !original && actor.rol === 'Cliente' && actor.cliente_id && requestedEquipment?.cliente_id === actor.cliente_id;
    const technicianOrder = entity === 'OrdenServicio' && original && actor.rol === 'Técnico' && actor.tecnico_id && assignedTo(original, actor.tecnico_id);
    const technicianReading = entity === 'LecturaHorometro' && !original && actor.rol === 'Técnico' && actor.tecnico_id && entities.OrdenServicio.some(order => order.id === input.orden_id && order.equipo_id === input.equipo_id && assignedTo(order, actor.tecnico_id) && order.schema_operacion === 1 && !['Completada', 'Cancelada'].includes(text(order.estado)));
    if (!clientRequest && !technicianOrder && !technicianReading && !technicianCreate && !reopening) throw forbidden();
  }
  if (original && original.schema_operacion !== 1) {
    if (entity === 'OrdenServicio' && actor.rol === 'Administrador' && typeof input.visible_cliente === 'boolean' && Object.keys(input).every(key => key === 'visible_cliente')) return { visible_cliente: input.visible_cliente };
    throw new ValidationError('Este reporte histórico conserva su información de origen. Crea una orden nueva para continuar la atención.');
  }
  if (original && entity === 'LecturaHorometro') throw new ValidationError('Las lecturas originales se conservan. Registra una nueva lectura; las correcciones requieren revisión de administración.');
  const row: Record<string, Scalar> = { ...(original || {}), ...input, schema_operacion: 1 };
  if (entity === 'OrdenServicio' && !original && row.ticket_id && entities.Ticket.some(ticket => ticket.id === row.ticket_id && ['Resuelto', 'Cancelado'].includes(String(ticket.estado)))) throw new ValidationError('La solicitud está cerrada. Registra una nueva solicitud para continuar la atención y conservar su historial.');
  if (entity === 'OrdenServicio' && original && ['horometro', 'odometro_millas'].some(key => typeof original[key] === 'number' && (input[key] === null || input[key] === ''))) throw new ValidationError('Conserva la lectura capturada. Las correcciones deben revisarse antes de sustituir el dato.');
  const equipment = entities.Equipo.find(item => item.id === row.equipo_id);
  if (!equipment) throw new ValidationError('Selecciona un equipo existente.');
  if (original && ['equipo_id', 'cliente_id', 'ticket_id', 'solicitud_id'].some(key => input[key] !== undefined && text(input[key]) !== text(original[key]))) throw new ValidationError('El equipo, cliente y origen de una operación se conservan.');
  if (input.cliente_id !== undefined && text(input.cliente_id) !== text(equipment.cliente_id)) throw new ValidationError('El equipo no corresponde al cliente.');
  row.cliente_id = equipment.cliente_id || '';
  if (!original && row.sede_id === undefined) row.sede_id = equipment.sede_id || '';
  if (!manager) {
    if (entity === 'Ticket' && !original && actor.rol === 'Cliente' && actor.cliente_id && actor.cliente_id === equipment.cliente_id) {
      if ((input.estado && input.estado !== 'Nuevo') || ['responsable_id', 'fecha_programada', 'orden_id'].some(key => input[key])) throw new ValidationError('La coordinación asigna y programa las solicitudes.');
    } else if (reopening || technicianCreate) {
      // Resource scope and permitted fields have already been checked above.
    } else if (entity === 'OrdenServicio' && original && actor.rol === 'Técnico' && actor.tecnico_id && assignedTo(original, actor.tecnico_id)) {
      const allowed: string[] = ['estado', 'fecha', 'fecha_fin', 'diagnostico', 'causa_confirmada', 'trabajo_realizado', 'recomendaciones', 'pruebas_realizadas', 'resultado_pruebas', 'recibido_por', 'notas_seguridad', 'insumos', 'repuestos', 'horometro', 'odometro_millas'];
      if (original.tecnico_id === actor.tecnico_id) allowed.push(...supportFields);
      if (original.estado === 'Borrador') allowed.push('fecha_programada', 'hora_programada');
      if (Object.keys(input).some(key => !allowed.includes(key) && input[key] !== original[key])) throw new ValidationError('Solo puedes actualizar la ejecución de tu orden asignada.');
      if (input.estado && input.estado !== original.estado && !['En proceso', 'En espera', 'Completada', ...(original.estado === 'Borrador' ? ['Programada'] : [])].includes(text(input.estado))) throw new ValidationError('La coordinación administra la reprogramación y cancelación.');
    } else if (entity === 'LecturaHorometro' && !original && actor.rol === 'Técnico' && actor.tecnico_id && entities.OrdenServicio.some(order => order.id === row.orden_id && order.equipo_id === equipment.id && assignedTo(order, actor.tecnico_id) && order.schema_operacion === 1 && !['Completada', 'Cancelada'].includes(text(order.estado)))) {
      // The reading is linked to the technician's active assignment.
    } else throw forbidden();
  }
  if (entity === 'LecturaHorometro') {
    row.fecha = row.fecha || new Date().toISOString(); row.origen = row.orden_id ? 'Orden de servicio' : 'Registro manual'; row.registrado_por = actor.nombre;
    const readings = entities.LecturaHorometro.filter(item => item.equipo_id === equipment.id && typeof item.valor === 'number').sort((a, b) => Date.parse(String(a.fecha)) - Date.parse(String(b.fecha)));
    const previous = readings.at(-1);
    if (previous && Date.parse(String(row.fecha)) <= Date.parse(String(previous.fecha))) throw new ValidationError('La lectura debe ser posterior a la última registrada. Conserva el historial y solicita una corrección si corresponde.');
    if (previous && Number(row.valor) < Number(previous.valor)) throw new ValidationError('El horómetro disminuye respecto de la última lectura. Verifica el dato; un cambio de contador requiere revisión documentada.');
    row.es_estimado = false;
  } else {
    row.prioridad = row.prioridad || 'Media'; row.estado = row.estado || (entity === 'Ticket' ? 'Nuevo' : 'Borrador');
    if (entity === 'OrdenServicio') {
      row.tipo = row.tipo || 'Correctivo'; row.visible_cliente = row.visible_cliente ?? false;
      row.motivo = row.sintoma || ''; row.trabajo = row.trabajo_realizado || '';
      row.tecnico = orderTeamLabel(row as EntityRecord, entities.Tecnico);
      if (!original && row.estado === 'En proceso') {
        row.fecha = row.fecha || new Date().toISOString();
        row.fecha_programada = row.fecha_programada || todayGT();
      }
      // Un borrador o una visita programada todavía no empieza: no guarda hora de inicio (tampoco al reprogramarla).
      if (['Borrador', 'Programada'].includes(text(row.estado))) row.fecha = '';
      // «Iniciar atención»: al pasar de borrador o programada a en proceso, el inicio es este momento,
      // salvo que la persona indique otro. Así no queda el inicio sugerido el día en que se creó la orden.
      if (original && ['Borrador', 'Programada'].includes(text(original.estado)) && row.estado === 'En proceso' && !text(input.fecha)) row.fecha = new Date().toISOString();
      if (!row.fecha && ['En proceso', 'Completada'].includes(text(row.estado))) row.fecha = new Date().toISOString();
      if (row.estado === 'Completada' && !row.fecha_fin) row.fecha_fin = new Date().toISOString();
    }
    if (original) {
      const transitions = entity === 'Ticket' ? ticketTransitions : orderTransitions;
      const publicationOnly = entity === 'OrdenServicio' && manager && typeof input.visible_cliente === 'boolean' && Object.keys(input).every(key => key === 'visible_cliente');
      if (!transitions[String(original.estado)]?.length && !publicationOnly && !reopening && !closedRevision) throw new ValidationError('La operación está cerrada; su historial se conserva. Reabre una solicitud resuelta sin orden antes de editarla.');
      if (original.estado !== row.estado && !transitions[String(original.estado)]?.includes(text(row.estado)) && !reopening && !closedRevision) throw new ValidationError(`Cambio de estado no permitido: ${original.estado} → ${row.estado}.`);
    } else if (!allowedOperationStates(entity as 'Ticket' | 'OrdenServicio').includes(text(row.estado))) throw new ValidationError(entity === 'Ticket' ? 'Crea la solicitud abierta antes de registrar su resolución.' : 'Crea la orden como borrador, programada o en proceso.');
  }
  const errors = operationFieldErrors(entity, row);
  errors.push(...operationLinkErrors(entity, row as EntityRecord, entities));
  if (errors.length) throw new ValidationError(errors.join(' '));
  // Never copy authorship from an edited record into the write fields.
  const { id: _id, codigo: _code, creado_por: _creator, actualizado_por: _updater, fecha_creacion: _created, fecha_actualizacion: _updated, ...fields } = row;
  delete fields.revision_accion; delete fields.revision_motivo;
  return fields;
}
