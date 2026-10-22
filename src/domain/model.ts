import { findingComponents, findingPriorities, findingStates } from './equipment-findings';
import { administrativeStates, maintenanceStates, operationalStates } from './equipment-status';

export const entityNames = ['Cliente', 'Contacto', 'Sede', 'Contrato', 'ContratoEquipo', 'Equipo', 'LecturaEnviada', 'LecturaHorometro', 'PlanPM', 'Hallazgo', 'Ticket', 'OrdenServicio', 'OTRepuesto', 'OTHoras', 'CheckList', 'CheckListItem', 'Tecnico', 'Gasto', 'Liquidacion', 'Usuario', 'Catalogos', 'Bitacora'] as const;
export type EntityName = typeof entityNames[number];
export type Role = 'Administrador' | 'Coordinador' | 'Técnico' | 'Cliente';
export type Scalar = string | number | boolean | null;
export interface EntityRecord {
  id: string;
  codigo: string;
  creado_por: string;
  fecha_creacion: string;
  actualizado_por: string;
  fecha_actualizacion: string;
  [key: string]: Scalar;
}
export interface Actor { id: string; nombre: string; rol: Role; cliente_id?: string; tecnico_id?: string }
export interface Database { schemaVersion: 1; revision: number; entities: Record<EntityName, EntityRecord[]> }
export interface Column { key: string; label: string; type: 'text' | 'number' | 'boolean'; required?: boolean; options?: readonly string[] }
export interface EntityDefinition { label: string; prefix: string; columns: Column[] }
export const catalogGroups = ['Marcas', 'Tipos de equipo', 'Síntomas', 'Categorías de gasto', 'Turnos', 'Ítems de revisión', 'Estados comerciales', 'Sectores / actividades'] as const;
export const equipmentStates = ['Pendiente de revisión', 'Disponible', 'En renta', 'En mantenimiento', 'En taller', 'En tránsito', 'Vendido', 'Baja'] as const;
export const baseColumns: Column[] = [
  { key: 'id', label: 'id', type: 'text' }, { key: 'codigo', label: 'codigo', type: 'text' },
  { key: 'creado_por', label: 'creado_por', type: 'text' }, { key: 'fecha_creacion', label: 'fecha_creacion', type: 'text' },
  { key: 'actualizado_por', label: 'actualizado_por', type: 'text' }, { key: 'fecha_actualizacion', label: 'fecha_actualizacion', type: 'text' },
];
const textColumn = (key: string, required = false, options?: readonly string[]): Column => ({ key, label: key, type: 'text', required, options });
const numberColumn = (key: string): Column => ({ key, label: key, type: 'number' });
export const definitions: Record<EntityName, EntityDefinition> = Object.fromEntries(entityNames.map(name => [name, { label: name, prefix: name.toUpperCase().slice(0, 3), columns: [] }])) as unknown as Record<EntityName, EntityDefinition>;
Object.assign(definitions, {
  LecturaEnviada: { label: 'Lecturas enviadas', prefix: 'ENV', columns: [textColumn('equipo_id', true), textColumn('cliente_id', true), textColumn('fecha', true), numberColumn('valor'), textColumn('observacion'), textColumn('archivo'), textColumn('lote_id'), textColumn('estado', true, ['Pendiente', 'Aprobada', 'Rechazada']), textColumn('motivo'), textColumn('revisado_por'), textColumn('revisado_el'), textColumn('lectura_id')] },
  PlanPM: { label: 'Planes de mantenimiento', prefix: 'PM', columns: [numberColumn('schema_plan'), textColumn('equipo_id'), textColumn('tipo_plan'), textColumn('criterio'), numberColumn('intervalo'), textColumn('estado_plan'), textColumn('base_origen'), textColumn('base_orden_id'), textColumn('base_fecha'), numberColumn('base_horas'), textColumn('base_calidad'), { key: 'base_confirmada', label: 'Base confirmada', type: 'boolean' }, textColumn('responsable'), textColumn('motivo'), numberColumn('version'), { key: 'vigente', label: 'Versión vigente', type: 'boolean' }, textColumn('anterior_id'), textColumn('confirmado_por'), textColumn('confirmado_el'), textColumn('vigente_desde')] },
  Hallazgo: { label: 'Hallazgos del equipo', prefix: 'HAL', columns: [textColumn('equipo_id', true), textColumn('descripcion', true), textColumn('componente', true, findingComponents), textColumn('prioridad', true, findingPriorities), textColumn('estado', true, findingStates), textColumn('responsable'), textColumn('fecha_programada'), textColumn('orden_origen_id'), textColumn('orden_resolucion_id'), textColumn('detalle_resolucion'), textColumn('nota_cambio'), textColumn('actualizado_nombre'), textColumn('cerrado_el')] },
  Ticket: { label: 'Solicitudes de servicio', prefix: 'TKT', columns: [numberColumn('schema_operacion'), textColumn('solicitud_id'), textColumn('equipo_id'), textColumn('cliente_id'), textColumn('sede_id'), textColumn('titulo'), textColumn('descripcion'), textColumn('prioridad'), textColumn('estado'), textColumn('fecha_programada'), textColumn('responsable_id'), textColumn('orden_id'), textColumn('reapertura_motivo'), textColumn('cancelacion_motivo')] },
  OrdenServicio: { label: 'Órdenes de servicio', prefix: 'OS', columns: [textColumn('revision_accion'), textColumn('revision_motivo'), numberColumn('schema_operacion'), textColumn('solicitud_id'), textColumn('equipo_id'), textColumn('cliente_id'), textColumn('sede_id'), textColumn('ticket_id'), { key: 'desde_solicitud', label: 'Creada desde solicitud', type: 'boolean' }, textColumn('tecnico_id'), textColumn('tecnico_apoyo_1_id'), textColumn('tecnico_apoyo_2_id'), textColumn('tipo'), textColumn('prioridad'), textColumn('estado'), textColumn('fecha_programada'), textColumn('hora_programada'), textColumn('fecha'), textColumn('fecha_fin'), textColumn('sintoma'), textColumn('diagnostico'), textColumn('causa_confirmada'), textColumn('trabajo_realizado'), textColumn('recomendaciones'), textColumn('pruebas_realizadas'), textColumn('resultado_pruebas'), textColumn('recibido_por'), textColumn('notas_seguridad'), textColumn('insumos'), textColumn('repuestos'), numberColumn('horometro'), numberColumn('odometro_millas'), { key: 'visible_cliente', label: 'Visible para cliente', type: 'boolean' }, textColumn('motivo'), textColumn('trabajo'), textColumn('tecnico')] },
  LecturaHorometro: { label: 'Lecturas de horómetro', prefix: 'HOR', columns: [numberColumn('schema_operacion'), textColumn('solicitud_id'), textColumn('equipo_id'), textColumn('cliente_id'), textColumn('orden_id'), textColumn('fecha'), numberColumn('valor'), numberColumn('odometro_millas'), textColumn('origen'), textColumn('registrado_por'), { key: 'es_estimado', label: 'Estimada', type: 'boolean' }] },
  Cliente: { label: 'Clientes', prefix: 'CLI', columns: [textColumn('nombre', true), textColumn('nombre_comercial'), textColumn('logo'), textColumn('plus_code'), textColumn('sector'), textColumn('estado', true, ['Activo', 'Prospecto', 'Inactivo']), textColumn('ubicacion'), textColumn('referencia_cliente'), textColumn('nit'), textColumn('direccion_fiscal'), numberColumn('dia_facturacion'), textColumn('reporte_mensual_horas', false, ['Sí', 'No']), textColumn('notas_operativas')] },
  Contacto: { label: 'Contactos', prefix: 'CON', columns: [textColumn('cliente_id', true), textColumn('nombre', true), textColumn('cargo'), textColumn('telefono'), textColumn('correo'), textColumn('principal', false, ['Sí', 'No'])] },
  Sede: { label: 'Sedes', prefix: 'SED', columns: [textColumn('cliente_id', true), textColumn('nombre', true), textColumn('direccion'), textColumn('municipio'), textColumn('departamento'), textColumn('referencia_ubicacion'), textColumn('autoriza_contacto_id'), textColumn('horario_atencion'), textColumn('autoriza_ingreso')] },
  Equipo: { label: 'Equipos', prefix: 'TCL', columns: [textColumn('marca', true), textColumn('modelo', true), textColumn('serie', true), { key: 'id_interno_cliente', label: 'ID interno del cliente', type: 'text' }, textColumn('tipo', true), textColumn('propiedad', true, ['Propio', 'De cliente']), textColumn('estado', true, equipmentStates), { key: 'estado_operativo', label: 'Estado operativo', type: 'text', options: operationalStates }, { key: 'estado_administrativo', label: 'Situación administrativa', type: 'text', options: administrativeStates }, { key: 'estado_mantenimiento', label: 'Aviso de mantenimiento', type: 'text', options: maintenanceStates }, textColumn('motivo_estado'), textColumn('estado_actualizado_por'), textColumn('estado_actualizado_el'), textColumn('cliente_id'), { key: 'horometro', label: 'horometro', type: 'number' }, textColumn('sede_id'), numberColumn('anio'), numberColumn('capacidad_lb'), numberColumn('altura_elevacion_in'), numberColumn('altura_torre_in'), numberColumn('largo_cuchillas_in'), numberColumn('capacidad_kg'), numberColumn('altura_elevacion_m'), numberColumn('voltaje'), textColumn('bateria'), textColumn('cargador'), textColumn('combustible'), textColumn('llantas_delanteras'), textColumn('llantas_traseras'), textColumn('caster'), textColumn('llantas'), textColumn('foto_equipo'), textColumn('placa_datos'), textColumn('foto_frontal'), textColumn('foto_trasera'), textColumn('foto_lateral_1'), textColumn('foto_lateral_2'), textColumn('notas')] },
  Tecnico: { label: 'Técnicos', prefix: 'TEC', columns: [textColumn('nombre', true), textColumn('especialidad'), textColumn('equipos_habilitados')] },
  Usuario: { label: 'Usuarios de demostración', prefix: 'USR', columns: [textColumn('nombre', true), textColumn('rol', true, ['Administrador', 'Coordinador', 'Técnico', 'Cliente']), textColumn('cliente_id'), textColumn('tecnico_id')] },
  Catalogos: { label: 'Catálogos', prefix: 'CAT', columns: [textColumn('categoria', true, catalogGroups), textColumn('nombre', true), { key: 'activo', label: 'activo', type: 'boolean', required: true }] },
  Bitacora: { label: 'Bitácora', prefix: 'LOG', columns: [textColumn('entidad', true), textColumn('accion', true), textColumn('detalle', true)] },
});
export const stages = [
  { id: 1, title: 'Base y diseño', detail: 'Navegación, roles de demostración, catálogos, Excel y respaldos.', modules: ['inicio', 'catalogos', 'datos', 'accesos', 'plan'] },
  { id: 2, title: 'Clientes y contratos', detail: 'Contactos, sedes, contratos, cobertura y adendas.', modules: ['clientes', 'contratos'] },
  { id: 3, title: 'Flota', detail: 'Fichas, historial de reparaciones y uso, asignación, documentos y estados.', modules: ['flota'] },
  { id: 4, title: 'Solicitudes', detail: 'Prioridades, kanban y reglas de SLA.', modules: ['tickets'] },
  { id: 5, title: 'Órdenes de servicio', detail: 'Vista del técnico, repuestos, horas, firma y reporte PDF.', modules: ['ordenes'] },
  { id: 6, title: 'Preventivos y calendario', detail: 'Frecuencias, vencimientos y agenda de servicio.', modules: ['preventivos', 'calendario'] },
  { id: 7, title: 'Checklist y horómetros', detail: 'Revisión por QR, lecturas y fallas críticas.', modules: ['checklists'] },
  { id: 8, title: 'Horas, viáticos y costos', detail: 'Gastos, liquidaciones, costos y reportes.', modules: ['horas', 'viaticos', 'costos', 'reportes'] },
  { id: 9, title: 'Portal del cliente', detail: 'Flota, solicitudes y documentos por empresa.', modules: ['portal'] },
  { id: 10, title: 'Indicadores y publicación', detail: 'Reportes, pruebas integrales y publicación de prueba en Hostinger.', modules: ['dashboard'] },
];
