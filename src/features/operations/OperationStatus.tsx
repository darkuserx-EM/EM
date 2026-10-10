export function OperationStatus({ value }: { value: unknown }) {
  const state = String(value || 'Sin estado');
  const tone = ['Completada', 'Resuelto', 'Finalizado'].includes(state) ? 'success' : ['En proceso', 'Programada', 'Programado'].includes(state) ? 'progress' : ['En espera', 'En revisión'].includes(state) ? 'attention' : 'neutral';
  return <span className={`os-status ${tone}`}>{state}</span>;
}
