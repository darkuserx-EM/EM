import * as XLSX from 'xlsx';
import type { EntityRecord } from '../domain/model';
import type { SubmittedReading } from '../domain/reading-submissions';
export function downloadReadingTemplate(equipment: EntityRecord[]) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Fecha','Hora Guatemala','Equipo · ID cliente','Serie','Modelo','Horómetro (h)','Observación','Código EMSA'], ...equipment.map(row => ['', '', row.id_interno_cliente || row.codigo, row.serie, row.modelo, '', '', row.codigo])]);
  sheet['!cols'] = [18,20,24,24,32,20,45,20].map(wch => ({wch}));
  XLSX.utils.book_append_sheet(book,sheet,'Lecturas');
  XLSX.writeFile(book,'Plantilla-horometros.xlsx');
}
export function parseReadingSheet(bytes: ArrayBuffer, equipment: EntityRecord[]): SubmittedReading[] {
  const book = XLSX.read(bytes, { type: 'array' });
  const names = book.SheetNames.filter(name => name === 'Lecturas' || name.startsWith('Lecturas '));
  if (names.length !== 1) throw new Error('Usa una sola hoja llamada Lecturas o Lecturas Distelsa.');
  const sheet = book.Sheets[names[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  if (range.e.r > 200 || range.e.c > 20) throw new Error('Máximo 200 filas y 21 columnas.');
  for (const [key,cell] of Object.entries(sheet)) if (!key.startsWith('!') && cell.f) throw new Error('Usa valores, no fórmulas.');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
  const result: SubmittedReading[] = []; const seen = new Set<string>();
  for (const [index,row] of rows.entries()) {
    if (row['Horómetro (h)'] === '' && row.Fecha === '' && row['Hora Guatemala'] === '') continue;
    const match = equipment.filter(item => String(item.serie).trim().toLowerCase() === String(row.Serie).trim().toLowerCase());
    if (match.length !== 1) throw new Error(`Fila ${index + 2}: serie desconocida o ambigua para tu cliente.`);
    const rawDate = typeof row.Fecha === 'number' ? XLSX.SSF.parse_date_code(row.Fecha, { date1904: !!book.Workbook?.WBProps?.date1904 }) : null;
    const date = rawDate ? [rawDate.y, rawDate.m, rawDate.d] : String(row.Fecha).split('/').map(Number).reverse();
    const rawTime = typeof row['Hora Guatemala'] === 'number' ? XLSX.SSF.parse_date_code(Number(row['Hora Guatemala'])) : null;
    const time = rawTime ? [rawTime.H,rawTime.M,rawTime.S] : String(row['Hora Guatemala']).split(':').map(Number);
    const [y,m,d] = date, [h,min,sec = 0] = time;
    const local = new Date(Date.UTC(y,m-1,d,h,min,sec));
    if (date.length !== 3 || time.length < 2 || time.length > 3 || y < 2000 || local.getUTCFullYear() !== y || local.getUTCMonth() !== m-1 || local.getUTCDate() !== d || h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 || sec > 59 || !Number.isFinite(local.getTime())) throw new Error(`Fila ${index + 2}: fecha u hora inválida. Usa dd/mm/aaaa y hh:mm:ss.`);
    const fecha = new Date(local.getTime() + 6 * 3600000).toISOString();
    const value = row['Horómetro (h)'];
    if (value === '' || !/^\d+(\.\d+)?$/.test(String(value)) || !Number.isFinite(Number(value))) throw new Error(`Fila ${index+2}: horómetro inválido.`);
    const key = `${match[0].id}/${fecha}`;
    if (seen.has(key)) throw new Error(`Fila ${index+2}: equipo y momento repetidos.`); seen.add(key);
    result.push({ equipo_id: match[0].id, fecha, valor: Number(value), observacion: String(row.Observación || '').trim() });
  }
  if (!result.length) throw new Error('No hay lecturas completas para enviar.');
  return result;
}
