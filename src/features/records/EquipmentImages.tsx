import { useRef, useState, type ChangeEvent } from 'react';
import { Camera, Forklift, Maximize2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { EntityRecord } from '../../domain/model';
import { equipmentImageFields, equipmentImageLabels, equipmentImageSource, MAX_EQUIPMENT_IMAGE_LENGTH, validEquipmentImage, type EquipmentImageField } from '../../domain/equipment-images';
import { EmptyState, Modal } from '../../components/ui';
import './equipment-images.css';

const readDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('No se pudo leer la imagen.')); reader.readAsDataURL(file);
});
async function prepareImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Selecciona una imagen PNG, JPG o WebP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('La imagen debe pesar como máximo 10 MB.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('No se pudo abrir la imagen. Prueba con otro archivo.'); });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error('La resolución es demasiado grande. Usa una imagen de hasta 40 megapíxeles.');
    const original = await readDataUrl(file);
    if (validEquipmentImage(original)) return original;
    const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la imagen en este navegador.');
    for (const limit of [2800, 2200, 1800]) {
      const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.94, 0.86]) {
        const result = canvas.toDataURL('image/webp', quality);
        if (result.length <= MAX_EQUIPMENT_IMAGE_LENGTH && validEquipmentImage(result)) return result;
      }
    }
    throw new Error('No se pudo ajustar esta imagen. Prueba con una fotografía más ligera.');
  } finally { bitmap.close(); }
}

export function EquipmentPhoto({ equipment, large = false }: { equipment: Partial<EntityRecord>; large?: boolean }) {
  const src = equipmentImageSource(equipment, 'foto_equipo');
  return <span className={`equipment-photo${large ? ' equipment-photo-large' : ''}`}>{src ? <img src={src} alt={`Foto del equipo ${equipment.codigo || ''}`} /> : <Forklift size={large ? 38 : 23} strokeWidth={1.4} aria-hidden="true" />}</span>;
}

function ImageViewer({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  return <Modal title={title} onClose={onClose} wide><div className="equipment-image-viewer-actions"><button className="button button-small" onClick={() => setZoom(!zoom)}>{zoom ? <ZoomOut size={16} /> : <ZoomIn size={16} />}{zoom ? 'Ajustar a la ventana' : 'Ampliar imagen'}</button></div><div className={`equipment-image-viewer${zoom ? ' is-zoomed' : ''}`}><img src={src} alt={title} /></div></Modal>;
}

export function EquipmentImagesField({ equipment, disabled, onChange, onBusy }: { equipment: Partial<EntityRecord>; disabled: boolean; onChange: (field: EquipmentImageField, value: string) => void; onBusy: (busy: boolean) => void }) {
  return <fieldset className="record-section"><legend>Fotografías del equipo</legend><div className="equipment-images-grid">{equipmentImageFields.map(field => <ImageField key={field} field={field} equipment={equipment} disabled={disabled} onChange={value => onChange(field, value)} onBusy={onBusy} />)}</div><p className="equipment-image-help">Las imágenes se guardan al pulsar Guardar equipo. Para la placa, revisa que la serie y las especificaciones se lean con claridad.</p></fieldset>;
}
function ImageField({ field, equipment, disabled, onChange, onBusy }: { field: EquipmentImageField; equipment: Partial<EntityRecord>; disabled: boolean; onChange: (value: string) => void; onBusy: (value: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null); const [error, setError] = useState(''); const [processing, setProcessing] = useState(false);
  const src = equipmentImageSource(equipment, field); const label = equipmentImageLabels[field];
  async function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setError(''); setProcessing(true); onBusy(true);
    try { onChange(await prepareImage(file)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar la imagen.'); }
    finally { setProcessing(false); onBusy(false); event.target.value = ''; }
  }
  return <div className="equipment-image-field"><div className="equipment-image-preview">{src ? <img src={src} alt={label} /> : <Camera size={32} aria-hidden="true" />}</div><strong>{label}</strong><p>PNG, JPG o WebP · hasta 10 MB. Las imágenes grandes se ajustan.</p><div className="equipment-image-actions"><button type="button" className="button button-small" disabled={disabled || processing} onClick={() => input.current?.click()}><Upload size={15} />{processing ? 'Preparando…' : src ? `Cambiar ${label.toLowerCase()}` : `Subir ${label.toLowerCase()}`}</button>{src && <button type="button" className="icon-button" disabled={disabled || processing} aria-label={`Quitar ${label.toLowerCase()}`} onClick={() => onChange('')}><X size={16} /></button>}</div><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" aria-label={`Archivo: ${label.toLowerCase()}`} disabled={disabled || processing} onChange={select} />{error && <p className="text-red" role="alert">{error}</p>}</div>;
}
export function EquipmentImageGallery({ equipment }: { equipment: EntityRecord }) {
  const [view, setView] = useState<EquipmentImageField | null>(null);
  const available = equipmentImageFields.filter(field => equipmentImageSource(equipment, field));
  if (!available.length) return <section className="panel"><EmptyState title="Sin fotografías registradas" description="Las fotografías del equipo y de su placa se agregan desde Editar equipo." /></section>;
  return <section className="panel equipment-gallery"><h2>Fotografías y placa</h2><div className="equipment-images-grid">{available.map(field => <button key={field} className="equipment-gallery-item" onClick={() => setView(field)}><img src={equipmentImageSource(equipment, field)} alt={equipmentImageLabels[field]} /><span>{equipmentImageLabels[field]}<Maximize2 size={16} /></span></button>)}</div>{view && <ImageViewer src={equipmentImageSource(equipment, view)} title={`${equipmentImageLabels[view]} · ${equipment.codigo}`} onClose={() => setView(null)} />}</section>;
}
