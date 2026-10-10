import type { EntityRecord, Scalar } from './model';
import { localDay } from './equipment-history';
import { completedService } from './equipment-findings';

export const planTypes = ['Preventivo', 'Mayor'] as const;
export const planIntervalLimits = { Horas: 20000, 'Días': 3650 } as const;
export const planMetadata = ['version', 'vigente', 'anterior_id', 'confirmado_por', 'confirmado_el', 'vigente_desde'] as const;
export const todayGT = () => localDay(new Date().toISOString());
export const validDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const dayGap = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export const addDays = (day: string, days: number) => new Date(Date.parse(day) + days * 86400000).toISOString().slice(0, 10);
export const currentPlan = (plans: EntityRecord[], equipmentId: string, type: string) => plans.find(row => row.schema_plan === 1 && row.vigente === true && row.equipo_id === equipmentId && row.tipo_plan === type);
export const planService = (row: EntityRecord, equipmentId: string, type: string) => row.equipo_id === equipmentId && completedService(row) && (type === 'Mayor' ? ['Mantenimiento Mayor', 'Mantenimiento mayor'].includes(String(row.tipo)) : ['Preventivo', 'Mantenimiento Preventivo', 'Mantenimiento preventivo'].includes(String(row.tipo)));

export function planFieldErrors(row: Record<string, unknown>) {
  if (row.schema_plan === undefined) return []; // Preserve legacy, unconfigured records.
  const errors: string[] = [];
  if (row.schema_plan !== 1) errors.push('Versión de plan no compatible.');
  if (!planTypes.includes(row.tipo_plan as typeof planTypes[number])) errors.push('Selecciona preventivo o mayor.');
  if (!['Horas', 'Días'].includes(String(row.criterio))) errors.push('Selecciona horas o días.');
  if (!['Activo', 'Pausado'].includes(String(row.estado_plan))) errors.push('Estado del plan inválido.');
  const maximum = row.criterio === 'Días' ? planIntervalLimits['Días'] : planIntervalLimits.Horas;
  if (typeof row.intervalo !== 'number' || !Number.isInteger(row.intervalo) || row.intervalo < 1 || row.intervalo > maximum) errors.push(`Indica un intervalo entero entre 1 y ${maximum.toLocaleString('es-GT')} ${row.criterio === 'Días' ? 'días' : 'horas'}.`);
  if (row.tipo_plan === 'Mayor' && row.criterio !== 'Horas') errors.push('El ciclo de mantenimiento mayor se configura por horas.');
  if (!String(row.motivo || '').trim()) errors.push('Indica el motivo de esta configuración.');
  if (!['Pendiente', 'Servicio', 'Base inicial'].includes(String(row.base_origen))) errors.push('Selecciona el origen de la base.');
  if (row.base_origen === 'Pendiente') {
    if (row.base_fecha || typeof row.base_horas === 'number' || row.base_orden_id || row.base_confirmada === true) errors.push('Una base pendiente no debe contener valores confirmados.');
  } else {
    if (!validDay(row.base_fecha)) errors.push('Indica una fecha base válida.');
    if (row.base_confirmada !== true) errors.push('Confirma la base revisada antes de guardar.');
    if (!['Registrada', 'Estimada'].includes(String(row.base_calidad))) errors.push('Indica si la base es registrada o estimada.');
    if (row.criterio === 'Horas' && (typeof row.base_horas !== 'number' || !Number.isFinite(row.base_horas) || row.base_horas < 0)) errors.push('Indica las horas base, sin suponer cero.');
  }
  if (row.base_origen === 'Base inicial' && row.base_orden_id) errors.push('Una base inicial no debe vincular un reporte.');
  if (row.version !== undefined && (!Number.isInteger(row.version) || Number(row.version) < 1)) errors.push('Versión correlativa inválida.');
  if (row.vigente_desde !== undefined && (!validDay(row.vigente_desde) || (validDay(row.base_fecha) && row.base_fecha > String(row.vigente_desde)))) errors.push('La base no puede ser posterior a la confirmación del plan.');
  return errors;
}

export function planLinkErrors(row: EntityRecord, equipment: Map<string, EntityRecord>, orders: Map<string, EntityRecord>) {
  if (row.schema_plan !== 1) return [];
  const errors: string[] = [];
  if (!Number.isInteger(row.version) || Number(row.version) < 1 || typeof row.vigente !== 'boolean') errors.push('Falta una versión y vigencia válidas del plan.');
  if (!String(row.confirmado_por || '').trim() || !validDay(row.vigente_desde) || !/^\d{4}-\d{2}-\d{2}T/.test(String(row.confirmado_el)) || !Number.isFinite(Date.parse(String(row.confirmado_el)))) errors.push('Falta la autoría y fecha de confirmación del plan.');
  if ((row.version === 1 && row.anterior_id) || (Number(row.version) > 1 && !row.anterior_id)) errors.push('Conserva el vínculo con la versión anterior del plan.');
  if (!equipment.has(String(row.equipo_id))) errors.push('Selecciona un equipo existente.');
  if (row.base_origen === 'Servicio') {
    const service = orders.get(String(row.base_orden_id));
    if (!service || !planService(service, String(row.equipo_id), String(row.tipo_plan))) errors.push('La base requiere un servicio completado del mismo equipo y tipo de mantenimiento.');
    else {
      if (row.base_fecha !== localDay(String(service.fecha))) errors.push('La fecha base no coincide con el servicio.');
      if (row.criterio === 'Horas' && (typeof service.horometro !== 'number' || row.base_horas !== service.horometro)) errors.push('La lectura base no coincide con el servicio.');
      const quality = row.criterio === 'Horas' && service.horometro_estimado === true ? 'Estimada' : 'Registrada';
      if (row.base_calidad !== quality) errors.push('Conserva la identificación de la base estimada.');
    }
  }
  return errors;
}

export function preparePlan(input: Record<string, Scalar>, services: EntityRecord[], today = todayGT()) {
  const fields = { ...input };
  if (fields.schema_plan !== 1) throw new Error('Usa el formulario de planificación para crear una versión.');
  if (fields.base_origen === 'Servicio') {
    const service = services.find(row => row.id === fields.base_orden_id);
    if (service && planService(service, String(fields.equipo_id), String(fields.tipo_plan))) {
      fields.base_fecha = localDay(String(service.fecha));
      fields.base_horas = fields.criterio === 'Horas' && typeof service.horometro === 'number' ? service.horometro : null;
      fields.base_calidad = fields.criterio === 'Horas' && service.horometro_estimado === true ? 'Estimada' : 'Registrada';
    }
  }
  if (validDay(fields.base_fecha) && fields.base_fecha > today) throw new Error('La base no puede estar en el futuro.');
  return fields;
}

export interface PlanProjection {
  status: string; tone: 'neutral' | 'good' | 'warning' | 'danger'; detail: string;
  target?: number | string; remaining?: number; latest?: number; latestDay?: string; estimated?: boolean;
  forecast?: string; rate?: number;
}
export function projectPlan(plan: EntityRecord | undefined, readings: EntityRecord[], services: EntityRecord[] = [], today = todayGT()): PlanProjection {
  const pending = (status: string, detail: string): PlanProjection => ({ status, detail, tone: 'neutral' });
  if (!plan) return pending('Sin plan', 'Configura el intervalo y confirma desde dónde comienza el conteo.');
  if (plan.estado_plan === 'Pausado') return pending('En pausa', 'La configuración y sus versiones se conservan.');
  if (plan.base_origen === 'Pendiente' || plan.base_confirmada !== true || !validDay(plan.base_fecha)) return pending('Base pendiente', 'Confirma el último mantenimiento o una base inicial para calcular el siguiente.');
  if (plan.base_fecha > today) return pending('Revisar base', 'La fecha base está en el futuro.');
  const interval = Number(plan.intervalo);
  if (plan.criterio === 'Días') {
    const target = addDays(plan.base_fecha, interval); const remaining = dayGap(today, target);
    const estimated = plan.base_calidad === 'Estimada';
    return { target, remaining, estimated, status: estimated ? 'Base estimada' : remaining < 0 ? 'Vencido' : remaining === 0 ? 'Vence hoy' : remaining <= 7 ? 'Por vencer' : 'Al día', tone: estimated ? 'warning' : remaining < 0 ? 'danger' : remaining <= 7 ? 'warning' : 'good', detail: estimated ? 'Fecha orientativa; confirma la base antes de programar como definitivo.' : 'Calculado por días calendario, con fecha local de Guatemala.' };
  }
  if (typeof plan.base_horas !== 'number') return pending('Base pendiente', 'Falta la lectura base.');
  const baseService = services.find(row => row.id === plan.base_orden_id);
  const start = baseService ? Date.parse(String(baseService.fecha)) : Date.parse(`${plan.base_fecha}T00:00:00-06:00`);
  const rows = readings.filter(row => row.equipo_id === plan.equipo_id && typeof row.valor === 'number' && Number.isFinite(Date.parse(String(row.fecha))) && Date.parse(String(row.fecha)) >= start).sort((a, b) => Date.parse(String(a.fecha)) - Date.parse(String(b.fecha)));
  let previous = plan.base_horas; let previousTime: number | undefined;
  for (const row of rows) {
    const time = Date.parse(String(row.fecha));
    if (localDay(String(row.fecha)) > today || Number(row.valor) < previous || (time === previousTime && Number(row.valor) !== previous)) return pending('Revisar lecturas', 'Hay lecturas futuras, simultáneas distintas o una disminución del contador. Confirma una nueva base después de revisar el historial.');
    previous = Number(row.valor); previousTime = time;
  }
  const latest = rows.at(-1); const latestDay = latest ? localDay(String(latest.fecha)) : plan.base_fecha;
  const value = latest ? Number(latest.valor) : plan.base_horas;
  const target = plan.base_horas + interval; const remaining = Math.round((target - value) * 100) / 100;
  const age = dayGap(latestDay, today); const estimated = plan.base_calidad === 'Estimada' || rows.some(row => row.es_estimado === true);
  const result: PlanProjection = { target, remaining, latest: value, latestDay, estimated, status: estimated ? 'Base o lectura estimada' : remaining <= 0 ? 'Vencido' : age > 30 ? 'Actualizar lectura' : remaining <= 25 ? 'Por vencer' : 'Al día', tone: estimated || age > 30 ? 'warning' : remaining <= 0 ? 'danger' : remaining <= 25 ? 'warning' : 'good', detail: `Comparación con ${latest ? 'la lectura' : 'la base confirmada'} del ${latestDay}. ${age > 30 ? 'Han pasado más de 30 días; actualiza la lectura para evaluar el estado actual.' : 'El vencimiento por horas se confirma con una lectura.'}${estimated ? ' Cálculo orientativo con estimaciones; pendiente de confirmar.' : ''}` };
  const recent = [...new Map(rows.filter(row => dayGap(localDay(String(row.fecha)), latestDay) <= 90).map(row => [String(row.fecha), row])).values()];
  const span = recent.length >= 3 ? (Date.parse(String(recent.at(-1)!.fecha)) - Date.parse(String(recent[0].fecha))) / 86400000 : 0;
  const rate = span >= 14 ? (Number(recent.at(-1)!.valor) - Number(recent[0].valor)) / span : 0;
  if (!estimated && age <= 30 && remaining > 0 && rate > 0 && remaining / rate <= 365) {
    result.rate = rate; result.forecast = addDays(latestDay, Math.ceil(remaining / rate));
  }
  return result;
}
