import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EntityRecord } from '../../domain/model';
import { company, ServiceReport, serviceHours } from './ServiceReport';

const record = (values: Record<string, unknown>) => ({ id: 'a', codigo: 'OS-1', creado_por: '', fecha_creacion: '', actualizado_por: '', fecha_actualizacion: '', ...values }) as EntityRecord;
const order = record({ codigo: 'OS-180', schema_operacion: 1, estado: 'Completada', tipo: 'Correctivo', equipo_id: 'm1', tecnico_id: 't1', tecnico_apoyo_1_id: 't2', fecha: '2026-10-13T16:30:00.000Z', fecha_fin: '2026-10-13T17:45:00.000Z', sintoma: 'Cadena floja', diagnostico: 'Requiere ajuste', trabajo_realizado: 'Ajuste de cadenas', resultado_pruebas: 'Funciona correctamente', insumos: 'Grasa', repuestos: '', recibido_por: 'Persona de prueba', horometro: 4206 });
const technicians = [record({ id: 't1', nombre: 'Técnico Uno' }), record({ id: 't2', nombre: 'Técnico Dos' })];
const equipment = record({ id: 'm1', codigo: 'TCE-007', id_interno_cliente: 'UN01', marca: 'Marca', modelo: 'Modelo', serie: 'S-1' });

describe('reporte de servicio', () => {
  it.each(['OS-180', 'OS-"\\\n</style><script>alert(1)</script>'])('imprime el código %s en el margen sin permitir inyección de CSS o HTML', codigo => {
    const html = renderToStaticMarkup(<ServiceReport order={record({ codigo })} technicians={[]} />);
    const style = html.match(/<style>(.*?)<\/style>/s)?.[1] ?? '';
    expect(style).toMatch(/^@page service-report \{ @top-right \{ content: "(?:\\[0-9a-f]+ )+"; \} @bottom-left \{ content: "(?:\\[0-9a-f]+ )+"; \} \}$/);
    const [code, contact] = Array.from(style.matchAll(/content: "(.*?)"/gs), match => match[1].replace(/\\([0-9a-f]+) /g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16))));
    expect(code).toBe(codigo);
    // El pie de cada hoja sale de `company`: cambiar el teléfono ahí cambia el PDF.
    expect(contact).toBe(`${company.web} · ${company.email} · Tel. ${company.phone}`);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).not.toContain('<script>');
  });

  it('muestra el horario con inicio, fin y duración', () => {
    expect(serviceHours(order)).toBe('10:30 a 11:45 · 1 h 15 min');
    expect(serviceHours(record({ fecha: '2026-10-13T16:30:00.000Z' }))).toBe('Desde las 10:30');
    expect(serviceHours(record({ fecha: '2026-10-13T16:30:00.000Z', fecha_fin: '2026-10-14T15:00:00.000Z' }))).toBe('10:30 a 14/10/2026 09:00 · 22 h 30 min');
    // Con segundos (inicio registrado por el servidor), la duración cuadra con las horas que se leen.
    expect(serviceHours(record({ fecha: '2026-10-13T16:34:50.000Z', fecha_fin: '2026-10-13T16:37:00.000Z' }))).toBe('10:34 a 10:37 · 3 min');
    expect(serviceHours(record({ fecha_programada: '2026-10-13', hora_programada: '08:30' }))).toBe('Programado a las 08:30');
    expect(serviceHours(record({}))).toBe('Sin hora registrada');
  });

  it('ordena la información para el cliente: resumen, equipo, resultado, detalle, materiales y firmas', () => {
    const html = renderToStaticMarkup(<ServiceReport order={order} equipment={equipment} technicians={technicians} />);
    expect(html).toContain('<h2>OS-180</h2>');
    const order_ = ['Expertos en Montacargas, S.A.', 'Técnico Uno, responsable\nTécnico Dos, apoyo', 'UN01', '4,206 h', 'Funciona correctamente', 'Ajuste de cadenas', 'Ninguno registrado', 'Persona de prueba'].map(text => html.indexOf(text));
    expect(order_.every(index => index > -1)).toBe(true);
    expect([...order_].sort((a, b) => a - b)).toEqual(order_);
    expect(html).toContain('<dt>Horómetro</dt>');
    // El código EMSA es interno: no va en el reporte del cliente ni en el PDF.
    expect(html).not.toMatch(/TCE-007|Código EMSA/);
    expect(html).toContain('<dt>Solicitud</dt><dd>Cadena floja</dd>');
    expect(html).not.toContain('Síntoma');
    expect(html).not.toMatch(/Horómetro H1|Odómetro H3/);
  });

  it('omite los apartados sin información y no muestra firmas en los reportes históricos', () => {
    const html = renderToStaticMarkup(<ServiceReport order={record({ codigo: 'OS-9', importado: true, estado: 'Completada', fecha: '2025-03-10', trabajo: 'Servicio' })} technicians={[]} />);
    expect(html).not.toContain('sr-result');
    expect(html).not.toContain('sr-sign');
    expect(html).toContain('Equipo no disponible');
  });

  it('sin firma digital, solo la línea de quien recibe sale en papel; el técnico no firma', () => {
    const html = renderToStaticMarkup(<ServiceReport order={order} equipment={equipment} technicians={technicians} signature={null} />);
    expect(html).toContain('<section class="sr-sign" aria-labelledby="sr-conformidad">');
    expect(html.match(/class="sr-line"/g)).toHaveLength(1);
    expect(html).toContain('<div class="sr-sign-receiver"><span class="sr-line"></span><div><strong>Persona de prueba</strong><small>Recibido por · firma</small></div></div>');
    expect(html).not.toContain('Técnico responsable · firma');
    expect(html).not.toContain('<img');
  });

  it('con firma digital, la imagen reemplaza la línea de quien recibe y la conformidad se ve también en pantalla', () => {
    const signature = { id: 'sig-1', signer: 'Persona que firmó', signedAt: Date.parse('2026-10-13T17:50:00.000Z'), capturedBy: 'Técnico Uno' };
    const html = renderToStaticMarkup(<ServiceReport order={order} equipment={equipment} technicians={technicians} signature={signature} />);
    expect(html).toContain('<section class="sr-sign sr-signed" aria-labelledby="sr-conformidad"><h3 id="sr-conformidad" class="sr-sign-title">Conformidad del servicio</h3>');
    expect(html).not.toContain('class="sr-line"');
    expect(html).not.toContain('Técnico responsable · firma');
    expect(html).toContain('<div class="sr-sign-receiver"><img class="sr-signature" src="/api/attachments/sig-1/file" alt="Firma de Persona que firmó"/><div><strong>Persona que firmó</strong><small>Recibido por · firmado el 13/10/2026 a las 11:50</small>');
    expect(html).toContain('<small class="sr-sign-capture">Capturada en el portal por Técnico Uno</small>');
    // El servidor no envía al cliente quién capturó la firma; el reporte no inventa ese dato.
    const client = renderToStaticMarkup(<ServiceReport order={order} equipment={equipment} technicians={[]} signature={{ ...signature, capturedBy: undefined }} />);
    expect(client).toContain('alt="Firma de Persona que firmó"');
    expect(client).not.toContain('sr-sign-capture');
    expect(html).not.toContain('sr-sign-revised');
  });

  it('advierte en el reporte si la firma es anterior a una corrección o si no se pudo leer', () => {
    const revised = { id: 'sig-1', signer: 'Persona que firmó', signedAt: Date.parse('2026-10-13T17:50:00.000Z'), revisedAt: Date.parse('2026-10-15T15:15:00.000Z') };
    expect(renderToStaticMarkup(<ServiceReport order={order} technicians={technicians} signature={revised} />)).toContain('<small class="sr-sign-revised">Firmado antes de la corrección del reporte del 15/10/2026 a las 09:15</small>');
    const unavailable = renderToStaticMarkup(<ServiceReport order={order} technicians={technicians} signature={null} signatureUnavailable />);
    expect(unavailable).toContain('class="sr-line"');
    expect(unavailable).toContain('Firma digital no disponible al generar este reporte.');
    expect(renderToStaticMarkup(<ServiceReport order={order} technicians={technicians} signature={null} />)).not.toContain('Firma digital no disponible');
  });

  it('sin acceso a los nombres de los técnicos (cliente) no dice que la orden no tiene técnico', () => {
    const html = renderToStaticMarkup(<ServiceReport order={order} equipment={equipment} technicians={[]} />);
    expect(html).toContain('Técnico de Expertos en Montacargas, S.A.');
    expect(html).not.toContain('Sin técnico asignado');
  });
});
