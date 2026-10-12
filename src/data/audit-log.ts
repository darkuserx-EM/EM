import type { EntityRecord } from '../domain/model';
export type AuditQuery = { entity?: string; equipo_id?: string; hallazgo_id?: string; action?: string; from?: string; to?: string; cursor?: string; limit?: number };
export type AuditPage = { rows: EntityRecord[]; nextCursor: string | null };
export function localAuditPage(rows: EntityRecord[], query: AuditQuery): AuditPage {
  const cursor = query.cursor ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(query.cursor),c=>c.charCodeAt(0)))) as [string,string] : null;
  const selected = rows.filter(row => (!query.entity || row.entidad === query.entity) && (!query.equipo_id || row.equipo_id === query.equipo_id) && (!query.hallazgo_id || row.hallazgo_id === query.hallazgo_id) && (!query.action || row.accion === query.action) && (!query.from || row.fecha_creacion >= `${query.from}T06:00:00.000Z`) && (!query.to || Date.parse(row.fecha_creacion) < Date.parse(`${query.to}T06:00:00Z`) + 86400000) && (!cursor || row.fecha_creacion < cursor[0] || row.fecha_creacion === cursor[0] && row.id < cursor[1])).sort((a,b) => a.fecha_creacion === b.fecha_creacion ? (a.id>b.id?-1:a.id<b.id?1:0) : a.fecha_creacion>b.fecha_creacion?-1:1);
  const page = selected.slice(0,query.limit || 50), last = page.at(-1);
  return {rows:structuredClone(page),nextCursor:selected.length>page.length && last ? btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify([last.fecha_creacion,last.id])))) : null};
}
