import * as XLSX from 'xlsx';
import { baseColumns, definitions, entityNames, type Actor, type Database, type EntityName, type EntityRecord, type Scalar } from '../domain/model';
import { assertAdmin } from '../domain/permissions';
import { normalize, uniqueError, validateDatabase, validateRecord } from '../domain/validation';
import type { ImportRow } from './repository';
import type { EquipmentHistory } from '../domain/equipment-history';

export interface PreviewRow { line: number; values: ImportRow; action: 'Agregar' | 'Actualizar'; errors: string[] }
const maxRows = 2000;
export function rowsToSheet(entity: EntityName, rows: EntityRecord[], includeOptionalHeaders = true) {
  const keys = [...baseColumns, ...definitions[entity].columns].map(column => column.key).filter(key => includeOptionalHeaders || rows.some(row => key in row));
  const extras = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(key => !keys.includes(key));
  return XLSX.utils.json_to_sheet(rows, { header: [...keys, ...extras] });
}
export function makeTemplate(entity: EntityName) {
  const workbook = XLSX.utils.book_new();
  const example = entity === 'Catalogos' ? { id: '', categoria: 'Marcas', nombre: 'Marca de ejemplo', activo: 'Sí' } : { id: '' };
  const sheet = XLSX.utils.json_to_sheet([example], { header: ['id', ...definitions[entity].columns.map(column => column.key)] });
  sheet['!cols'] = [{ wch: 38 }, ...definitions[entity].columns.map(() => ({ wch: 28 }))];
  XLSX.utils.book_append_sheet(workbook, sheet, entity);
  const instructions = [
    { campo: 'General', instrucciones: 'Elimina la fila de ejemplo antes de importar. Máximo 2000 filas. Se revisan todos los errores antes de guardar.' },
    { campo: 'id', instrucciones: 'Vacío: agregar. ID existente exportado: actualizar. No se aceptan IDs nuevos escritos manualmente.' },
    ...definitions[entity].columns.map(column => ({ campo: column.key, instrucciones: `${column.required ? 'Obligatorio. ' : 'Opcional. '}${column.type === 'boolean' ? 'Sí / No (también true / false).' : column.options ? column.options.join(' / ') : column.type === 'number' ? 'Número mayor o igual a cero.' : 'Texto.'}` })),
  ];
  const guide = XLSX.utils.json_to_sheet(instructions); guide['!cols'] = [{ wch: 22 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, guide, 'Instrucciones'); return workbook;
}
export function parseImport(entity: EntityName, workbook: XLSX.WorkBook, current: EntityRecord[]): PreviewRow[] {
  const sheet = workbook.Sheets[entity];
  if (!sheet) throw new Error(`No se encontró la hoja ${entity}. Usa la plantilla descargada.`);
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
  if (!raw.length) throw new Error('El archivo no contiene filas para importar.');
  if (raw.length > maxRows) throw new Error(`El límite de esta versión es ${maxRows} filas por importación.`);
  const headers = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })[0] ?? [];
  for (const field of definitions[entity].columns.filter(column => column.required)) if (!headers.includes(field.key)) throw new Error(`Falta el encabezado obligatorio: ${field.key}.`);
  const ids = new Set<string>(); const tentative = structuredClone(current);
  return raw.map((row, index) => {
    const errors: string[] = []; const id = String(row.id ?? '').trim();
    const values: ImportRow = { id: id || undefined, fields: {} };
    for (const column of definitions[entity].columns) {
      let value: unknown = row[column.key];
      if (column.type === 'boolean') { const normalized = normalize(value); value = ['sí', 'si', 'true', '1'].includes(normalized) ? true : ['no', 'false', '0'].includes(normalized) ? false : value; }
      if (column.type === 'number' && value !== '' && value !== undefined) value = Number(value);
      values.fields[column.key] = (typeof value === 'string' ? value.trim() : value ?? '') as Scalar;
    }
    if (id && ids.has(id)) errors.push('ID repetido dentro del archivo.');
    if (id) ids.add(id);
    const existing = tentative.find(item => item.id === id);
    if (id && !existing) errors.push('El ID no existe. Para agregar, deja id vacío.');
    errors.push(...validateRecord(entity, values.fields));
    const duplicate = uniqueError(entity, values.fields, tentative, id || undefined); if (duplicate) errors.push(duplicate);
    if (!errors.length) {
      if (existing) Object.assign(existing, values.fields);
      else tentative.push({ id: `preview-${index}`, codigo: '', ...values.fields } as EntityRecord);
    }
    return { line: index + 2, values, action: id ? 'Actualizar' : 'Agregar', errors };
  });
}
export function makeBackup(database: Database) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ schemaVersion: database.schemaVersion, revision: database.revision, exportado: new Date().toISOString(), aplicacion: 'Portal EM' }]), '_metadata');
  for (const entity of entityNames) XLSX.utils.book_append_sheet(workbook, rowsToSheet(entity, database.entities[entity], false), entity);
  return workbook;
}
export function parseBackup(workbook: XLSX.WorkBook): Database {
  if (!workbook.Sheets._metadata) throw new Error('No es un respaldo completo de Portal EM.');
  const metadata = XLSX.utils.sheet_to_json<{ schemaVersion: number; revision: number; aplicacion: string }>(workbook.Sheets._metadata)[0];
  if (!metadata || metadata.aplicacion !== 'Portal EM') throw new Error('El respaldo no pertenece a Portal EM.');
  const database = { schemaVersion: metadata.schemaVersion, revision: metadata.revision, entities: {} } as Database;
  for (const entity of entityNames) {
    if (!workbook.Sheets[entity]) throw new Error(`Falta la hoja ${entity}. El respaldo no está completo.`);
    database.entities[entity] = XLSX.utils.sheet_to_json<EntityRecord>(workbook.Sheets[entity], { defval: '', raw: true });
  }
  validateDatabase(database); return database;
}
export async function readWorkbook(file: File, inspectFormulas = false) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Selecciona un archivo .xlsx.');
  if (file.size > 8 * 1024 * 1024) throw new Error('El archivo supera el límite de 8 MB de esta versión.');
  return XLSX.read(await file.arrayBuffer(), { type: 'array', cellFormula: inspectFormulas, cellHTML: false });
}
export function downloadWorkbook(workbook: XLSX.WorkBook, filename: string) { XLSX.writeFile(workbook, filename, { compression: true }); }
export function exportRows(entity: EntityName, rows: EntityRecord[], actor: Actor) {
  assertAdmin(actor);
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, rowsToSheet(entity, rows), entity); downloadWorkbook(workbook, `Portal-EM-${entity}.xlsx`);
}

export function makeEquipmentHistoryWorkbook(equipment: EntityRecord, history: EquipmentHistory, from: string, to: string) {
  const workbook = XLSX.utils.book_new();
  const sheets: [string, EntityRecord[]][] = [['Equipo', [equipment]], ['Reparaciones', history.repairs], ['Horometros', history.usage.map(item => item.row)], ['Repuestos', history.parts], ['Mano de obra', history.labor]];
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { campo: 'Alcance', valor: 'Datos ficticios de demostración. Historial del equipo seleccionado.' },
    { campo: 'Desde / hasta (Guatemala)', valor: `${from || 'Sin límite'} / ${to || 'Sin límite'}` },
    { campo: 'Uso entre lecturas seleccionadas', valor: history.hoursUsed === null ? 'No calculable: faltan lecturas comparables' : `${history.hoursUsed} h` },
    { campo: 'Interpretación', valor: 'El horómetro es acumulado. El uso se calcula entre la primera y última lectura seleccionada; no supone horas diarias ni tiempo de mano de obra.' },
  ]), 'Información');
  return workbook;
}
