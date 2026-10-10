import { describe, expect, it } from 'vitest';
import { historicalMeterRegressions, parseHistoricalReports } from './historical-reports';
import { createSeed } from './seed';

const headings = ['Inspector','ID','Date/Time','Hora_Final','Mes','Semana','Día','Location','Prioridad','Estado del Servicio','Orden de Servicio','Cliente','Equipo','ID_Equipo','Marca','Modelo','Horometro (H1)','Odometro (H3)','Tipo de Trabajo','Falla','Descripción del Trabajo','Notas de Seguridad','Técnico','Nombre de Cliente','Firma Cliente','Insumos','Repuestos','Separador2','Adjuntos','Foto Antes','Foto Despues','Checklist','Bocina','Separador1','🔐 Softr Record ID'];
const row = (id: string, date: string, h1: string) => ['admin@example.com',id,date,'08/02/2025 15:30:00','febrero','Semana 6','sábado','14.6, -90.4','Programada','Completado','21','Distelsa Unisur 4','9A196405','FC#1','CROWN','FC4500',h1,'125','Correctivo','Hidráulica','Cambio de manguera','','Raul Perez','Ricardo','','Wipe','Manguera','','','antes.jpg','despues.jpg','','','', ''];
const tabular = (...rows: string[][]) => [headings, ...rows].map(values => values.join('\t')).join('\n');

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
});
