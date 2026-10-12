import { createHash } from 'node:crypto';
import { equipmentImageFields, isEquipmentImageReference, validEquipmentImage, ValidationError } from './generated/domain.mjs';

/** @param {string} value */
export const imageReference = value => `media:${createHash('sha256').update(value).digest('hex')}`;
/** @param {import("../src/domain/model.js").EntityRecord} row */
export function presentEquipment(row) {
  const result = { ...row };
  for (const field of equipmentImageFields) if (typeof result[field] === 'string' && result[field].startsWith('data:')) result[field] = imageReference(result[field]);
  return result;
}
// Las respuestas normales llevan referencias pequeñas. El archivo se sirve
// aparte, con la misma sesión y permisos de lectura del equipo.
/** @param {import("../src/domain/model.js").Database} db */
export function presentDatabase(db) {
  return { ...db, entities: { ...db.entities, Equipo: db.entities.Equipo.map(presentEquipment) } };
}
/** @param {import("../src/domain/model.js").Database} next @param {import("../src/domain/model.js").Database} previous */
export function resolveEquipmentImages(next, previous) {
  const old = new Map(previous.entities.Equipo.map(row => [row.id, row]));
  for (const row of next.entities.Equipo) for (const field of equipmentImageFields) {
    const value = row[field];
    if (isEquipmentImageReference(value)) {
      const original = old.get(row.id)?.[field];
      if (typeof original !== 'string' || !original || imageReference(original) !== value) throw new ValidationError('La imagen del equipo cambió o no está disponible. Recarga antes de guardar.');
      row[field] = original;
    }
    if (!validEquipmentImage(row[field])) throw new ValidationError('La fotografía del equipo no es válida.');
  }
}
/** @param {import("../src/domain/model.js").EntityRecord|undefined} row @param {string} field @param {string} hash */
export function readEquipmentImage(row, field, hash) {
  if (!equipmentImageFields.some(candidate=>candidate===field)) return null;
  const value = row?.[field];
  if (typeof value !== 'string' || !value.startsWith('data:') || !validEquipmentImage(value) || imageReference(value) !== `media:${hash}`) return null;
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,(.*)$/);
  return match ? { type: match[1], bytes: Buffer.from(match[2], 'base64') } : null;
}
