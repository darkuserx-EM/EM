import * as XLSX from 'xlsx';
import type { EntityRecord } from '../domain/model';
import { equipmentImageFields, MAX_EQUIPMENT_IMAGE_LENGTH, validEquipmentImage, isEquipmentImageReference, type EquipmentImageField } from '../domain/equipment-images';

const sheetName = '_imagenes_equipo';
const chunkSize = 30000; // Excel admite un máximo de 32767 caracteres por celda.
const marker = (field: EquipmentImageField) => `@EM_IMAGE:${field}`;
export function attachEquipmentImages(workbook: XLSX.WorkBook, records: EntityRecord[]) {
  const chunks: { equipo_id: string; campo: string; parte: number; total: number; contenido: string }[] = [];
  const rows = records.map(record => {
    const row = { ...record };
    for (const field of equipmentImageFields) {
      const value = row[field]; if (!value) continue;
      if (isEquipmentImageReference(value)) throw new Error('Falta descargar una imagen del equipo. Intenta exportar nuevamente.');
      if (typeof value !== 'string' || !validEquipmentImage(value)) throw new Error('Hay una imagen de equipo inválida.');
      const total = Math.ceil(value.length / chunkSize);
      for (let part = 0; part < total; part++) chunks.push({ equipo_id: row.id, campo: field, parte: part + 1, total, contenido: value.slice(part * chunkSize, (part + 1) * chunkSize) });
      row[field] = marker(field);
    }
    return row;
  });
  if (chunks.length) {
    const sheet = XLSX.utils.json_to_sheet(chunks); sheet['!cols'] = [{wch:38}, {wch:20}, {wch:8}, {wch:8}, {wch:50}];
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  }
  return rows;
}
export function restoreEquipmentImages(workbook: XLSX.WorkBook, records: EntityRecord[]) {
  const sheet = workbook.Sheets[sheetName];
  const chunks = sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {raw:true,defval:''}) : [];
  const byId = new Map(records.map(row => [row.id, row]));
  const groups = new Map<string, { row: EntityRecord; field: EquipmentImageField; total: number; parts: Map<number, string> }>();
  for (const chunk of chunks) {
    const row = byId.get(String(chunk.equipo_id)); const field = chunk.campo as EquipmentImageField; const total = Number(chunk.total); const part = Number(chunk.parte);
    if (!row || !equipmentImageFields.includes(field) || row[field] !== marker(field) || !Number.isInteger(total) || total < 1 || total > Math.ceil(MAX_EQUIPMENT_IMAGE_LENGTH / chunkSize) || !Number.isInteger(part) || part < 1 || part > total || typeof chunk.contenido !== 'string' || !chunk.contenido || chunk.contenido.length > chunkSize) throw new Error('El respaldo contiene fragmentos de imagen inválidos.');
    const key = `${row.id}:${field}`; const group = groups.get(key) ?? {row,field,total,parts:new Map<number,string>()};
    if (group.total !== total || group.parts.has(part)) throw new Error('El respaldo contiene partes de imagen repetidas o inconsistentes.');
    group.parts.set(part,chunk.contenido); groups.set(key,group);
  }
  for (const group of groups.values()) {
    if (group.parts.size !== group.total) throw new Error('Faltan partes de una fotografía en el respaldo.');
    const value = Array.from({length:group.total},(_,i) => group.parts.get(i+1)).join('');
    if (!validEquipmentImage(value)) throw new Error('No se pudo recuperar una fotografía del respaldo.');
    group.row[group.field] = value;
  }
  for (const row of records) for (const field of equipmentImageFields) if (row[field] === marker(field) || isEquipmentImageReference(row[field])) throw new Error('El respaldo no incluye el archivo de una fotografía del equipo.');
}
