import type { EquipmentHistory, UsageReading } from './equipment-history';
import { isCompletedService, serviceKind, type ServiceKind } from './vocabulary';

export function summarizeEquipment(history: EquipmentHistory) {
  const count = (kind: ServiceKind) => history.repairs.filter(row => serviceKind(row) === kind).length;
  const serviceTypes = [
    { label: 'Preventivos', count: count('Preventivo') },
    { label: 'Correctivos', count: count('Correctivo') },
    { label: 'Mayores', count: count('Mayor') },
    { label: 'Emergencias', count: count('Emergencia') },
  ];
  // Optional groups appear only when they have records.
  if (count('Inspección')) serviceTypes.push({ label: 'Inspecciones', count: count('Inspección') });
  if (count('Otro')) serviceTypes.push({ label: 'Otros', count: count('Otro') });
  // Historical status is not evidence that a fault is still open today.
  const pendingReports = history.repairs.filter(row => row.importado === true && row.estado === 'Pendiente').length;
  const completed = history.repairs.filter(isCompletedService);
  return {
    serviceTypes,
    pendingReports,
    estimatedReadings: history.usage.filter(item => item.row.es_estimado === true).length,
    lastPreventive: completed.find(row => serviceKind(row) === 'Preventivo'),
    lastMajor: completed.find(row => serviceKind(row) === 'Mayor'),
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
