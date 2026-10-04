import * as XLSX from 'xlsx';
import { baseColumns, definitions, type Scalar } from '../domain/model';
import { clientImportEntities, type ClientImportRow } from '../domain/client-import';
import { normalize } from '../domain/validation';

export function parseClientWorkbook(workbook: XLSX.WorkBook): ClientImportRow[] {
  if (!workbook.Sheets.Cliente) throw new Error('No se encontró la hoja Cliente. Usa la plantilla de clientes o un Excel exportado del portal.');
  const output: ClientImportRow[] = [];
  for (const entity of clientImportEntities) {
    const sheet = workbook.Sheets[entity]; if (!sheet?.['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    if (range.e.r > 10000 || range.e.c > 100) throw new Error(`${entity}: el rango del archivo es demasiado grande. Conserva solo las columnas y filas de captura.`);
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true, range: 0 });
    const headers = (matrix[0] ?? []).map(value => String(value ?? '').trim());
    const populated = matrix.slice(1).map((values, index) => ({ values, line: index + 2 })).filter(row => row.values.some(value => String(value ?? '').trim()));
    if (!populated.length) continue;
    const allowed = new Set([...baseColumns.map(c => c.key), ...definitions[entity].columns.map(c => c.key), 'referencia_cliente']);
    const used = headers.filter(Boolean);
    if (new Set(used).size !== used.length) throw new Error(`${entity}: hay encabezados repetidos.`);
    const unknown = used.filter(header => !allowed.has(header));
    if (unknown.length) throw new Error(`${entity}: encabezados no reconocidos: ${unknown.join(', ')}. Conserva los nombres de la plantilla.`);
    for (const column of definitions[entity].columns.filter(c => c.required && c.key !== 'cliente_id')) if (!headers.includes(column.key)) throw new Error(`${entity}: falta el encabezado obligatorio ${column.key}.`);
    if (entity !== 'Cliente' && !headers.includes('referencia_cliente') && !headers.includes('cliente_id')) throw new Error(`${entity}: falta referencia_cliente o cliente_id para vincular la empresa.`);
    for (const { values, line } of populated) {
      const fields: Record<string, Scalar> = {}; const issues: string[] = [];
      for (const [index, header] of headers.entries()) {
        const cell = sheet[XLSX.utils.encode_cell({ r: line - 1, c: index })];
        if (cell?.f) issues.push(`${header || 'Columna sin encabezado'}: reemplaza la fórmula por su valor antes de importar.`);
        if (cell?.t === 'e') issues.push(`${header}: la celda contiene un error de Excel.`);
      }
      if (values.some((value, index) => String(value ?? '').trim() && !headers[index])) issues.push('Hay datos en una columna sin encabezado.');
      for (const column of definitions[entity].columns) {
        const index = headers.indexOf(column.key); if (index < 0) continue; // Absent columns preserve existing optional data.
        const cell = sheet[XLSX.utils.encode_cell({ r: line - 1, c: index })];
        const raw = values[index];
        let value: Scalar = column.type === 'number' ? String(raw ?? '').trim() ? Number(raw) : null : cell?.t === 'n' ? XLSX.utils.format_cell(cell) : String(raw ?? '').trim();
        if (column.options && value !== '') {
          const key = normalize(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          value = column.options.find(option => normalize(option).normalize('NFD').replace(/[\u0300-\u036f]/g, '') === key) ?? value;
        }
        fields[column.key] = value;
      }
      const id = String(values[headers.indexOf('id')] ?? '').trim() || undefined;
      const reference = entity !== 'Cliente' ? String(values[headers.indexOf('referencia_cliente')] ?? '').trim() : undefined;
      output.push({ entity, line, id, reference, fields, issues });
      if (output.length > 2000) throw new Error('El límite es de 2000 filas en total por importación.');
    }
  }
  if (!output.length) throw new Error('El archivo no contiene filas para importar. Llena Cliente desde la fila 2.');
  return output;
}
