import type { EquipmentHistory, UsageReading } from './equipment-history';

export function summarizeEquipment(history: EquipmentHistory) {
  const groups = [
    { label: 'Preventivos', types: ['Preventivo', 'Mantenimiento Preventivo'] },
    { label: 'Correctivos', types: ['Correctivo'] },
    { label: 'Mayores', types: ['Mantenimiento Mayor'] },
    { label: 'Emergencias', types: ['Emergencia'] },
  ];
  const known = new Set(groups.flatMap(group => group.types));
  const serviceTypes = groups.map(group => ({ label: group.label, count: history.repairs.filter(row => group.types.includes(String(row.tipo))).length }));
  const others = history.repairs.filter(row => !known.has(String(row.tipo))).length;
  if (others) serviceTypes.push({ label: 'Otros', count: others });
  // Historical status is not evidence that a fault is still open today.
  const pendingReports = history.repairs.filter(row => row.importado === true && row.estado === 'Pendiente').length;
  const completed = history.repairs.filter(row => row.estado === 'Completado' || row.estado === 'Completado con observaciones');
  return {
    serviceTypes,
    pendingReports,
    estimatedReadings: history.usage.filter(item => item.row.es_estimado === true).length,
    lastPreventive: completed.find(row => ['Preventivo', 'Mantenimiento Preventivo'].includes(String(row.tipo))),
    lastMajor: completed.find(row => row.tipo === 'Mantenimiento Mayor'),
  };
}

/** Connect only comparable readings; a reset/correction must leave a gap. */
export function meterSegments(readings: UsageReading[]) {
  return readings.flatMap((current, index) => {
    const previous = readings[index - 1];
    if (!previous || current.previous?.id !== previous.row.id || current.delta === null) return [];
    return [{ from: index - 1, to: index, estimated: current.estimated }];
  });
}
