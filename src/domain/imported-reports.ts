import type { EntityRecord } from './model';

/**
 * Corrección de un reporte histórico importado de AppSheet, solo por administración y con motivo:
 * - «anular»: el reporte no corresponde a ningún equipo de este cliente en el portal (por ejemplo, quedó registrado
 *   en la máquina equivocada y la correcta no está en el portal). Sale del historial activo con sus lecturas de importación.
 * - «reasignar»: el reporte es de otro equipo del mismo cliente; se mueve con sus lecturas.
 * Las copias íntegras de antes del cambio quedan en la bitácora.
 */
export interface ImportedReportRevision { orden_id: string; accion: 'anular' | 'reasignar'; equipo_id?: string; motivo: string }

/** Lecturas que creó la importación histórica (las conservadas de otro origen solo se desvinculan). */
export const createdByHistoricalImport = (reading: EntityRecord) => reading.registrado_por === 'Importación histórica AppSheet';

/** Equipos a los que se puede mover un reporte importado: del mismo cliente, activos o no, distintos del actual. */
export function reassignableEquipment(order: EntityRecord, equipment: EntityRecord[]) {
  return equipment.filter(row => row.id !== order.equipo_id && !!order.cliente_id && row.cliente_id === order.cliente_id);
}
