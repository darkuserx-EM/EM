import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PenLine } from 'lucide-react';
import { Badge, Button } from '../../components/design-system';
import { ErrorNotice } from '../../components/ui';
import { serverMode } from '../../data/source';
import { SignaturePad, SignatureSummary } from './SignaturePad';
import { signerOrEmpty } from './signature';
import { saveSignature, useOrderSignature } from './signature-api';

/**
 * «Recibido por» en «Pruebas y cierre»: el nombre (children, el campo del formulario) y la firma en pantalla.
 * La firma se guarda al confirmarla, como las evidencias: no depende de «Guardar avance».
 * Si la orden ya está completada (corrección), pide el motivo para la bitácora.
 */
export function ReceiverSignature({ orderId, signer, editable, completed = false, onBusy, onPending, children }: { orderId?: string; signer: string; editable: boolean; completed?: boolean; onBusy?: (busy: boolean) => void; onPending?: (pending: boolean) => void; children?: ReactNode }) {
  const current = useOrderSignature(orderId);
  const [capturing, setCapturing] = useState(false); const [busy, setBusy] = useState(false); const [drawn, setDrawn] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [reason, setReason] = useState('');
  const attempt = useRef(crypto.randomUUID());
  const name = signerOrEmpty(signer);
  useEffect(() => { onPending?.(capturing && drawn); }, [capturing, drawn, onPending]);
  function start() {
    setMessage('');
    if (!name) { setError('Escribe arriba el nombre de quien recibe el servicio para pedir su firma.'); return; }
    setError(''); setDrawn(false); attempt.current = crypto.randomUUID(); setCapturing(true);
  }
  function stop() { setCapturing(false); setDrawn(false); setError(''); }
  async function confirm(base64: string) {
    if (!orderId || busy) return;
    if (!name) { setError('Escribe arriba el nombre de quien recibe el servicio.'); return; }
    if (completed && (reason.trim().length < 8 || reason.trim().length > 500)) { setError('Explica el motivo de la firma posterior al cierre (8 a 500 caracteres).'); return; }
    setBusy(true); onBusy?.(true); setError('');
    try {
      const saved = await saveSignature(orderId, { signer: name, base64, requestId: attempt.current, ...(completed ? { reason } : {}) });
      current.saved(saved); setCapturing(false); setDrawn(false); setReason(''); attempt.current = crypto.randomUUID();
      setMessage(`Firma de ${saved.signer} guardada en la orden.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la firma. Vuelve a intentarlo.'); }
    finally { setBusy(false); onBusy?.(false); }
  }
  return <fieldset className="receiver-signature os-span">
    <legend>Recibido por</legend>
    {children}
    {!serverMode ? <p className="os-help">La firma en pantalla requiere una cuenta en el servidor. El reporte impreso conserva la línea para firmar a mano.</p>
      : !orderId ? <p className="os-help">Pulsa «Iniciar atención» para registrar la orden; después podrás pedir la firma aquí.</p>
      : <>
        <ErrorNotice message={current.error} />
        {current.signature ? <SignatureSummary signature={current.signature} /> : current.ready && !capturing && <p className="receiver-signature-pending"><Badge tone="warning">Firma pendiente</Badge><span>Si quien recibe no puede firmar en la pantalla, la firma queda pendiente y el reporte impreso conserva la línea para firmar a mano.</span></p>}
        {capturing ? <>
          {completed && <label className="os-field">Motivo de la firma posterior al cierre *<textarea maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /><small>Queda en el historial de la orden, junto con quién capturó la firma.</small></label>}
          <SignaturePad signer={name || signer} busy={busy} onConfirm={base64 => void confirm(base64)} onCancel={stop} onChange={value => { setDrawn(value); setError(''); attempt.current = crypto.randomUUID(); }} onError={setError} />
          <ErrorNotice message={error} />
        </> : <>
          <ErrorNotice message={error} />
          {editable && current.ready && <Button icon={<PenLine size={16} />} onClick={start}>{current.signature ? 'Volver a firmar' : 'Pedir firma'}</Button>}
        </>}
        <p className="os-help" role="status">{message}</p>
      </>}
  </fieldset>;
}
