import type { EntityRecord } from '../../domain/model';
import { dateTimeInput, orderNotStarted } from './operations-ui';

export const orderSections = ['Inicio', 'Atención', 'Cierre'] as const;

/**
 * Suggestions only for a new draft: opening a saved order must not rewrite dates.
 * El inicio del trabajo solo se sugiere cuando la orden nace en proceso (el técnico en campo, `startsNow`);
 * un borrador o una visita programada no tiene inicio hasta que se atiende.
 */
export function orderEntryTimes(row?: Partial<EntityRecord>, ticket?: Partial<EntityRecord>, now = new Date(), startsNow = false) {
  const local = dateTimeInput(now.toISOString());
  return {
    fecha_programada: String(row ? row.fecha_programada || '' : ticket?.fecha_programada || local.slice(0, 10)),
    hora_programada: String(row ? row.hora_programada || '' : local.slice(11, 16)),
    fecha: row ? orderNotStarted(row.estado) ? '' : dateTimeInput(row.fecha) : startsNow ? local : '',
  };
}

export function symptomOptions(rows: Partial<EntityRecord>[]) {
  return [...new Set(rows.filter(row => row.categoria === 'Síntomas' && row.activo !== false).map(row => String(row.nombre || '').trim()).filter(Boolean))];
}

/** Never replace the customer's words or silently truncate them. */
export function addSymptom(current: string, symptom: string) {
  if (current.split('\n').some(line => line.trim() === symptom)) return current;
  const next = current ? `${current}\n${symptom}` : symptom;
  if (next.length > 4000) throw new Error('El motivo ya ocupa el espacio disponible. Edita el texto antes de agregar otro síntoma.');
  return next;
}
