import { findingClosed, findingLinkErrors } from './equipment-findings';
import { catalogGroups, definitions, entityNames, type Database, type EntityName, type EntityRecord, type Scalar } from './model';

import { statusMetadataFields } from './equipment-status';
import { validClientLogo } from './client-profile';
import { siteContactError } from './site-profile';
import { synchronizeEquipmentUnits } from './equipment-specifications';
import { equipmentImageFields, equipmentImageLabels, validEquipmentImage } from './equipment-images';
import { ValidationError } from './errors';

export function normalize(value: unknown) { return String(value ?? '').trim().normalize('NFKC').toLocaleLowerCase('es'); }
export function validateRecord(entity: EntityName, input: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const column of definitions[entity].columns) {
    const value = input[column.key];
    if (column.required && (value === undefined || value === null || (typeof value === 'string' && !value.trim()))) { errors.push(`${column.label}: obligatorio`); continue; }
    if (value === undefined || value === null || value === '') continue;
    if (column.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) errors.push(`${column.label}: debe ser un número mayor o igual a 0`);
    if (column.type === 'boolean' && typeof value !== 'boolean') errors.push(`${column.label}: usa Sí o No`);
    if (column.type === 'text' && typeof value !== 'string') errors.push(`${column.label}: debe ser texto`);
    if (column.options && !column.options.includes(String(value))) errors.push(`${column.label}: valor no permitido`);
    if (!(entity === 'Cliente' && column.key === 'logo') && !(entity === 'Equipo' && equipmentImageFields.some(field => field === column.key)) && typeof value === 'string' && value.length > (entity === 'Hallazgo' && column.key === 'descripcion' ? 2000 : 500)) errors.push(`${column.label}: máximo ${entity === 'Hallazgo' && column.key === 'descripcion' ? 2000 : 500} caracteres`);
  }
  if (entity === 'Cliente' && !validClientLogo(input.logo)) errors.push('Logo: usa una imagen PNG, JPG o WebP válida y ajustada desde el formulario.');
  if (entity === 'Equipo') for (const field of equipmentImageFields) if (!validEquipmentImage(input[field])) errors.push(`${equipmentImageLabels[field]}: usa una imagen PNG, JPG o WebP válida y ajustada desde el formulario.`);
  if (entity === 'Cliente' && input.dia_facturacion !== undefined && input.dia_facturacion !== '' && input.dia_facturacion !== null && (!Number.isInteger(input.dia_facturacion) || Number(input.dia_facturacion) < 1 || Number(input.dia_facturacion) > 31)) errors.push('Día de facturación: debe ser un entero entre 1 y 31');
  if (entity === 'Contacto' && input.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.correo))) errors.push('Correo: ingresa una dirección válida');
  if (entity === 'Equipo' && typeof input.anio === 'number' && !Number.isInteger(input.anio)) errors.push('Año: debe ser un número entero');
  if (entity === 'Hallazgo') {
    if (input.fecha_programada && (typeof input.fecha_programada !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.fecha_programada) || !Number.isFinite(Date.parse(input.fecha_programada)) || new Date(input.fecha_programada).toISOString().slice(0, 10) !== input.fecha_programada)) errors.push('Fecha programada: fecha inválida.');
    if (!['Por confirmar', 'Descartado'].includes(String(input.estado)) && input.prioridad === 'Por definir') errors.push('Define la prioridad antes de activar el seguimiento.');
    if (input.estado === 'Programado' && (!String(input.responsable || '').trim() || !input.fecha_programada)) errors.push('Para programar, indica responsable y fecha.');
    if (findingClosed(input as EntityRecord) && !String(input.detalle_resolucion || '').trim()) errors.push('Explica la resolución o el motivo de descarte.');
  }
  return errors;
}
export function uniqueError(entity: EntityName, input: Record<string, unknown>, rows: EntityRecord[], excludeId?: string): string | null {
  const other = rows.filter(row => row.id !== excludeId);
  if (input.codigo && other.some(row => normalize(row.codigo) === normalize(input.codigo))) return 'El código ya existe.';
  if (entity === 'Hallazgo' && other.some(row => row.equipo_id === input.equipo_id && String(row.orden_origen_id || '') === String(input.orden_origen_id || '') && normalize(row.descripcion) === normalize(input.descripcion))) return 'Ya existe un seguimiento con la misma descripción y origen. Revisa el existente.';
  if (entity === 'Equipo' && input.serie && other.some(row => normalize(row.serie) === normalize(input.serie))) return 'La serie ya existe.';
  if (entity === 'Cliente' && input.referencia_cliente && other.some(row => normalize(row.referencia_cliente) === normalize(input.referencia_cliente))) return 'La referencia de cliente ya existe.';
  if (entity === 'Catalogos' && other.some(row => normalize(row.categoria) === normalize(input.categoria) && normalize(row.nombre) === normalize(input.nombre))) return 'El nombre ya existe en esta categoría.';
  return null;
}
export function cleanFields(entity: EntityName, input: Record<string, unknown>): Record<string, Scalar> {
  const fields = Object.fromEntries(definitions[entity].columns.filter(column => input[column.key] !== undefined && !(entity === 'Hallazgo' && ['actualizado_nombre', 'cerrado_el'].includes(column.key)) && !(entity === 'Equipo' && statusMetadataFields.some(key => key === column.key))).map(column => [column.key, typeof input[column.key] === 'string' ? String(input[column.key]).trim() : input[column.key] as Scalar]));
  return entity === 'Equipo' ? synchronizeEquipmentUnits(fields) : fields;
}
function uniqueKeys(entity: EntityName, row: Record<string, unknown>): [string, string][] {
  const keys: [string, string][] = [];
  if (row.codigo) keys.push([JSON.stringify(['codigo', normalize(row.codigo)]), 'El código ya existe.']);
  if (entity === 'Equipo' && row.serie) keys.push([JSON.stringify(['serie', normalize(row.serie)]), 'La serie ya existe.']);
  if (entity === 'Cliente' && row.referencia_cliente) keys.push([JSON.stringify(['referencia', normalize(row.referencia_cliente)]), 'La referencia de cliente ya existe.']);
  if (entity === 'Hallazgo') keys.push([JSON.stringify(['hallazgo', row.equipo_id, String(row.orden_origen_id || ''), normalize(row.descripcion)]), 'Seguimiento duplicado para el mismo equipo y origen.']);
  if (entity === 'Catalogos') keys.push([JSON.stringify(['catalogo', normalize(row.categoria), normalize(row.nombre)]), 'El nombre ya existe en esta categoría.']);
  return keys;
}
export function validateDatabase(value: unknown, { maxRows = Infinity }: { maxRows?: number } = {}): asserts value is Database {
  if (!value || typeof value !== 'object') throw new ValidationError('El respaldo no contiene una estructura válida.');
  const data = value as Database;
  if (data.schemaVersion !== 1) throw new ValidationError('La versión de este respaldo no es compatible.');
  if (!Number.isInteger(data.revision) || data.revision < 0) throw new ValidationError('La revisión del respaldo no es válida.');
  if (!data.entities || entityNames.some(name => !Array.isArray(data.entities[name]))) throw new ValidationError('Faltan entidades en el respaldo.');
  for (const name of entityNames) {
    const rows = data.entities[name]; const ids = new Set<string>(); const seen = new Set<string>();
    if (rows.length > maxRows) throw new ValidationError(`${name}: demasiados registros para esta versión local.`);
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id)) throw new ValidationError(`${name}: identificador ausente o duplicado.`);
      if (typeof row.codigo !== 'string' || !row.codigo.trim()) throw new ValidationError(`${name}: código inválido.`);
      if (['creado_por', 'actualizado_por'].some(key => typeof row[key] !== 'string' || !row[key])) throw new ValidationError(`${name}: falta autoría.`);
      if (['fecha_creacion', 'fecha_actualizacion'].some(key => typeof row[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(String(row[key])) || !Number.isFinite(Date.parse(String(row[key]))))) throw new ValidationError(`${name}: fecha inválida.`);
      if (Object.entries(row).some(([key, cell]) => ['__proto__', 'constructor', 'prototype'].includes(key) || (cell !== null && !['string', 'number', 'boolean'].includes(typeof cell)))) throw new ValidationError(`${name}: contenido no permitido.`);
      const keys = uniqueKeys(name, row);
      const errors = validateRecord(name, row); const duplicate = keys.find(([key]) => seen.has(key))?.[1];
      if (errors.length || duplicate) throw new ValidationError(`${name}: ${errors.join('; ') || duplicate}`);
      ids.add(row.id); for (const [key] of keys) seen.add(key);
    }
  }
  const clients = new Set(data.entities.Cliente.map(row => row.id));
  for (const equipment of data.entities.Equipo) if (equipment.cliente_id && !clients.has(String(equipment.cliente_id))) throw new ValidationError(`${equipment.codigo}: el cliente vinculado no existe.`);
  for (const entity of ['Contacto', 'Sede'] as const) for (const row of data.entities[entity]) {
    if (!clients.has(String(row.cliente_id))) throw new ValidationError(`${row.codigo}: el cliente vinculado no existe.`);
  }
  const sites = new Map(data.entities.Sede.map(row => [row.id, row]));
  for (const site of sites.values()) {
    const error = siteContactError(site, data.entities.Contacto);
    if (error) throw new ValidationError(`${site.codigo}: ${error}`);
  }
  for (const equipment of data.entities.Equipo) if (equipment.sede_id && (!sites.has(String(equipment.sede_id)) || sites.get(String(equipment.sede_id))?.cliente_id !== equipment.cliente_id)) throw new ValidationError(`${equipment.codigo}: la sede no pertenece al cliente seleccionado.`);
  const equipmentIds = new Set(data.entities.Equipo.map(row => row.id));
  const orders = new Map(data.entities.OrdenServicio.map(row => [row.id, row]));
  for (const name of ['OrdenServicio', 'LecturaHorometro', 'OTRepuesto', 'OTHoras'] as const) {
    for (const row of data.entities[name]) {
      if (row.equipo_id && !equipmentIds.has(String(row.equipo_id))) throw new ValidationError(`${row.codigo}: el equipo vinculado no existe.`);
      if (row.cliente_id && !clients.has(String(row.cliente_id))) throw new ValidationError(`${row.codigo}: el cliente vinculado no existe.`);
      if (row.orden_id && (!orders.has(String(row.orden_id)) || orders.get(String(row.orden_id))?.equipo_id !== row.equipo_id)) throw new ValidationError(`${row.codigo}: la orden no corresponde al equipo.`);
      if (row.fecha && (typeof row.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(row.fecha) || !Number.isFinite(Date.parse(row.fecha)))) throw new ValidationError(`${row.codigo}: fecha de historial inválida.`);
      for (const key of ['valor', 'horas', 'horometro', 'cantidad', 'costo_repuestos', 'costo_mano_obra', 'costo_unitario']) {
        if (row[key] !== undefined && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || Number(row[key]) < 0)) throw new ValidationError(`${row.codigo}: ${key} debe ser un número mayor o igual a 0.`);
      }
    }
  }
  const equipmentMap = new Map(data.entities.Equipo.map(row => [row.id, row]));
  for (const row of data.entities.Hallazgo) {
    const errors = findingLinkErrors(row, equipmentMap, orders);
    if (errors.length) throw new ValidationError(`${row.codigo}: ${errors.join(' ')}`);
  }
  if (data.entities.Catalogos.some(row => !catalogGroups.includes(row.categoria as typeof catalogGroups[number]))) throw new ValidationError('Categoría de catálogo inválida.');
}
