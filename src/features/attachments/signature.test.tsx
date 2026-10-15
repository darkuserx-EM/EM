import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { exportScale, inkLength, MIN_INK, signatureUrl, signedLabel, signerOrEmpty, strokeBounds } from './signature';
import { SignaturePad, SignatureSummary } from './SignaturePad';

const signature = { id: 'firma 1', signer: 'Persona de prueba', signedAt: Date.parse('2026-10-13T17:50:00.000Z') };

describe('firma de quien recibe · cálculos', () => {
  it('mide el trazo: un toque suelto no es una firma', () => {
    expect(inkLength([[{ x: 10, y: 10 }]])).toBe(0);
    expect(inkLength([[{ x: 0, y: 0 }, { x: 3, y: 4 }], [{ x: 10, y: 10 }, { x: 10, y: 40 }]])).toBe(35);
    expect(inkLength([[{ x: 0, y: 0 }, { x: 20, y: 0 }]])).toBeLessThan(MIN_INK);
  });

  it('recorta la firma a sus trazos con margen, sin salir del recuadro', () => {
    expect(strokeBounds([], 8, 300, 200)).toBeNull();
    expect(strokeBounds([[{ x: 50, y: 60 }, { x: 150, y: 90 }], [{ x: 120, y: 40 }]], 8, 300, 200)).toEqual({ x: 42, y: 32, width: 116, height: 66 });
    expect(strokeBounds([[{ x: 2, y: 195 }, { x: 299, y: 198 }]], 8, 300, 200)).toEqual({ x: 0, y: 187, width: 300, height: 13 });
  });

  it('guarda la imagen nítida pero liviana: hasta 2× y como máximo 800 × 300 px', () => {
    expect(exportScale({ width: 200, height: 80 })).toBe(2);
    expect(exportScale({ width: 800, height: 100 })).toBe(1);
    expect(exportScale({ width: 300, height: 600 })).toBe(0.5);
  });

  it('nombre en una línea, fecha y hora de Guatemala y dirección privada de la imagen', () => {
    expect(signerOrEmpty('  Persona \n de   prueba ')).toBe('Persona de prueba');
    expect(signerOrEmpty('A')).toBe('');
    expect(signedLabel(signature)).toBe('Firmado el 13/10/2026 a las 11:50');
    expect(signatureUrl(signature)).toBe('/api/attachments/firma%201/file');
  });
});

describe('firma de quien recibe · componentes', () => {
  it('el recuadro explica cómo firmar y la alternativa, con Borrar, Cancelar y Confirmar', () => {
    const html = renderToStaticMarkup(<SignaturePad signer="Persona de prueba" onConfirm={() => {}} onCancel={() => {}} />);
    expect(html).toMatch(/<canvas role="img" aria-label="Recuadro de firma de Persona de prueba" aria-describedby="[^"]+-ayuda"/);
    expect(html).toContain('firme con el dedo dentro del recuadro');
    expect(html).toContain('la firma queda pendiente y el reporte impreso conserva la línea para firmar a mano');
    // Borrar empieza desactivado: aún no hay trazos. Confirmar avisa si falta la firma en lugar de quedar desactivado.
    expect(html).toMatch(/<button type="button" class="button" disabled="">.*Borrar<\/button>/);
    expect(html).toContain('>Cancelar</button>');
    expect(html).toMatch(/<button type="button" class="button button-dark">.*Confirmar firma<\/button>/);
  });

  it('mientras se guarda, los botones quedan desactivados y lo dicen', () => {
    const html = renderToStaticMarkup(<SignaturePad signer="Persona de prueba" busy onConfirm={() => {}} onCancel={() => {}} />);
    expect(html).toContain('Guardando firma…');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });

  it('la firma guardada muestra imagen, nombre, fecha y quién la capturó solo si viene del servidor', () => {
    const staff = renderToStaticMarkup(<SignatureSummary signature={{ ...signature, capturedBy: 'Técnico de prueba' }} />);
    expect(staff).toContain('<img src="/api/attachments/firma%201/file" alt="Firma de Persona de prueba"/>');
    expect(staff).toContain('Firmado el 13/10/2026 a las 11:50 · Capturada por Técnico de prueba');
    expect(renderToStaticMarkup(<SignatureSummary signature={signature} />)).not.toContain('Capturada por');
  });
});
