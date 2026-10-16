import * as XLSX from 'xlsx';
import type { EntityRecord } from '../domain/model';
import { repeatsReading } from '../domain/equipment-history';

export interface HistoricalEquipmentInput {
  serie: string;
  id_interno_cliente: string;
  marca: string;
  modelo: string;
}

export interface HistoricalReportInput {
  origen_id: string;
  orden_origen: string;
  serie: string;
  fecha: string;
  fecha_fin: string;
  estado: string;
  prioridad: string;
  tipo: string;
  diagnostico: string;
  trabajo: string;
  notas_seguridad: string;
  tecnicos: string;
  recibido_por: string;
  inspector: string;
  horometro: number | null;
  odometro_millas: number | null;
  insumos_origen: string;
  repuestos_origen: string;
  adjuntos_referencias: string;
  firma_cliente_referencia: string;
  checklist_origen: string;
  bocina_origen: string;
  mes_origen: string;
  semana_origen: string;
  dia_origen: string;
  ubicacion_coordenadas: string;
}

export interface HistoricalReportsImport {
  cliente_id: string;
  sede_id: string;
  equipos: HistoricalEquipmentInput[];
  reportes: HistoricalReportInput[];
}

const text = (row: Record<string, unknown>, key: string) => String(row[key] ?? '').trim();
const number = (value: string): number | null => {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/** Encabezados que lee el importador, en el orden de la plantilla Excel. */
export const historicalReportColumns = ['ID', 'Orden de Servicio', 'Date/Time', 'Hora_Final', 'Equipo', 'ID_Equipo', 'Marca', 'Modelo', 'Horometro (H1)', 'Odometro (H3)', 'Prioridad', 'Estado del Servicio', 'Tipo de Trabajo', 'Falla', 'Descripción del Trabajo', 'Notas de Seguridad', 'Técnico', 'Nombre de Cliente', 'Inspector', 'Insumos', 'Repuestos', 'Location', 'Mes', 'Semana', 'Día', 'Adjuntos', 'Foto Antes', 'Foto Despues', 'Checklist', 'Firma Cliente', 'Bocina'] as const;
export const historicalRequiredColumns = ['ID', 'Orden de Servicio', 'Date/Time', 'Equipo', 'Marca', 'Modelo'] as const;
export const historicalTemplatePath = '/templates/Plantilla-historial-reportes-EMSA.xlsx';
const dateColumns = new Set(['Date/Time', 'Hora_Final']);

function sourceDate(value: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error(`Fecha no reconocida: ${value || '(vacía)'}`);
  const [, day, month, year, hour, minute, second = '00'] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) throw new Error(`Fecha no válida: ${value}`);
  const local = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second}-06:00`;
  return new Date(local).toISOString();
}

// Excel guarda las fechas como número de serie sin zona horaria: se pasan a día/mes/año como en AppSheet.
function excelDate(serial: number) {
  const date = XLSX.SSF.parse_date_code(serial);
  if (!date) return String(serial);
  return `${date.d}/${date.m}/${date.y} ${date.H}:${String(date.M).padStart(2, '0')}:${String(Math.floor(date.S)).padStart(2, '0')}`;
}

function sourceRows(source: string | ArrayBuffer) {
  const workbook = typeof source === 'string' ? XLSX.read(source, { type: 'string', FS: '\t' }) : XLSX.read(new Uint8Array(source), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames.includes('Historial') ? 'Historial' : workbook.SheetNames[0]];
  if (!sheet) throw new Error('No se encontró una tabla en el archivo.');
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  if (range.e.r > 10000 || range.e.c > 100) throw new Error('El rango del archivo es demasiado grande. Conserva solo las columnas y filas del historial.');
  // Formatted text preserves the source's Guatemala date order (DD/MM/YYYY).
  if (typeof source === 'string') return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })
    .map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, dateColumns.has(key) && typeof value === 'number' ? excelDate(value) : value])));
}

/** Lee el TSV de AppSheet (texto) o la plantilla Excel (.xlsx, como ArrayBuffer). */
export function parseHistoricalReports(source: string | ArrayBuffer, clienteId: string, sedeId: string, existingEquipment: EntityRecord[], existingReports: EntityRecord[], existingReadings: EntityRecord[] = []) {
  const rows = sourceRows(source).filter(row => text(row, 'ID') && text(row, 'Date/Time'));
  if (!rows.length) throw new Error('No se encontraron reportes con ID y fecha.');
  if (rows.length > 2000) throw new Error('Esta importación admite hasta 2,000 reportes por archivo.');
  const sourceIds = new Set<string>(); const serials = new Map<string, HistoricalEquipmentInput>();
  const duplicateReports = new Set(existingReports.filter(row => row.importado === true).map(row => String(row.origen_id)));
  const duplicateOrders = new Set(existingReports.filter(row => row.importado === true).map(row => String(row.orden_origen)));
  const errors: string[] = [];
  const reports: HistoricalReportInput[] = [];
  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    const sourceId = text(row, 'ID'); const order = text(row, 'Orden de Servicio'); const serial = text(row, 'Equipo');
    if (sourceIds.has(sourceId)) { errors.push(`Fila ${line}: el ID ${sourceId} está repetido en el archivo.`); continue; }
    sourceIds.add(sourceId);
    if (!order || !serial) { errors.push(`Fila ${line}: falta la orden de servicio o la serie del equipo.`); continue; }
    const equipment: HistoricalEquipmentInput = { serie: serial, id_interno_cliente: text(row, 'ID_Equipo'), marca: text(row, 'Marca'), modelo: text(row, 'Modelo') };
    if (!equipment.marca) { errors.push(`Fila ${line}: el equipo ${serial} no tiene marca.`); continue; }
    if (!equipment.modelo) { errors.push(`Fila ${line}: el equipo ${serial} no tiene modelo.`); continue; }
    const previous = serials.get(serial.toLocaleLowerCase());
    if (previous && (previous.modelo !== equipment.modelo || previous.id_interno_cliente !== equipment.id_interno_cliente)) { errors.push(`Fila ${line}: los datos de la serie ${serial} no coinciden entre reportes.`); continue; }
    serials.set(serial.toLocaleLowerCase(), equipment);
    try {
      const start = sourceDate(text(row, 'Date/Time'));
      const endValue = text(row, 'Hora_Final');
      const end = endValue ? sourceDate(endValue) : '';
      const attachments = ['Adjuntos', 'Foto Antes', 'Foto Despues', 'Checklist'].map(key => text(row, key) && `${key}: ${text(row, key)}`).filter(Boolean).join('\n');
      const h1Text = text(row, 'Horometro (H1)'); const h3Text = text(row, 'Odometro (H3)');
      const h1 = number(h1Text); const h3 = number(h3Text);
      if (h1Text && h1 === null) errors.push(`Fila ${line}: lectura H1 no numérica (${h1Text}).`);
      if (h3Text && h3 === null) errors.push(`Fila ${line}: lectura H3 no numérica (${h3Text}).`);
      reports.push({
        origen_id: sourceId, orden_origen: order, serie: serial, fecha: start, fecha_fin: end,
        estado: text(row, 'Estado del Servicio') || 'Sin estado en origen', prioridad: text(row, 'Prioridad'),
        tipo: text(row, 'Tipo de Trabajo') || 'Sin clasificar', diagnostico: text(row, 'Falla'),
        trabajo: text(row, 'Descripción del Trabajo'), notas_seguridad: text(row, 'Notas de Seguridad'),
        tecnicos: text(row, 'Técnico'), recibido_por: text(row, 'Nombre de Cliente'), inspector: text(row, 'Inspector'),
        horometro: h1, odometro_millas: h3,
        insumos_origen: text(row, 'Insumos'), repuestos_origen: text(row, 'Repuestos'), adjuntos_referencias: attachments,
        firma_cliente_referencia: text(row, 'Firma Cliente'), checklist_origen: text(row, 'Checklist'), bocina_origen: text(row, 'Bocina'),
        mes_origen: text(row, 'Mes'), semana_origen: text(row, 'Semana'), dia_origen: text(row, 'Día'), ubicacion_coordenadas: text(row, 'Location'),
      });
    } catch (error) { errors.push(`Fila ${line}: ${error instanceof Error ? error.message : 'fecha inválida'}`); }
  }
  const equipmentBySerial = new Map(existingEquipment.map(row => [String(row.serie).toLocaleLowerCase(), row]));
  for (const equipment of serials.values()) {
    const existing = equipmentBySerial.get(equipment.serie.toLocaleLowerCase());
    if (existing && (String(existing.cliente_id) !== clienteId || String(existing.modelo).toLocaleLowerCase() !== equipment.modelo.toLocaleLowerCase() || (existing.id_interno_cliente && equipment.id_interno_cliente && String(existing.id_interno_cliente).toLocaleLowerCase() !== equipment.id_interno_cliente.toLocaleLowerCase()))) errors.push(`La serie ${equipment.serie} ya existe en el portal con otro cliente, modelo o ID interno.`);
  }
  const repeatedSource = reports.filter(row => duplicateReports.has(row.origen_id));
  const repeatedOrders = reports.filter(row => duplicateOrders.has(row.orden_origen) && !duplicateReports.has(row.origen_id));
  if (repeatedOrders.length) errors.push(`Las órdenes originales ya están registradas con otro ID: ${repeatedOrders.map(row => row.orden_origen).join(', ')}.`);
  const newReports = reports.filter(row => !duplicateReports.has(row.origen_id));
  const equipment = [...serials.values()].filter(row => !equipmentBySerial.has(row.serie.toLocaleLowerCase()));
  // Misma regla que el servidor: no se agrega una lectura igual a otra conservada en el portal o anterior en este archivo.
  const serialById = new Map(existingEquipment.map(row => [row.id, String(row.serie).toLocaleLowerCase()]));
  const kept = new Map<string, Record<string, unknown>[]>();
  const keptFor = (serial: string) => { const rows = kept.get(serial) ?? []; kept.set(serial, rows); return rows; };
  for (const reading of existingReadings) { const serial = serialById.get(String(reading.equipo_id)); if (serial && serials.has(serial)) keptFor(serial).push(reading); }
  let newReadingCount = 0; let repeatedReadings = 0;
  for (const report of newReports) {
    if (report.horometro === null) continue;
    const reading = { fecha: report.fecha, valor: report.horometro, odometro_millas: report.odometro_millas, origen: 'Orden de servicio' };
    const rows = keptFor(report.serie.toLocaleLowerCase());
    if (rows.some(row => repeatsReading(row, reading))) repeatedReadings++;
    else { rows.push(reading); newReadingCount++; }
  }
  return { payload: { cliente_id: clienteId, sede_id: sedeId, equipos: equipment, reportes: newReports } satisfies HistoricalReportsImport, errors, sourceRows: rows.length, repeatedReports: repeatedSource.length, newReportCount: newReports.length, newEquipmentCount: equipment.length, newReadingCount, repeatedReadings };
}

export function historicalReadingNotice(repeatedReadings: number) {
  if (!repeatedReadings) return '';
  return repeatedReadings === 1 ? 'Una lectura de horómetro ya está registrada para ese equipo y no se duplicará.' : `${repeatedReadings} lecturas de horómetro ya están registradas para esos equipos y no se duplicarán.`;
}

export function historicalStatusCounts(reports: HistoricalReportInput[]) {
  const counts = new Map<string, number>();
  for (const row of reports) counts.set(row.estado, (counts.get(row.estado) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

export function historicalPendingNotice(statusCounts: [string, number][]) {
  const pending = statusCounts.find(([state]) => state === 'Pendiente')?.[1] ?? 0;
  if (!pending) return '';
  return pending === 1 ? 'La orden que figura como “Pendiente” conservará ese estado histórico; no se marcará como pendiente actual.' : `Las ${pending} órdenes que figuran como “Pendiente” conservarán ese estado histórico; no se marcarán como pendientes actuales.`;
}

export function historicalMeterRegressions(reports: HistoricalReportInput[]) {
  const groups = new Map<string, HistoricalReportInput[]>();
  for (const row of reports) if (row.horometro !== null) groups.set(row.serie, [...(groups.get(row.serie) ?? []), row]);
  return [...groups].flatMap(([serial, readings]) => {
    const ordered = readings.sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha));
    return ordered.slice(1).flatMap((row, index) => row.horometro! < ordered[index].horometro! ? [{ serie: serial, orden: row.orden_origen, fecha: row.fecha, anterior: ordered[index].horometro, lectura: row.horometro }] : []);
  });
}
