import { describe, expect, it } from 'vitest';
import { historicalMeterRegressions, historicalPendingNotice, historicalStatusCounts, parseHistoricalReports } from './historical-reports';
import { createSeed } from './seed';

const headings = ['Inspector','ID','Date/Time','Hora_Final','Mes','Semana','Día','Location','Prioridad','Estado del Servicio','Orden de Servicio','Cliente','Equipo','ID_Equipo','Marca','Modelo','Horometro (H1)','Odometro (H3)','Tipo de Trabajo','Falla','Descripción del Trabajo','Notas de Seguridad','Técnico','Nombre de Cliente','Firma Cliente','Insumos','Repuestos','Separador2','Adjuntos','Foto Antes','Foto Despues','Checklist','Bocina','Separador1','🔐 Softr Record ID'];
const row = (id: string, date: string, h1: string) => ['admin@example.com',id,date,'08/02/2025 15:30:00','febrero','Semana 6','sábado','14.6, -90.4','Programada','Completado','21','Cliente de prueba','9A196405','FC#1','CROWN','FC4500',h1,'125','Correctivo','Hidráulica','Cambio de manguera','','Raul Perez','Ricardo','','Wipe','Manguera','','','antes.jpg','despues.jpg','','','', ''];
const tabular = (...rows: string[][]) => [headings, ...rows].map(values => values.join('\t')).join('\n');
const withValue = (values: string[], heading: string, value: string) => values.map((item, index) => headings[index] === heading ? value : item);

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
});
