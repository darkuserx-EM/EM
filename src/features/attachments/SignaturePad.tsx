import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Check, Eraser } from 'lucide-react';
import { Button } from '../../components/design-system';
import { exportScale, inkLength, MIN_INK, signatureUrl, signedLabel, strokeBounds, type Point, type Signature } from './signature';

const LINE = 2.5;
function paint(context: CanvasRenderingContext2D, strokes: Point[][], ink: string) {
  context.lineWidth = LINE; context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = ink; context.fillStyle = ink;
  for (const stroke of strokes) {
    if (stroke.length === 1) { context.beginPath(); context.arc(stroke[0].x, stroke[0].y, LINE / 2, 0, Math.PI * 2); context.fill(); continue; }
    context.beginPath(); context.moveTo(stroke[0].x, stroke[0].y);
    for (const point of stroke.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  }
}

/** Firma guardada: imagen, nombre, fecha y hora; quién la capturó solo para el personal de EMSA (el servidor no lo envía al cliente). */
export function SignatureSummary({ signature }: { signature: Signature }) {
  return <figure className="receiver-signature-current">
    <img src={signatureUrl(signature)} alt={`Firma de ${signature.signer}`} />
    <figcaption><strong>{signature.signer}</strong><small>{signedLabel(signature)}{signature.capturedBy ? ` · Capturada por ${signature.capturedBy}` : ''}</small></figcaption>
  </figure>;
}

/**
 * Recuadro para firmar con el dedo, un lápiz o el mouse. «Confirmar firma» entrega la firma recortada como PNG en base64;
 * si el recuadro está vacío avisa con `onError`. La tinta toma el color de texto del sistema (`color` del lienzo en operations.css).
 */
export function SignaturePad({ signer, busy = false, onConfirm, onCancel, onChange, onError }: { signer: string; busy?: boolean; onConfirm: (base64: string) => void; onCancel: () => void; onChange?: (drawn: boolean) => void; onError?: (message: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null); const strokes = useRef<Point[][]>([]); const pointer = useRef<number | null>(null);
  const [drawn, setDrawn] = useState(false);
  const help = `${useId()}-ayuda`;
  const ink = () => canvas.current ? getComputedStyle(canvas.current).color : '';
  // El lienzo se dibuja a la resolución de la pantalla; al girar el teléfono se vuelve a pintar con los mismos trazos.
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const fit = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 3), rect = element.getBoundingClientRect();
      element.width = Math.round(rect.width * ratio); element.height = Math.round(rect.height * ratio);
      const context = element.getContext('2d'); if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0); paint(context, strokes.current, ink());
    };
    fit(); const observer = new ResizeObserver(fit); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const at = (event: PointerEvent<HTMLCanvasElement>): Point => { const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const changed = (value: boolean) => { setDrawn(value); onChange?.(value); };
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (busy || pointer.current !== null || event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pointer.current = event.pointerId;
    strokes.current.push([at(event)]);
    const context = event.currentTarget.getContext('2d'); if (context) paint(context, [strokes.current[strokes.current.length - 1]], ink());
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== event.pointerId) return;
    const stroke = strokes.current[strokes.current.length - 1]; const from = stroke[stroke.length - 1];
    // Los eventos agrupados conservan la curva del trazo cuando el dedo se mueve rápido.
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? []; const rect = event.currentTarget.getBoundingClientRect();
    const points = samples.length ? samples.map(sample => ({ x: sample.clientX - rect.left, y: sample.clientY - rect.top })) : [at(event)];
    stroke.push(...points);
    const context = event.currentTarget.getContext('2d'); if (context) paint(context, [[from, ...points]], ink());
  }
  function up(event: PointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null; changed(true);
  }
  function clear() {
    strokes.current = []; pointer.current = null;
    const element = canvas.current, context = element?.getContext('2d');
    if (element && context) { context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, element.width, element.height); context.restore(); }
    changed(false);
  }
  function confirm() {
    const element = canvas.current; if (!element || busy) return;
    if (inkLength(strokes.current) < MIN_INK) { onError?.('Falta la firma: pide que firme dentro del recuadro.'); return; }
    const rect = element.getBoundingClientRect(); const bounds = strokeBounds(strokes.current, 8, rect.width, rect.height); if (!bounds) return;
    const scale = exportScale(bounds); const output = document.createElement('canvas');
    output.width = Math.max(40, Math.round(bounds.width * scale)); output.height = Math.max(20, Math.round(bounds.height * scale));
    const context = output.getContext('2d'); if (!context) { onError?.('Este navegador no pudo preparar la imagen de la firma.'); return; }
    context.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale); paint(context, strokes.current, ink());
    onConfirm(output.toDataURL('image/png').split(',')[1]);
  }
  return <div className="signature-pad">
    <p id={help} className="os-help">Pide a <strong>{signer}</strong> que firme con el dedo dentro del recuadro. Si no puede firmar en la pantalla, pulsa «Cancelar»: la firma queda pendiente y el reporte impreso conserva la línea para firmar a mano.</p>
    <div className="signature-box">
      <canvas ref={canvas} role="img" aria-label={`Recuadro de firma de ${signer}`} aria-describedby={help} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} />
      <span className="signature-guide" aria-hidden="true">Firma aquí</span>
    </div>
    <p className="sr-only" role="status">{drawn ? 'Hay una firma en el recuadro. Confírmala o bórrala.' : ''}</p>
    <div className="signature-actions">
      <Button icon={<Eraser size={16} />} onClick={clear} disabled={busy || !drawn}>Borrar</Button>
      <Button onClick={onCancel} disabled={busy}>Cancelar</Button>
      <Button variant="primary" icon={<Check size={16} />} onClick={confirm} disabled={busy}>{busy ? 'Guardando firma…' : 'Confirmar firma'}</Button>
    </div>
  </div>;
}
