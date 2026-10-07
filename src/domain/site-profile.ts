import type { EntityRecord } from './model';

// Instituto Nacional de Estadística: https://www.ine.gob.gt/perfil_estadistico/
export const departments = ['Guatemala', 'Alta Verapaz', 'Baja Verapaz', 'Chimaltenango', 'Chiquimula', 'El Progreso', 'Escuintla', 'Huehuetenango', 'Izabal', 'Jalapa', 'Jutiapa', 'Petén', 'Quetzaltenango', 'Quiché', 'Retalhuleu', 'Sacatepéquez', 'San Marcos', 'Santa Rosa', 'Sololá', 'Suchitepéquez', 'Totonicapán', 'Zacapa'];

export function siteContactError(site: Record<string, unknown>, contacts: EntityRecord[]): string | null {
  if (!site.autoriza_contacto_id) return null;
  const contact = contacts.find(row => row.id === site.autoriza_contacto_id);
  return !contact || contact.cliente_id !== site.cliente_id ? 'El contacto que autoriza el ingreso debe pertenecer al mismo cliente de la sede.' : null;
}
