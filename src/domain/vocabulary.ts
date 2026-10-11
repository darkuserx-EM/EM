/**
 * Single source for service vocabulary. Imported AppSheet reports and portal orders
 * use different spellings ("Completado" / "Completada", "Mantenimiento Mayor" /
 * "Mantenimiento mayor"); every screen and rule must classify them the same way.
 */
const key = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');

export const serviceKinds = ['Preventivo', 'Mayor', 'Correctivo', 'Emergencia', 'Inspección', 'Otro'] as const;
export type ServiceKind = typeof serviceKinds[number];
const kindAliases: Record<string, ServiceKind> = {
  'preventivo': 'Preventivo', 'mantenimiento preventivo': 'Preventivo',
  'mayor': 'Mayor', 'mantenimiento mayor': 'Mayor',
  'correctivo': 'Correctivo',
  'emergencia': 'Emergencia',
  'inspeccion': 'Inspección',
};
/** Service type of an order or report; unknown or empty types are "Otro", never guessed. */
export const serviceKind = (row: Record<string, unknown>): ServiceKind => kindAliases[key(row.tipo)] ?? 'Otro';

const completedStates = new Set(['completada', 'completado', 'completado con observaciones', 'cerrada', 'cerrado', 'finalizada', 'finalizado']);
/** The service was reported as finished. Pending, draft or cancelled records are not completed. */
export const isCompletedService = (row: Record<string, unknown>) => completedStates.has(key(row.estado));
