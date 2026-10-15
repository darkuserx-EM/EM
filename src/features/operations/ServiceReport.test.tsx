import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EntityRecord } from '../../domain/model';
import { ServiceReport, serviceHours } from './ServiceReport';

const record = (values: Record<string, unknown>) => ({ id: 'a', codigo: 'OS-1', creado_por: '', fecha_creacion: '', actualizado_por: '', fecha_actualizacion: '', ...values }) as EntityRecord;
const order = record({ codigo: 'OS-180', schema_operacion: 1, estado: 'Completada', tipo: 'Correctivo', equipo_id: 'm1', tecnico_id: 't1', tecnico_apoyo_1_id: 't2', fecha: '2026-10-13T16:30:00.000Z', fecha_fin: '2026-10-13T17:45:00.000Z', sintoma: 'Cadena floja', diagnostico: 'Requiere ajuste', trabajo_realizado: 'Ajuste de cadenas', resultado_pruebas: 'Funciona correctamente', insumos: 'Grasa', repuestos: '', recibido_por: 'Persona de prueba', horometro: 4206 });
const technicians = [record({ id: 't1', nombre: 'Técnico Uno' }), record({ id: 't2', nombre: 'Técnico Dos' })];
const equipment = record({ id: 'm1', codigo: 'TCE-007', id_interno_cliente: 'UN01', marca: 'Marca', modelo: 'Modelo', serie: 'S-1' });

describe('reporte de servicio', () => {
  it('muestra el horario con inicio, fin y duración', () => {
    expect(serviceHours(order)).toBe('10:30 a 11:45 · 1 h 15 min');
    expect(serviceHours(record({ fecha: '2026-10-13T16:30:00.000Z' }))).toBe('Desde las 10:30');
    expect(serviceHours(record({ fecha: '2026-10-13T16:30:00.000Z', fecha_fin: '2026-10-14T15:00:00.000Z' }))).toBe('10:30 a 14/10/2026 09:00 · 22 h 30 min');
    expect(serviceHours(record({ fecha_programada: '2026-10-13', hora_programada: '08:30' }))).toBe('Programado a las 08:30');
    expect(serviceHours(record({}))).toBe('Sin hora registrada');
  });

  it('ordena la información para el cliente: resumen, equipo, resultado, detalle, materiales y firmas', () => {
    const html = renderToStaticMarkup(<ServiceReport order={order} equipment={equipment} technicians={technicians} />);
    expect(html).toContain('<h2>OS-180</h2>');
    const order_ = ['Expertos en Montacargas, S.A.', 'Técnico Uno, responsable\nTécnico Dos, apoyo', 'UN01', 'TCE-007', '4,206 h', 'Funciona correctamente', 'Ajuste de cadenas', 'Ninguno registrado', 'Persona de prueba'].map(text => html.indexOf(text));
    expect(order_.every(index => index > -1)).toBe(true);
    expect([...order_].sort((a, b) => a - b)).toEqual(order_);
    expect(html).toContain('<dt>Horómetro</dt>');
    expect(html).not.toMatch(/Horómetro H1|Odómetro H3/);
  });

  it('omite los apartados sin información y no muestra firmas en los reportes históricos', () => {
    const html = renderToStaticMarkup(<ServiceReport order={record({ codigo: 'OS-9', importado: true, estado: 'Completada', fecha: '2025-03-10', trabajo: 'Servicio' })} technicians={[]} />);
    expect(html).not.toContain('sr-result');
    expect(html).not.toContain('sr-sign');
    expect(html).toContain('Equipo no disponible');
  });

  it('sin acceso a los nombres de los técnicos (cliente) no dice que la orden no tiene técnico', () => {
    const html = renderToStaticMarkup(<ServiceReport order={order} equipment={equipment} technicians={[]} />);
    expect(html).toContain('Técnico de Expertos en Montacargas, S.A.');
    expect(html).not.toContain('Sin técnico asignado');
  });
});
