import { useRef, useState, type ChangeEvent } from 'react';
import { Building2, Upload, X } from 'lucide-react';
import { MAX_CLIENT_LOGO_LENGTH, validClientLogo } from '../../domain/client-profile';

export function ClientLogo({ value, name, small = false }: { value?: unknown; name: string; small?: boolean }) {
  return <span className={`client-logo${small ? ' client-logo-small' : ''}`}>{typeof value === 'string' && value && validClientLogo(value) ? <img src={value} alt={`Logo de ${name}`} /> : <Building2 size={small ? 20 : 30} aria-hidden="true" />}</span>;
}

async function prepareLogo(file: File): Promise<string> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Selecciona una imagen PNG, JPG o WebP.');
  if (file.size > 5 * 1024 * 1024) throw new Error('La imagen debe pesar como máximo 5 MB.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('No se pudo abrir la imagen. Prueba con otro archivo.'); });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error('La imagen es demasiado grande. Usa una versión más pequeña.');
    const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar el logo en este navegador.');
    for (const size of [384,320,256,192,128]) {
      const scale = Math.min(1,size / Math.max(bitmap.width,bitmap.height));
      canvas.width = Math.max(1,Math.round(bitmap.width * scale)); canvas.height = Math.max(1,Math.round(bitmap.height * scale));
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      for (const quality of [0.9,0.75,0.6]) {
        const value = canvas.toDataURL('image/webp',quality);
        if (value.length <= MAX_CLIENT_LOGO_LENGTH && validClientLogo(value)) return value;
      }
    }
    throw new Error('El logo contiene demasiado detalle. Usa una imagen más sencilla.');
  } finally { bitmap.close(); }
}

export function ClientLogoField({ value, onChange, disabled, onBusy }: { value: string; onChange: (value: string) => void; disabled: boolean; onBusy: (value: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null); const [error,setError] = useState('');
  async function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setError(''); onBusy(true);
    try { onChange(await prepareLogo(file)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el logo.'); }
    finally { onBusy(false); event.target.value = ''; }
  }
  return <div className="client-logo-field"><ClientLogo value={value} name="la empresa" /><div><strong>Logo de la empresa</strong><p>PNG, JPG o WebP · hasta 5 MB. Se ajustará para el portal.</p><div className="client-logo-actions"><button type="button" className="button button-small" disabled={disabled} onClick={() => input.current?.click()}><Upload size={15} />{value ? 'Cambiar logo' : 'Subir logo'}</button>{value && <button type="button" className="button button-small" disabled={disabled} onClick={() => onChange('')}><X size={15} />Quitar</button>}</div><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" aria-label="Archivo del logo de la empresa" disabled={disabled} onChange={select} />{error && <p className="text-red" role="alert">{error}</p>}</div></div>;
}
