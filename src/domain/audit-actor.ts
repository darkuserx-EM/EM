import type { Actor, EntityRecord } from './model';
export type AuditAccount = { id: string; name: string; role: string };
export function auditActorLabel(row: EntityRecord, accounts: AuditAccount[], current: Actor): string {
  const account = accounts.find(user => user.id === row.creado_por);
  const name = row.registrado_por || account?.name || (row.creado_por === current.id ? current.nombre : 'Cuenta no disponible');
  const role = row.registrado_rol || account?.role || (row.creado_por === current.id ? current.rol : '');
  return `${name}${role ? ` · ${role}` : ''}`;
}
