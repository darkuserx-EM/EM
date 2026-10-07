import { type EntityRecord, type Scalar } from './model';
import { cleanFields, normalize, uniqueError, validateRecord } from './validation';
import { siteContactError } from './site-profile';

export const clientImportEntities = ['Cliente', 'Contacto', 'Sede'] as const;
export type ClientImportEntity = typeof clientImportEntities[number];
export type ClientImportData = Record<ClientImportEntity, EntityRecord[]>;
export interface ClientImportRow { entity: ClientImportEntity; line: number; id?: string; reference?: string; fields: Record<string, Scalar>; issues?: string[] }
export interface ClientImportPreview { input: ClientImportRow; action: 'Agregar' | 'Actualizar'; errors: string[]; clientName: string }
type Factory = (entity: ClientImportEntity, fields: Record<string, Scalar>, rows: EntityRecord[]) => EntityRecord;

// The same plan validates both the preview and the final atomic write.
export function planClientImport(current: ClientImportData, incoming: ClientImportRow[], factory?: Factory) {
  if (!incoming.length) throw new Error('El archivo no contiene filas para importar.');
  if (incoming.length > 2000) throw new Error('El límite es de 2000 filas en total por importación.');
  if (incoming.some(item => !clientImportEntities.includes(item.entity))) throw new Error('La importación solo admite Cliente, Contacto y Sede.');
  const entities = structuredClone(current);
  const preview: ClientImportPreview[] = [];
  const seenIds = new Set<string>();
  let counter = 0;
  for (const entity of clientImportEntities) for (const input of incoming.filter(item => item.entity === entity)) {
    const errors = [...(input.issues ?? [])];
    const rows = entities[entity];
    const id = input.id?.trim();
    const existing = id ? rows.find(row => row.id === id) : undefined;
    const fields = cleanFields(entity, input.fields);
    if (id && seenIds.has(`${entity}:${id}`)) errors.push('ID repetido dentro del archivo.');
    if (id) seenIds.add(`${entity}:${id}`);
    if (id && !existing) errors.push('El ID no existe. Para agregar, deja id vacío.');
    let clientName = String(fields.nombre ?? existing?.nombre ?? '');
    if (entity !== 'Cliente') {
      const reference = normalize(input.reference);
      const clientByReference = reference ? entities.Cliente.find(row => normalize(row.referencia_cliente) === reference) : undefined;
      if (reference && !clientByReference) errors.push('referencia_cliente no corresponde a un cliente válido del archivo o del portal.');
      if (clientByReference && fields.cliente_id && fields.cliente_id !== clientByReference.id) errors.push('cliente_id y referencia_cliente corresponden a empresas distintas.');
      if (clientByReference) fields.cliente_id = clientByReference.id;
      const clientId = fields.cliente_id ?? existing?.cliente_id;
      const client = entities.Cliente.find(row => row.id === clientId);
      if (!client) errors.push('Indica referencia_cliente o cliente_id de una empresa existente.');
      clientName = String(client?.nombre ?? 'Sin cliente válido');
    }
    const merged = { ...existing, ...fields };
    if (entity === 'Sede') { const issue = siteContactError(merged,entities.Contacto); if (issue) errors.push(issue); }
    errors.push(...validateRecord(entity, merged));
    const duplicate = uniqueError(entity, merged, rows, id); if (duplicate) errors.push(duplicate);
    const others = rows.filter(row => row.id !== id);
    if (entity === 'Cliente') {
      const nit = normalize(merged.nit).replace(/[\s-]/g, '');
      if (nit && nit !== 'cf' && others.some(row => normalize(row.nit).replace(/[\s-]/g, '') === nit)) errors.push('El NIT ya está registrado. Para actualizar, conserva el id del cliente exportado.');
      if (merged.nombre && others.some(row => normalize(row.nombre) === normalize(merged.nombre))) errors.push('El nombre del cliente ya existe. Para actualizar, conserva su id exportado.');
    } else if (others.some(row => row.cliente_id === merged.cliente_id && normalize(row.nombre) === normalize(merged.nombre) && (entity === 'Sede' || (normalize(row.correo) === normalize(merged.correo) && normalize(row.telefono) === normalize(merged.telefono))))) errors.push(`${entity === 'Sede' ? 'La sede' : 'El contacto'} ya existe para este cliente. Usa su id para actualizar.`);
    if (!errors.length) {
      if (existing) Object.assign(existing, fields);
      else {
        counter++;
        rows.push(factory ? factory(entity, fields, rows) : { id: `client-import-preview-${counter}`, codigo: '', creado_por: '', actualizado_por: '', fecha_creacion: '', fecha_actualizacion: '', ...fields });
      }
    }
    preview.push({ input, action: id ? 'Actualizar' : 'Agregar', errors: [...new Set(errors)], clientName });
  }
  return { entities, rows: preview };
}
