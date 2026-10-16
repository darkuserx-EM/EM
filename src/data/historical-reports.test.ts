import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { historicalMeterRegressions, historicalPendingNotice, historicalReadingNotice, historicalReportColumns, historicalRequiredColumns, historicalStatusCounts, parseHistoricalReports } from './historical-reports';
import { createSeed, seedRecord } from './seed';

const headings = ['Inspector','ID','Date/Time','Hora_Final','Mes','Semana','Día','Location','Prioridad','Estado del Servicio','Orden de Servicio','Cliente','Equipo','ID_Equipo','Marca','Modelo','Horometro (H1)','Odometro (H3)','Tipo de Trabajo','Falla','Descripción del Trabajo','Notas de Seguridad','Técnico','Nombre de Cliente','Firma Cliente','Insumos','Repuestos','Separador2','Adjuntos','Foto Antes','Foto Despues','Checklist','Bocina','Separador1','🔐 Softr Record ID'];
const row = (id: string, date: string, h1: string) => ['admin@example.com',id,date,'08/02/2025 15:30:00','febrero','Semana 6','sábado','14.6, -90.4','Programada','Completado','21','Cliente de prueba','9A196405','FC#1','CROWN','FC4500',h1,'125','Correctivo','Hidráulica','Cambio de manguera','','Raul Perez','Ricardo','','Wipe','Manguera','','','antes.jpg','despues.jpg','','','', ''];
const tabular = (...rows: string[][]) => [headings, ...rows].map(values => values.join('\t')).join('\n');
const withValue = (values: string[], heading: string, value: string) => values.map((item, index) => headings[index] === heading ? value : item);
const excelBook = (book: XLSX.WorkBook) => XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
// Número de serie de Excel (días desde 30/12/1899) para una fecha y hora sin zona horaria.
const excelSerial = (year: number, month: number, day: number, hour: number, minute: number) => (Date.UTC(year, month - 1, day, hour, minute) - Date.UTC(1899, 11, 30)) / 86_400_000;

describe('importación histórica de AppSheet', () => {
  it('interpreta fechas guatemaltecas, crea el mapa de equipo y conserva referencias', () => {
    const client = createSeed().entities.Cliente[0];
    const result = parseHistoricalReports(tabular(row('source-1','08/02/2025 14:00:00','100'), row('source-2','09/02/2025 14:00:00','90')), client.id, '', [], []);
    expect(result.errors).toEqual([]);
    expect(result.newEquipmentCount).toBe(1);
    expect(result.newReportCount).toBe(2);
    expect(result.payload.reportes[0].fecha).toBe('2025-02-08T20:00:00.000Z');
    expect(result.payload.reportes[0].odometro_millas).toBe(125);
    expect(result.payload.reportes[0].adjuntos_referencias).toContain('Foto Antes: antes.jpg');
    expect(historicalMeterRegressions(result.payload.reportes)).toHaveLength(1);
  });
  it('rechaza fechas inválidas, filas sin clave y una serie en conflicto', () => {
    const client = createSeed().entities.Cliente[0];
    const broken = row('source-1','31/02/2025 14:00:00','100');
    const conflict = { id: 'existing', codigo: 'TCE-999', creado_por: 'x', fecha_creacion: '', actualizado_por: 'x', fecha_actualizacion: '', serie: '9A196405', modelo: 'OTHER', cliente_id: client.id };
    const result = parseHistoricalReports(tabular(broken), client.id, '', [conflict], []);
    expect(result.errors.join(' ')).toContain('Fecha no válida');
    expect(result.errors.join(' ')).toContain('otro cliente, modelo o ID interno');
  });
  it('toma la marca del archivo y deja la ubicación a la sede elegida', () => {
    const client = createSeed().entities.Cliente[0];
    const result = parseHistoricalReports(tabular(withValue(row('source-1','08/02/2025 14:00:00','100'), 'Marca', 'Yale')), client.id, 'site-1', [], []);
    expect(result.errors).toEqual([]);
    expect(result.payload.equipos[0].marca).toBe('Yale');
    expect(result.payload.sede_id).toBe('site-1');
    expect(result.payload.reportes[0]).not.toHaveProperty('ubicacion');
  });
  it('no supone una marca cuando el archivo no la trae', () => {
    const client = createSeed().entities.Cliente[0];
    const result = parseHistoricalReports(tabular(withValue(row('source-1','08/02/2025 14:00:00','100'), 'Marca', '')), client.id, '', [], []);
    expect(result.errors).toEqual(['Fila 2: el equipo 9A196405 no tiene marca.']);
    expect(result.payload.equipos).toEqual([]);
  });
  it('cuenta las órdenes «Pendiente» del archivo para el aviso', () => {
    const client = createSeed().entities.Cliente[0];
    const pending = (id: string, date: string) => withValue(row(id, date, ''), 'Estado del Servicio', 'Pendiente');
    const result = parseHistoricalReports(tabular(pending('source-1','08/02/2025 14:00:00'), pending('source-2','09/02/2025 14:00:00'), row('source-3','10/02/2025 14:00:00','')), client.id, '', [], []);
    const counts = historicalStatusCounts(result.payload.reportes);
    expect(counts).toEqual([['Pendiente', 2], ['Completado', 1]]);
    expect(historicalPendingNotice(counts)).toBe('Las 2 órdenes que figuran como “Pendiente” conservarán ese estado histórico; no se marcarán como pendientes actuales.');
    expect(historicalPendingNotice([['Pendiente', 1]])).toBe('La orden que figura como “Pendiente” conservará ese estado histórico; no se marcará como pendiente actual.');
    expect(historicalPendingNotice([['Completado', 3]])).toBe('');
  });
  it('no cuenta como nueva una lectura repetida en el archivo el mismo día', () => {
    const client = createSeed().entities.Cliente[0];
    const result = parseHistoricalReports(tabular(row('source-1','08/02/2025 09:00:00','100'), row('source-2','08/02/2025 16:00:00','100'), row('source-3','09/02/2025 09:00:00','100')), client.id, '', [], []);
    expect(result.errors).toEqual([]);
    expect(result.newReportCount).toBe(3);
    expect(result.newReadingCount).toBe(2);
    expect(result.repeatedReadings).toBe(1);
  });
  it('no duplica lecturas conservadas en el portal: mismo día, o igual a la de ingreso', () => {
    const client = createSeed().entities.Cliente[0];
    const machine = seedRecord('machine-1', 'TCE-901', { serie: '9A196405', modelo: 'FC4500', id_interno_cliente: 'FC#1', cliente_id: client.id });
    const reading = (id: string, fields: Record<string, string | number>) => seedRecord(id, id, { equipo_id: machine.id, cliente_id: client.id, ...fields });
    const kept = [
      reading('HOR-1', { fecha: '2026-10-01T15:00:00.000Z', valor: 300, origen: 'Ingreso de equipo' }),
      reading('HOR-2', { fecha: '2025-02-08T22:00:00.000Z', valor: 100, origen: 'Lectura de cierre' }),
      reading('HOR-3', { fecha: '2025-02-09T22:00:00.000Z', valor: 200, odometro_millas: 50, origen: 'Lectura de cierre' }),
    ];
    const result = parseHistoricalReports(tabular(
      row('source-1','08/02/2025 09:00:00','100'),
      row('source-2','01/03/2025 09:00:00','300'),
      withValue(row('source-3','09/02/2025 09:00:00','200'), 'Odometro (H3)', '60'),
      row('source-4','10/02/2025 09:00:00','100'),
    ), client.id, '', [machine], [], kept);
    expect(result.errors).toEqual([]);
    expect(result.newEquipmentCount).toBe(0);
    expect(result.repeatedReadings).toBe(2);
    expect(result.newReadingCount).toBe(2);
    expect(historicalReadingNotice(result.repeatedReadings)).toBe('2 lecturas de horómetro ya están registradas para esos equipos y no se duplicarán.');
    expect(historicalReadingNotice(1)).toBe('Una lectura de horómetro ya está registrada para ese equipo y no se duplicará.');
    expect(historicalReadingNotice(0)).toBe('');
  });
  it('lee un Excel con fechas como texto y como fecha de Excel, igual que el archivo de AppSheet', () => {
    const client = createSeed().entities.Cliente[0];
    const fromText = parseHistoricalReports(tabular(row('source-1','08/02/2025 14:00:00','100'), row('source-2','09/02/2025 14:00:00','90')), client.id, '', [], []);
    const sheet = XLSX.utils.aoa_to_sheet([headings, row('source-1','08/02/2025 14:00:00','100'), row('source-2','','90')]);
    sheet[XLSX.utils.encode_cell({ r: 2, c: headings.indexOf('Date/Time') })] = { t: 'n', v: excelSerial(2025, 2, 9, 14, 0), z: 'dd/mm/yyyy hh:mm:ss' };
    for (const r of [1, 2]) { const h1 = XLSX.utils.encode_cell({ r, c: headings.indexOf('Horometro (H1)') }); sheet[h1] = { t: 'n', v: Number(sheet[h1].v) }; }
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Historial');
    const fromExcel = parseHistoricalReports(excelBook(book), client.id, '', [], []);
    expect(fromExcel.errors).toEqual([]);
    expect(fromExcel.payload).toEqual(fromText.payload);
    expect(fromExcel.payload.reportes[1].fecha).toBe('2025-02-09T20:00:00.000Z');
  });
  it('acepta la hora sin segundos', () => {
    const client = createSeed().entities.Cliente[0];
    const result = parseHistoricalReports(tabular(row('source-1','8/2/2025 14:05','100')), client.id, '', [], []);
    expect(result.errors).toEqual([]);
    expect(result.payload.reportes[0].fecha).toBe('2025-02-08T20:05:00.000Z');
  });
});

describe('plantilla Excel del historial', () => {
  const template = () => XLSX.read(readFileSync('public/templates/Plantilla-historial-reportes-EMSA.xlsx'), { type: 'buffer' });
  it('trae la guía, la hoja de captura vacía y la hoja de ejemplo con los encabezados del importador', () => {
    const book = template();
    expect(book.SheetNames).toEqual(['Guía', 'Historial', 'Ejemplo']);
    for (const name of ['Historial', 'Ejemplo']) expect(XLSX.utils.sheet_to_json<string[]>(book.Sheets[name], { header: 1 })[0]).toEqual([...historicalReportColumns]);
    const guide = XLSX.utils.sheet_to_json<string[]>(book.Sheets['Guía'], { header: 1, defval: '' }).flat().join(' ');
    for (const column of historicalRequiredColumns) expect(guide).toContain(column);
    expect(guide).toContain('día/mes/año');
    expect(guide).toContain('la orden original no puede existir ya en el portal con otro ID');
    const client = createSeed().entities.Cliente[0];
    expect(() => parseHistoricalReports(excelBook(book), client.id, '', [], [])).toThrow('No se encontraron reportes');
  });
  it('importa los ejemplos copiados a la hoja Historial', () => {
    const book = template();
    const examples = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Ejemplo, { header: 1, raw: true }).slice(1);
    expect(examples).toHaveLength(2);
    XLSX.utils.sheet_add_aoa(book.Sheets.Historial, examples, { origin: 'A2' });
    const client = createSeed().entities.Cliente[0];
    const result = parseHistoricalReports(excelBook(book), client.id, '', [], []);
    expect(result.errors).toEqual([]);
    expect(result.newEquipmentCount).toBe(1);
    expect(result.payload.equipos[0]).toEqual({ serie: 'SERIE-EJEMPLO-01', id_interno_cliente: 'M-01', marca: 'Marca de ejemplo', modelo: 'Modelo A' });
    expect(result.payload.reportes.map(report => [report.orden_origen, report.fecha, report.horometro, report.odometro_millas, report.estado])).toEqual([
      ['EJ-101', '2025-02-08T20:00:00.000Z', 1200, null, 'Completado'],
      ['EJ-102', '2025-03-10T15:30:00.000Z', 1260, 85, 'Pendiente'],
    ]);
    expect(result.newReadingCount).toBe(2);
  });
});
