export const entityNames = ['Cliente', 'Contacto', 'Sede', 'Contrato', 'ContratoEquipo', 'Equipo', 'LecturaHorometro', 'PlanPM', 'Ticket', 'OrdenServicio', 'OTRepuesto', 'OTHoras', 'CheckList', 'CheckListItem', 'Tecnico', 'Gasto', 'Liquidacion', 'Usuario', 'Catalogos', 'Bitacora'] as const;
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
export const equipmentStates = ['Disponible', 'En renta', 'En mantenimiento', 'En taller', 'En tránsito', 'Vendido', 'Baja'] as const;
export const baseColumns: Column[] = [
  { key: 'id', label: 'id', type: 'text' }, { key: 'codigo', label: 'codigo', type: 'text' },
  { key: 'creado_por', label: 'creado_por', type: 'text' }, { key: 'fecha_creacion', label: 'fecha_creacion', type: 'text' },
  { key: 'actualizado_por', label: 'actualizado_por', type: 'text' }, { key: 'fecha_actualizacion', label: 'fecha_actualizacion', type: 'text' },
];
const textColumn = (key: string, required = false, options?: readonly string[]): Column => ({ key, label: key, type: 'text', required, options });
const numberColumn = (key: string): Column => ({ key, label: key, type: 'number' });
export const definitions: Record<EntityName, EntityDefinition> = Object.fromEntries(entityNames.map(name => [name, { label: name, prefix: name.toUpperCase().slice(0, 3), columns: [] }])) as unknown as Record<EntityName, EntityDefinition>;
Object.assign(definitions, {
  LecturaHorometro: { label: 'Lecturas de horómetro', prefix: 'HOR', columns: [] },
  Cliente: { label: 'Clientes', prefix: 'CLI', columns: [textColumn('nombre', true), textColumn('nombre_comercial'), textColumn('logo'), textColumn('plus_code'), textColumn('sector'), textColumn('estado', true, ['Activo', 'Prospecto', 'Inactivo']), textColumn('ubicacion'), textColumn('referencia_cliente'), textColumn('nit'), textColumn('direccion_fiscal'), numberColumn('dia_facturacion'), textColumn('reporte_mensual_horas', false, ['Sí', 'No']), textColumn('notas_operativas')] },
  Contacto: { label: 'Contactos', prefix: 'CON', columns: [textColumn('cliente_id', true), textColumn('nombre', true), textColumn('cargo'), textColumn('telefono'), textColumn('correo'), textColumn('principal', false, ['Sí', 'No'])] },
  Sede: { label: 'Sedes', prefix: 'SED', columns: [textColumn('cliente_id', true), textColumn('nombre', true), textColumn('direccion'), textColumn('municipio'), textColumn('departamento'), textColumn('referencia_ubicacion'), textColumn('autoriza_contacto_id'), textColumn('horario_atencion'), textColumn('autoriza_ingreso')] },
  Equipo: { label: 'Equipos', prefix: 'TCL', columns: [textColumn('marca', true), textColumn('modelo', true), textColumn('serie', true), textColumn('tipo', true), textColumn('propiedad', true, ['Propio', 'De cliente']), textColumn('estado', true, equipmentStates), textColumn('cliente_id'), { key: 'horometro', label: 'horometro', type: 'number', required: true }, textColumn('sede_id'), numberColumn('anio'), numberColumn('capacidad_kg'), numberColumn('altura_elevacion_m'), numberColumn('voltaje'), textColumn('bateria'), textColumn('cargador'), textColumn('combustible'), textColumn('llantas'), textColumn('notas')] },
  Tecnico: { label: 'Técnicos', prefix: 'TEC', columns: [textColumn('nombre', true), textColumn('especialidad')] },
  Usuario: { label: 'Usuarios de demostración', prefix: 'USR', columns: [textColumn('nombre', true), textColumn('rol', true, ['Administrador', 'Coordinador', 'Técnico', 'Cliente']), textColumn('cliente_id'), textColumn('tecnico_id')] },
  Catalogos: { label: 'Catálogos', prefix: 'CAT', columns: [textColumn('categoria', true, catalogGroups), textColumn('nombre', true), { key: 'activo', label: 'activo', type: 'boolean', required: true }] },
  Bitacora: { label: 'Bitácora', prefix: 'LOG', columns: [textColumn('entidad', true), textColumn('accion', true), textColumn('detalle', true)] },
});
export const stages = [
  { id: 1, title: 'Base y diseño', detail: 'Navegación, roles de demostración, catálogos, Excel y respaldos.', modules: ['inicio', 'catalogos', 'datos', 'accesos', 'plan'] },
  { id: 2, title: 'Clientes y contratos', detail: 'Contactos, sedes, contratos, cobertura y adendas.', modules: ['clientes', 'contratos'] },
  { id: 3, title: 'Flota', detail: 'Fichas, historial de reparaciones y uso, asignación, documentos y estados.', modules: ['flota'] },
  { id: 4, title: 'Tickets', detail: 'Solicitudes, prioridades, kanban y reglas de SLA.', modules: ['tickets'] },
  { id: 5, title: 'Órdenes de servicio', detail: 'Vista del técnico, repuestos, horas, firma y reporte PDF.', modules: ['ordenes'] },
  { id: 6, title: 'Preventivos y calendario', detail: 'Frecuencias, vencimientos y agenda de servicio.', modules: ['preventivos', 'calendario'] },
  { id: 7, title: 'Checklist y horómetros', detail: 'Revisión por QR, lecturas y fallas críticas.', modules: ['checklists'] },
  { id: 8, title: 'Horas, viáticos y costos', detail: 'Gastos, liquidaciones, costos y reportes.', modules: ['horas', 'viaticos', 'costos', 'reportes'] },
  { id: 9, title: 'Portal del cliente', detail: 'Flota, solicitudes y documentos por empresa.', modules: ['portal'] },
  { id: 10, title: 'Dashboard y publicación', detail: 'Indicadores, pruebas integrales y publicación de prueba en Hostinger.', modules: ['dashboard'] },
];
