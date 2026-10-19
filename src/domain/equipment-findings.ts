import type { EntityRecord } from './model';
import { isCompletedService } from './vocabulary';

export const findingStates = ['Por confirmar', 'Abierto', 'Cotizado', 'Aprobado', 'Programado', 'Resuelto', 'Descartado'] as const;
export const findingPriorities = ['Por definir', 'Baja', 'Media', 'Alta', 'Crítica'] as const;
export const findingComponents = ['Por clasificar', 'Batería', 'Sistema eléctrico', 'Motor', 'Hidráulico', 'Torre y cadenas', 'Cuchillas y aditamentos', 'Frenos', 'Llantas y rodos', 'Estructura', 'Otro'] as const;
export const findingClosed = (row: Record<string, unknown>) => ['Resuelto', 'Descartado'].includes(String(row.estado));
export const completedService = (row: EntityRecord) => isCompletedService(row);

export function recommendationReports(reports: EntityRecord[], equipmentId: string) {
  return reports.filter(row => row.equipo_id === equipmentId && typeof row.notas_seguridad === 'string' && row.notas_seguridad.trim())
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}
export function findingSummary(rows: EntityRecord[], equipmentId: string) {
  const own = rows.filter(row => row.equipo_id === equipmentId);
  const active = own.filter(row => !findingClosed(row) && row.estado !== 'Por confirmar');
  return { total: own.length, pending: own.filter(row => row.estado === 'Por confirmar').length, active: active.length, critical: active.filter(row => row.prioridad === 'Crítica').length, closed: own.filter(findingClosed).length };
}

export function findingLinkErrors(row: EntityRecord, equipment: Map<string, EntityRecord>, orders: Map<string, EntityRecord>) {
  const errors: string[] = [];
  if (!equipment.has(String(row.equipo_id))) errors.push('Selecciona un equipo existente.');
  for (const [key, label] of [['orden_origen_id', 'El reporte de origen'], ['orden_resolucion_id', 'El reporte de resolución']]) {
    if (row[key] && orders.get(String(row[key]))?.equipo_id !== row.equipo_id) errors.push(`${label} no corresponde al equipo.`);
  }
  const origin = orders.get(String(row.orden_origen_id));
  const resolution = orders.get(String(row.orden_resolucion_id));
  if (row.estado === 'Resuelto') {
    if (!resolution || !completedService(resolution)) errors.push('Para resolver, vincula un servicio reportado como completado.');
    if (origin && resolution && Date.parse(String(resolution.fecha)) < Date.parse(String(origin.fecha))) errors.push('La resolución no puede ser anterior al reporte de origen.');
  }
  return errors;
}

/** Add only the new collection at legacy JSON boundaries; never replace existing rows. */
export function upgradeFindingCollection(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1 || !('entities' in value)) return value;
  const entities = value.entities;
  if (!entities || typeof entities !== 'object' || Array.isArray(entities)) return value;
  return { ...value, entities: { Hallazgo: [], LecturaEnviada: [], ...entities } };
}
