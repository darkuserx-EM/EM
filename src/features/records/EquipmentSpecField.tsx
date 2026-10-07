import { useState } from 'react';
import { equipmentVoltages, forkLengths, fuelOptions, inchesToMeters, liftHeights, loadRollerSizes, measurementLabel } from '../../domain/equipment-specifications';
import './equipment-specifications.css';

export const equipmentSpecGroups = [
  { title: 'Capacidad y medidas', fields: ['capacidad_lb', 'altura_elevacion_in', 'altura_torre_in', 'largo_cuchillas_in'] },
  { title: 'Energía', fields: ['combustible', 'cargador', 'voltaje', 'bateria'] },
  { title: 'Llantas y rodos', fields: ['llantas_delanteras', 'llantas_traseras', 'caster'] },
];
export const equipmentSpecKeys = equipmentSpecGroups.flatMap(group => group.fields);
const labels: Record<string, string> = {
  capacidad_lb: 'Capacidad (lb)', altura_elevacion_in: 'Altura de elevación', altura_torre_in: 'Altura de torre bajada', largo_cuchillas_in: 'Largo de cuchillas',
  combustible: 'Combustible / energía', voltaje: 'Voltaje (V)', bateria: 'Batería (serie)', cargador: 'Cargador',
  llantas_delanteras: 'Llantas delanteras / rodos de carga', llantas_traseras: 'Llantas traseras / tracción (giro)', caster: 'Caster (opcional)',
};

export function EquipmentSpecField({ field, value, disabled, onChange }: { field: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const numeric = ['capacidad_lb', 'altura_elevacion_in', 'altura_torre_in', 'largo_cuchillas_in', 'voltaje'].includes(field);
  const isLength = ['altura_elevacion_in', 'altura_torre_in', 'largo_cuchillas_in'].includes(field);
  const choices = field === 'altura_elevacion_in' ? liftHeights.map(String) : field === 'largo_cuchillas_in' ? forkLengths.map(String) : field === 'voltaje' ? equipmentVoltages.map(String) : field === 'combustible' ? fuelOptions : field === 'llantas_delanteras' ? loadRollerSizes.map(size => `${size}″`) : field === 'caster' ? ['No aplica'] : null;
  const [custom, setCustom] = useState(!!choices && !!value && !choices.includes(value));
  const id = `record-${field}`;
  const input = (customInput = false) => <input id={customInput ? `${id}-custom` : id} aria-label={customInput ? `${labels[field]}: otra medida o especificación` : undefined} disabled={disabled} value={value} type={numeric ? 'number' : 'text'} min={numeric ? 0 : undefined} step={numeric ? 'any' : undefined} maxLength={numeric ? undefined : 500} placeholder={isLength ? 'Pulgadas' : field === 'bateria' ? 'Número de serie' : field === 'llantas_traseras' ? 'Medida / tipo de llanta' : field === 'caster' ? 'Medida / tipo de caster' : undefined} onChange={event => onChange(event.target.value)} />;
  return <div className={`record-field equipment-spec-field ${field === 'caster' ? 'record-field-wide' : ''}`}>
    <label htmlFor={id}>{labels[field]}{isLength && <span className="equipment-unit-label"> · pulgadas</span>}</label>
    <div className={isLength ? 'equipment-measurement' : undefined}>
      <div className="equipment-spec-controls">
        {choices ? <select id={id} disabled={disabled} value={custom ? '__custom' : value} onChange={event => { const next = event.target.value; setCustom(next === '__custom'); if (next !== '__custom') onChange(next); else if (choices.includes(value)) onChange(''); }}>
          <option value="">{field === 'caster' ? 'Sin especificar' : 'Selecciona una opción'}</option>
          {choices.map(choice => <option key={choice} value={choice}>{isLength ? measurementLabel(Number(choice)) : field === 'voltaje' ? `${choice} V` : choice}</option>)}
          <option value="__custom">{field === 'caster' ? 'Sí, especificar caster' : numeric || field === 'llantas_delanteras' ? 'Otra medida…' : 'Otra opción…'}</option>
        </select> : input()}
        {choices && custom && input(true)}
      </div>
      {isLength && <output className="equipment-metric" aria-live="polite" htmlFor={custom ? `${id}-custom` : id}>{value !== '' && Number.isFinite(Number(value)) ? `${inchesToMeters(Number(value)).toFixed(3)} m` : '— m'}</output>}
    </div>
    {field === 'altura_torre_in' && <small>Con el mástil completamente bajado, para verificar accesos.</small>}
    {field === 'llantas_delanteras' && <small>Medidas de rodos en pulgadas. Usa “Otra medida” para otras llantas.</small>}
    {field === 'llantas_traseras' && <small>Registra la medida que corresponda al modelo.</small>}
    {field === 'caster' && <small>Selecciona “No aplica” si el equipo no utiliza caster.</small>}
  </div>;
}
