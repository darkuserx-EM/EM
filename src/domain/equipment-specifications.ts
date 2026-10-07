import type { EntityRecord, Scalar } from './model';

// Medidas proporcionadas por EMSA; no se asignan automáticamente a una marca o modelo.
export const liftHeights = [192, 195, 210, 240, 270, 276, 294, 300, 312, 321, 330, 341, 348, 366, 384, 400, 402];
export const forkLengths = [30, 36, 39, 42, 45, 48];
export const equipmentVoltages = [12, 24, 36, 48];
export const fuelOptions = ['Eléctrico', 'Diésel', 'Gas', 'Dual'];
export const loadRollerSizes = ['4 × 4.1', '5 × 2.9', '5 × 4.1', '6 × 2.9', '6 × 4.1'];
export const inchesToMeters = (inches: number) => inches * 0.0254;
export const poundsToKilograms = (pounds: number) => pounds * 0.45359237;
const present = (value: unknown) => value !== undefined && value !== null && value !== '';
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function capacityPounds(row: Partial<EntityRecord>) {
  return numeric(row.capacidad_lb) ? row.capacidad_lb : numeric(row.capacidad_kg) ? row.capacidad_kg / 0.45359237 : null;
}
export function liftInches(row: Partial<EntityRecord>) {
  return numeric(row.altura_elevacion_in) ? row.altura_elevacion_in : numeric(row.altura_elevacion_m) ? row.altura_elevacion_m / 0.0254 : null;
}
export function measurementLabel(inches: number) {
  return `${Number(inches.toFixed(6))}″ · ${inchesToMeters(inches).toFixed(3)} m`;
}
export function equipmentFormValues(row?: EntityRecord): Record<string, string> {
  if (!row) return { largo_cuchillas_in: '42' };
  const capacity = capacityPounds(row); const lift = liftInches(row);
  return {
    capacidad_lb: capacity === null ? '' : String(Number(capacity.toFixed(6))),
    altura_elevacion_in: lift === null ? '' : String(Number(lift.toFixed(6))),
  };
}

// Conserva compatibilidad con respaldos y clientes anteriores. La unidad recibida
// actualiza ambas representaciones, incluso al borrar un valor opcional.
export function synchronizeEquipmentUnits(fields: Record<string, Scalar>) {
  const result = { ...fields };
  for (const [primary, legacy, factor] of [
    ['capacidad_lb', 'capacidad_kg', 0.45359237],
    ['altura_elevacion_in', 'altura_elevacion_m', 0.0254],
  ] as const) {
    if (primary in fields) {
      if (!present(fields[primary])) result[legacy] = null;
      else if (numeric(fields[primary])) result[legacy] = fields[primary] * factor;
    } else if (legacy in fields) {
      if (!present(fields[legacy])) result[primary] = null;
      else if (numeric(fields[legacy])) result[primary] = fields[legacy] / factor;
    }
  }
  return result;
}

export function equipmentSpecificationDetails(row: EntityRecord): [string, Scalar | undefined][] {
  const capacity = capacityPounds(row); const lift = liftInches(row);
  return [
    ['Capacidad', capacity === null ? null : `${capacity.toLocaleString('es-GT', { maximumFractionDigits: 2 })} lb`],
    ['Altura de elevación', lift === null ? null : measurementLabel(lift)],
    ['Altura de torre bajada', numeric(row.altura_torre_in) ? measurementLabel(row.altura_torre_in) : null],
    ['Largo de cuchillas', numeric(row.largo_cuchillas_in) ? measurementLabel(row.largo_cuchillas_in) : null],
    ['Voltaje', present(row.voltaje) ? `${row.voltaje} V` : null],
    ['Batería (serie)', row.bateria], ['Cargador', row.cargador], ['Combustible', row.combustible],
    ['Llantas delanteras / rodos de carga', row.llantas_delanteras],
    ['Llantas traseras / tracción (giro)', row.llantas_traseras],
    ['Caster', row.caster], ['Llantas: dato anterior', row.llantas],
  ];
}
