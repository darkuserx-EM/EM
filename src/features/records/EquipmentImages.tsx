import { useRef, useState, type ChangeEvent } from 'react';
import { Camera, Forklift, Maximize2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { EntityRecord } from '../../domain/model';
import { equipmentViewFields, equipmentReferenceFields, equipmentImageLabels, equipmentImageSource, type EquipmentImageField } from '../../domain/equipment-images';
import { prepareEquipmentImage } from './equipment-image-upload';
import { Modal } from '../../components/ui';
import './equipment-images.css';

export function EquipmentPhoto({ equipment, large = false }: { equipment: Partial<EntityRecord>; large?: boolean }) {
  const src = equipmentImageSource(equipment, 'foto_equipo', true);
  return <span className={`equipment-photo${large ? ' equipment-photo-large' : ''}`}>{src ? <img loading="lazy" decoding="async" src={src} alt={`Imagen de referencia del equipo ${equipment.codigo || ''}`} /> : <Forklift size={large ? 38 : 23} strokeWidth={1.4} aria-hidden="true" />}</span>;
}

function ImageViewer({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  return <Modal title={title} onClose={onClose} wide><div className="equipment-image-viewer-actions"><button className="button button-small" onClick={() => setZoom(!zoom)}>{zoom ? <ZoomOut size={16} /> : <ZoomIn size={16} />}{zoom ? 'Ajustar a la ventana' : 'Ampliar imagen'}</button></div><div className={`equipment-image-viewer${zoom ? ' is-zoomed' : ''}`}><img loading="lazy" decoding="async" src={src} alt={title} /></div></Modal>;
}

export function EquipmentImagesField({ equipment, disabled, onChange, onBusy, section }: { equipment: Partial<EntityRecord>; disabled: boolean; onChange: (field: EquipmentImageField, value: string) => void; onBusy: (busy: boolean) => void; section?: 'reference' | 'views' }) {
  return <>
    {section !== 'views' && <fieldset className="record-section"><legend>Imagen de referencia y placa</legend><p className="equipment-image-help">La imagen de referencia sirve como guía del tipo de equipo y aparece en su ficha. En la placa deben leerse la serie y las especificaciones.</p><div className="equipment-images-grid">{equipmentReferenceFields.map(field => <ImageField key={field} field={field} equipment={equipment} disabled={disabled} onChange={value => onChange(field, value)} onBusy={onBusy} />)}</div></fieldset>}
    {section !== 'reference' && <fieldset className="record-section"><legend>Fotografías del equipo</legend><p className="equipment-image-help">Agrega las cuatro vistas del equipo real para visualizar sus aditamentos y daños. Mantén el mismo lado como lateral 1 en futuras fotografías.</p><div className="equipment-images-grid">{equipmentViewFields.map(field => <ImageField key={field} field={field} equipment={equipment} disabled={disabled} onChange={value => onChange(field, value)} onBusy={onBusy} />)}</div><p className="equipment-image-help">Todos los campos de imagen son opcionales. Los cambios se guardan al pulsar Guardar equipo.</p></fieldset>}
  </>;
}
function ImageField({ field, equipment, disabled, onChange, onBusy }: { field: EquipmentImageField; equipment: Partial<EntityRecord>; disabled: boolean; onChange: (value: string) => void; onBusy: (value: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null); const [error, setError] = useState(''); const [processing, setProcessing] = useState(false);
  const src = equipmentImageSource(equipment, field, true); const label = equipmentImageLabels[field];
  async function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setError(''); setProcessing(true); onBusy(true);
    try { onChange(await prepareEquipmentImage(file, field)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar la imagen.'); }
    finally { setProcessing(false); onBusy(false); event.target.value = ''; }
  }
  return <div className="equipment-image-field"><div className="equipment-image-preview">{src ? <img loading="lazy" decoding="async" src={src} alt={label} /> : <Camera size={32} aria-hidden="true" />}</div><strong>{label}</strong><p>PNG, JPG o WebP · hasta 10 MB. Las imágenes grandes se ajustan.</p><div className="equipment-image-actions"><button type="button" className="button button-small" disabled={disabled || processing} onClick={() => input.current?.click()}><Upload size={15} />{processing ? 'Preparando…' : src ? `Cambiar ${label.toLowerCase()}` : `Subir ${label.toLowerCase()}`}</button>{src && <button type="button" className="icon-button" disabled={disabled || processing} aria-label={`Quitar ${label.toLowerCase()}`} onClick={() => onChange('')}><X size={16} /></button>}</div><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" aria-label={`Archivo: ${label.toLowerCase()}`} disabled={disabled || processing} onChange={select} />{error && <p className="text-red" role="alert">{error}</p>}</div>;
}
export function EquipmentImageGallery({ equipment, onEdit }: { equipment: EntityRecord; onEdit?: () => void }) {
  const [view, setView] = useState<EquipmentImageField | null>(null);
  const card = (field: EquipmentImageField) => {
    const src = equipmentImageSource(equipment, field, true); const label = equipmentImageLabels[field];
    return src ? <button key={field} type="button" className="equipment-gallery-item" aria-label={`Ampliar ${label.toLowerCase()}`} onClick={() => setView(field)}><img loading="lazy" decoding="async" src={src} alt={label} /><span>{label}<Maximize2 size={16} /></span></button> : <div key={field} className="equipment-gallery-item equipment-gallery-empty"><div className="equipment-gallery-placeholder"><Camera size={28} aria-hidden="true" /><small>Sin imagen registrada</small></div><span>{label}</span></div>;
  };
  return <section className="panel equipment-gallery">
    <div className="equipment-gallery-heading"><div><h2>Fotografías del equipo</h2><p className="equipment-image-help">Vistas del equipo real para revisar aditamentos y daños visibles.</p></div>{onEdit && <button type="button" className="button button-small" onClick={onEdit}><Upload size={15} />Agregar o cambiar fotos</button>}</div>
    <div className="equipment-images-grid">{equipmentViewFields.map(card)}</div>
    <div className="equipment-gallery-reference"><h2>Imagen de referencia y placa</h2><p className="equipment-image-help">La imagen de referencia identifica el tipo de equipo. La placa contiene sus datos de fábrica.</p><div className="equipment-images-grid">{equipmentReferenceFields.map(card)}</div></div>
    {view && <ImageViewer src={equipmentImageSource(equipment, view)} title={`${equipmentImageLabels[view]} · ${equipment.codigo}`} onClose={() => setView(null)} />}
  </section>;
}
