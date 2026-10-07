import type { Database, EntityRecord } from './model';

export const clientSectors = ['Farmacéutica', 'Alimentos y bebidas', 'Logística y almacenamiento', 'Comercio y distribución', 'Manufactura', 'Construcción', 'Agricultura', 'Editorial e impresión', 'Servicios', 'Otros'];
export const MAX_CLIENT_LOGO_LENGTH = 24000; // Fits in one Excel backup cell, including the data URL prefix.
export function clientDisplayName(client?: EntityRecord) { return String(client?.nombre_comercial || client?.nombre || 'Sin cliente'); }
export function addClientSectors(database: Database): boolean {
  if (database.entities.Catalogos.some(row => row.categoria === 'Sectores / actividades')) return false;
  let next = database.entities.Catalogos.reduce((max,row) => Math.max(max,Number(row.codigo.match(/^CAT-(\d+)$/)?.[1] || 0)),0);
  const now = new Date().toISOString();
  for (const nombre of clientSectors) database.entities.Catalogos.push({id:crypto.randomUUID(),codigo:`CAT-${String(++next).padStart(3,'0')}`,creado_por:'sistema',actualizado_por:'sistema',fecha_creacion:now,fecha_actualizacion:now,categoria:'Sectores / actividades',nombre,activo:true});
  return true;
}
export function validClientLogo(value: unknown): boolean {
  if (value === '' || value === undefined || value === null) return true;
  if (typeof value !== 'string' || value.length > MAX_CLIENT_LOGO_LENGTH) return false;
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
