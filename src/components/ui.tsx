import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, X, AlertCircle, ArrowUpRight, Forklift } from 'lucide-react';
import { useToast } from '../app/state';
import { Badge, BrandMark, statusTone } from './design-system';

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><BrandMark /><div><strong>Portal EM</strong><small>EXPERTOS EN MONTACARGAS</small></div></div>;
}
export function Status({ value }: { value: string }) {
  return <Badge tone={statusTone(value)}>{value}</Badge>;
}
export function Modal({ title, children, onClose, wide = false, className = '' }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null); const closer = useRef(onClose); closer.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closer.current();
      if (event.key === 'Tab') {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? [])
          .filter(item => item.tabIndex >= 0 && item.getClientRects().length > 0 && !item.closest('[hidden]'));
        if (!items?.length) { event.preventDefault(); return; }
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal ${wide ? 'modal-wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Cerrar ventana"><X size={20} /></button></div>{children}</div></div>;
}
/** Asks before closing a form with edits: Escape, the X, the backdrop and Cancel all go through requestClose. */
export function useUnsavedChanges(dirty: boolean, onClose: () => void) {
  const [asking, setAsking] = useState(false);
  const requestClose = () => { if (dirty) setAsking(true); else onClose(); };
  const prompt = asking ? <div className="discard-prompt" role="alertdialog" aria-labelledby="discard-prompt-text"><p id="discard-prompt-text">Hay cambios sin guardar. ¿Quieres descartarlos?</p><div><button type="button" className="button" onClick={() => setAsking(false)} autoFocus>Seguir editando</button><button type="button" className="button button-danger" onClick={onClose}>Descartar cambios</button></div></div> : null;
  return { requestClose, prompt };
}
export function ErrorNotice({ message }: { message: string }) { return message ? <div className="error-notice" role="alert"><AlertCircle size={18} /><span>{message}</span></div> : null; }
export function Toast() {
  const { message, clear } = useToast();
  useEffect(() => { if (!message) return; const id = setTimeout(clear, 6500); return () => clearTimeout(id); }, [message, clear]);
  return message ? <div className="toast" role="status"><Check size={19} /><span>{message}</span><button onClick={clear} aria-label="Cerrar aviso"><X size={16} /></button></div> : null;
}
export function SectionTitle({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description: string; children?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div>{children && <div className="heading-actions">{children}</div>}</div>;
}
export function EmptyState({ title, description, illustration }: { title: string; description: string; illustration?: ReactNode }) { return <div className="empty-state">{illustration ? <div className="empty-illustration">{illustration}</div> : <div className="empty-icon"><Forklift size={30} /></div>}<h3>{title}</h3><p>{description}</p></div>; }
export function CardArrow() { return <ArrowUpRight size={17} aria-hidden="true" />; }
export function ForkliftArt() {
  return <svg className="forklift-art" viewBox="0 0 500 290" fill="none" aria-hidden="true">
    <defs><linearGradient id="truck" x1="100" y1="170" x2="320" y2="250" gradientUnits="userSpaceOnUse"><stop stopColor="#666960"/><stop offset="1" stopColor="#33362f"/></linearGradient><linearGradient id="mast" x1="340" x2="360"><stop stopColor="#b8b8ad"/><stop offset="1" stopColor="#898b80"/></linearGradient></defs>
    <path d="M25 254H474M370 42V265M60 208H477" stroke="#d8d7cc" strokeDasharray="4 7"/>
    <ellipse cx="249" cy="253" rx="189" ry="16" fill="#deded3"/>
    <path d="M86 180L120 159H228L275 198V240H78V193L86 180Z" fill="url(#truck)"/>
    <path d="M88 181H177V215H78V194L88 181Z" fill="#85887c"/>
    <path d="M104 182H160M101 190H160M98 198H160" stroke="#a9ac9f" strokeWidth="3"/>
    <path d="M180 165V86H292V215" stroke="#464a40" strokeWidth="9"/>
    <path d="M170 83L184 74H303L300 90H170V83Z" fill="#35392f"/>
    <path d="M190 89V159M283 90V166" stroke="#b2b5a6" strokeWidth="3"/>
    <path d="M235 137H217V170H250" stroke="#32382e" strokeWidth="14" strokeLinejoin="round"/>
    <path d="M257 159L273 138M264 129L280 143" stroke="#4c5345" strokeWidth="5" strokeLinecap="round"/>
    <path d="M192 179H272V218H192V179Z" fill="#6f7466"/>
    <rect x="200" y="187" width="63" height="5" rx="2" fill="#f58220"/>
    <path d="M266 225H311V236H266" fill="#35392f"/>
    <path d="M308 61H325V245H308V61Z" fill="#53594b"/>
    <path d="M331 50H344V244H331V50Z" fill="url(#mast)"/>
    <path d="M316 91H338M316 128H338M316 165H338M316 203H338" stroke="#8c9283" strokeWidth="5"/>
    <path d="M350 163V233H433" stroke="#717866" strokeWidth="9" strokeLinejoin="round"/>
    <path d="M349 182H369V194H349" fill="#f58220"/>
    <circle cx="121" cy="235" r="30" fill="#2d3129"/><circle cx="121" cy="235" r="17" fill="#8b9180"/><circle cx="121" cy="235" r="7" fill="#d3d5c9"/>
    <circle cx="264" cy="231" r="37" fill="#2d3129"/><circle cx="264" cy="231" r="22" fill="#9b9f90"/><circle cx="264" cy="231" r="10" fill="#d8dacf"/>
    <path d="M379 166H456V227H379V166Z" fill="#c7baa1"/><path d="M383 168H451V177H383M388 183V215M408 183V215M429 183V215M449 183V215" stroke="#ab9b7e" strokeWidth="3"/><path d="M375 228H462" stroke="#a09177" strokeWidth="8"/>
    <path d="M304 40H349M353 49V156" stroke="#a7ad9c" strokeWidth="1"/><circle cx="354" cy="42" r="3" fill="#f58220"/>
    <text x="60" y="51" fontSize="10" fill="#8b917d" letterSpacing="2">EM / GESTIÓN DE FLOTA</text>
  </svg>;
}
