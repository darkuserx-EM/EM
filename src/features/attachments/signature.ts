import { formatDate, formatTime } from '../../domain/format';

/**
 * Firma de quien recibe el servicio, como la devuelve el servidor (server/signatures.mjs). `capturedBy` no llega al cliente.
 * `revisedAt`: una corrección o reapertura posterior al cierre cambió el reporte después de la firma.
 */
export type Signature = { id: string; signer: string; signedAt: number; revisedAt?: number; capturedBy?: string };
export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };

/** La imagen se sirve como cualquier adjunto privado de la orden: el servidor revisa el acceso a la orden. */
export const signatureUrl = (signature: Pick<Signature, 'id'>) => `/api/attachments/${encodeURIComponent(signature.id)}/file`;
/** «Firmado el 15/10/2026 a las 10:42», en hora de Guatemala. */
export function signedLabel(signature: Pick<Signature, 'signedAt'>) {
  const iso = new Date(signature.signedAt).toISOString();
  return `Firmado el ${formatDate(iso)} a las ${formatTime(iso)}`;
}
/** «Firmado antes de la corrección del reporte del 16/10/2026 a las 09:15», o vacío si el reporte no cambió después de la firma. */
export function revisedLabel(signature: Pick<Signature, 'revisedAt'>) {
  if (!signature.revisedAt) return '';
  const iso = new Date(signature.revisedAt).toISOString();
  return `Firmado antes de la corrección del reporte del ${formatDate(iso)} a las ${formatTime(iso)}`;
}
/** Nombre de quien firma, en una línea, o vacío si es muy corto para identificar a alguien. */
export function signerOrEmpty(value: string) {
  const name = value.replace(/\s+/g, ' ').trim();
  return name.length >= 2 && name.length <= 120 ? name : '';
}

/** Largo del trazo en píxeles: un toque suelto no cuenta como firma. */
export function inkLength(strokes: Point[][]) {
  return strokes.reduce((total, stroke) => total + stroke.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - stroke[index].x, point.y - stroke[index].y), 0), 0);
}
export const MIN_INK = 30;

/** Rectángulo que contiene los trazos, con margen y dentro del recuadro: la imagen guardada no lleva espacio en blanco. */
export function strokeBounds(strokes: Point[][], margin: number, width: number, height: number): Bounds | null {
  const points = strokes.flat();
  if (!points.length) return null;
  const box = points.reduce((acc, point) => ({ left: Math.min(acc.left, point.x), top: Math.min(acc.top, point.y), right: Math.max(acc.right, point.x), bottom: Math.max(acc.bottom, point.y) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const x = Math.max(0, box.left - margin), y = Math.max(0, box.top - margin);
  return { x, y, width: Math.max(1, Math.min(width, box.right + margin) - x), height: Math.max(1, Math.min(height, box.bottom + margin) - y) };
}
/**
 * Trazos al cambiar el tamaño del recuadro (por ejemplo, al girar el teléfono): se escalan igual en ambos ejes,
 * para que la firma no se deforme y quepa completa en el recuadro nuevo.
 */
export function fitStrokes(strokes: Point[][], from: Pick<Bounds, 'width' | 'height'>, to: Pick<Bounds, 'width' | 'height'>) {
  if (!from.width || !from.height || !to.width || !to.height || from.width === to.width && from.height === to.height) return strokes;
  const scale = Math.min(to.width / from.width, to.height / from.height);
  return strokes.map(stroke => stroke.map(point => ({ x: point.x * scale, y: point.y * scale })));
}
/** Escala de la imagen guardada: nítida (hasta 2×) sin pasar de 800 × 300 px, para que pese pocos KB. */
export const exportScale = (bounds: Pick<Bounds, 'width' | 'height'>) => Math.min(2, 800 / bounds.width, 300 / bounds.height);
