import { useEffect, useState } from 'react';
import { api } from '../../data/remote';
import { serverMode } from '../../data/source';
import type { Signature } from './signature';

const path = (orderId: string) => `orders/${encodeURIComponent(orderId)}/signature`;

/** Guarda la firma de quien recibe. Reintentar con el mismo `requestId` no la duplica. */
export async function saveSignature(orderId: string, body: { signer: string; base64: string; requestId: string; reason?: string }) {
  return (await api<{ signature: Signature }>(path(orderId), body)).signature;
}

/**
 * Última firma de la orden. Sin servidor (demostración local) no hay firmas.
 * `ready` y `signature` corresponden siempre a `orderId`: al cambiar de orden no se ve, ni se imprime, la firma de la anterior.
 */
export function useOrderSignature(orderId?: string) {
  const [state, setState] = useState<{ id?: string; signature: Signature | null; error: string; ready: boolean }>({ id: orderId, signature: null, error: '', ready: !orderId || !serverMode });
  useEffect(() => {
    let active = true;
    if (!orderId || !serverMode) { setState({ id: orderId, signature: null, error: '', ready: true }); return; }
    setState({ id: orderId, signature: null, error: '', ready: false });
    api<{ signature: Signature | null }>(path(orderId))
      .then(result => { if (active) setState({ id: orderId, signature: result.signature, error: '', ready: true }); })
      .catch(cause => { if (active) setState({ id: orderId, signature: null, error: cause instanceof Error ? cause.message : 'No se pudo cargar la firma.', ready: true }); });
    return () => { active = false; };
  }, [orderId]);
  const current = state.id === orderId;
  return { signature: current ? state.signature : null, error: current ? state.error : '', ready: current && state.ready, saved: (signature: Signature) => setState({ id: orderId, signature, error: '', ready: true }) };
}
