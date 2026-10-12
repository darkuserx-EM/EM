import type { EntityRecord } from './model';

export const equipmentViewFields = ['foto_frontal', 'foto_trasera', 'foto_lateral_1', 'foto_lateral_2'] as const;
export const equipmentReferenceFields = ['foto_equipo', 'placa_datos'] as const;
export const equipmentImageFields = [...equipmentReferenceFields, ...equipmentViewFields] as const;
export type EquipmentImageField = typeof equipmentImageFields[number];
export const equipmentImageLabels: Record<EquipmentImageField, string> = {
  foto_equipo: 'Imagen de referencia del equipo', placa_datos: 'Placa de datos',
  foto_frontal: 'Foto frontal', foto_trasera: 'Foto trasera', foto_lateral_1: 'Foto lateral 1', foto_lateral_2: 'Foto lateral 2',
};
export const MAX_EQUIPMENT_IMAGE_LENGTH = 3500000;
export const isEquipmentImageReference = (value: unknown): value is `media:${string}` => typeof value === 'string' && /^media:[a-f0-9]{64}$/.test(value);
export function validEquipmentImage(value: unknown): boolean {
  if (value === '' || value === undefined || value === null || isEquipmentImageReference(value)) return true;
  if (typeof value !== 'string' || value.length > MAX_EQUIPMENT_IMAGE_LENGTH) return false;
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return false;
  try {
    const raw = atob(match[2]);
    if (btoa(raw) !== match[2]) return false;
    if (match[1] === 'png') return raw.startsWith('\x89PNG\r\n\x1a\n');
    if (match[1] === 'jpeg') return raw.startsWith('\xff\xd8\xff');
    return raw.startsWith('RIFF') && raw.slice(8,12) === 'WEBP';
  } catch { return false; }
}
export function equipmentImageSource(row: Partial<EntityRecord>, field: EquipmentImageField, preview = false) {
  const value = row[field];
  if (!value || !validEquipmentImage(value)) return '';
  if (isEquipmentImageReference(value)) return row.id ? `/api/equipment-images/${encodeURIComponent(row.id)}/${field}/${value.slice(6)}${preview ? '?preview=1' : ''}` : '';
  return String(value);
}
