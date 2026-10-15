import { Badge, type BadgeTone } from '../../components/design-system';

/** Tono del estado de órdenes y solicitudes: listo en verde, programado o en curso en azul, en espera o en revisión en ámbar. */
export const operationTone = (state: string): BadgeTone => ['Completada', 'Resuelto', 'Finalizado'].includes(state) ? 'success' : ['En proceso', 'Programada', 'Programado'].includes(state) ? 'info' : ['En espera', 'En revisión'].includes(state) ? 'warning' : 'neutral';

export function OperationStatus({ value }: { value: unknown }) {
  const state = String(value || 'Sin estado');
  return <Badge tone={operationTone(state)}>{state}</Badge>;
}
