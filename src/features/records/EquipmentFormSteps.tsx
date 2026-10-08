import type { KeyboardEvent } from 'react';
import { equipmentSpecGroups } from './EquipmentSpecField';

type EquipmentFormStep = {
  id: string;
  label: string;
  description: string;
  groups: { title: string; fields: string[] }[];
  images?: 'reference' | 'views';
};

export const equipmentFormSteps: EquipmentFormStep[] = [
  { id: 'identificacion', label: 'Identificación', description: 'Empieza con los datos que identifican al equipo.', groups: [
    { title: 'Identificación', fields: ['propiedad', 'marca', 'modelo', 'serie', 'id_interno_cliente', 'tipo', 'anio'] },
  ] },
  { id: 'estado', label: 'Estado y mantenimiento', description: 'Indica su condición actual y si tiene mantenimiento pendiente.', groups: [
    { title: 'Estado y mantenimiento', fields: ['estado_operativo', 'estado_mantenimiento', 'motivo_estado'] },
  ] },
  { id: 'asignacion', label: 'Asignación y horómetro', description: 'Relaciona el equipo con su cliente y sede. La lectura es opcional si aún no la tienes.', groups: [
    { title: 'Asignación y horómetro', fields: ['estado_administrativo', 'cliente_id', 'sede_id', 'horometro'] },
  ] },
  { id: 'medidas', label: 'Capacidad y medidas', description: 'Completa las medidas que conozcas; puedes agregar las demás después.', groups: [equipmentSpecGroups[0]] },
  { id: 'energia', label: 'Energía y llantas', description: 'Registra la alimentación, las llantas y cualquier observación adicional.', groups: [
    ...equipmentSpecGroups.slice(1), { title: 'Observaciones', fields: ['notas'] },
  ] },
  { id: 'referencia', label: 'Imagen y placa', description: 'Opcional. Agrega la imagen de referencia y la placa de datos cuando las tengas.', groups: [], images: 'reference' },
  { id: 'fotografias', label: 'Fotografías', description: 'Opcional. Documenta las cuatro vistas del equipo real, sus aditamentos y daños.', groups: [], images: 'views' },
];

export function EquipmentFormTabs({ active, disabled, onChange }: { active: number; disabled: boolean; onChange: (step: number) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % equipmentFormSteps.length
      : event.key === 'ArrowLeft' ? (index + equipmentFormSteps.length - 1) % equipmentFormSteps.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? equipmentFormSteps.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); onChange(next);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return <div className="equipment-form-tabs" role="tablist" aria-label="Secciones del equipo">
    {equipmentFormSteps.map((step, index) => <button key={step.id} id={`equipment-tab-${step.id}`} type="button" role="tab" aria-selected={active === index} aria-controls={`equipment-panel-${step.id}`} tabIndex={active === index ? 0 : -1} disabled={disabled} onClick={() => onChange(index)} onKeyDown={event => onKeyDown(event, index)}>
      <span aria-hidden="true">{index + 1}</span>{step.label}
    </button>)}
  </div>;
}

/** Check mounted controls, including other tabs, before revealing and focusing an error. */
export function firstInvalidEquipmentControl(root: ParentNode) {
  return Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))
    .find(control => control.willValidate && !control.validity.valid);
}
