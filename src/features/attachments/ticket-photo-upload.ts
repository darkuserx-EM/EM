import { api } from '../../data/remote';
import { prepareEquipmentImage } from '../records/equipment-image-upload';
import {uploadVideo,videoSelectionError} from './video-upload';

export interface TicketPhotoDraft { id: string; file: File; status: 'pending' | 'uploading' | 'saved' | 'error'; error?: string; base64?: string;progress?:number }
export function photoSelectionError(file: Pick<File, 'type' | 'size' | 'name'>) {
  if(file.type==='video/mp4'){const error=videoSelectionError(file);if(error)return error;}
  else if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return `${file.name}: usa JPG, PNG, WebP o MP4.`;
  if (file.type!=='video/mp4'&&file.size > 10 * 1024 * 1024) return `${file.name}: la fotografía supera 10 MB.`;
  if (!file.size || !file.name.trim() || file.name.length > 160 || /[\x00-\x1f]/.test(file.name)) return 'La fotografía tiene un nombre o contenido inválido.';
  return '';
}
// Stable IDs and prepared bytes survive a lost response. Only unfinished items are retried.
export async function uploadTicketPhotos(ticketId: string, photos: TicketPhotoDraft[], changed: (photo: TicketPhotoDraft) => void,
  dependencies = { prepare: (file: File) => prepareEquipmentImage(file,'placa_datos'), send: (body: object) => api('ticket-attachments',body) }) {
  let failed = 0;
  for (const photo of photos) {
    if (photo.status === 'saved') continue;
    changed({...photo,status:'uploading',error:''});
    try {
      if(photo.file.type==='video/mp4')await uploadVideo(photo.file,photo.id,{ticketId},progress=>changed({...photo,status:'uploading',progress}));
      else {
      photo.base64 ||= (await dependencies.prepare(photo.file)).split(',')[1];
      await dependencies.send({ticketId,requestId:photo.id,name:photo.file.name,base64:photo.base64});
      }
      photo.status = 'saved'; photo.error = ''; changed({...photo});
    } catch (cause) {
      failed++; photo.status = 'error'; photo.error = cause instanceof Error ? cause.message : 'No se pudo subir. Vuelve a intentar.'; changed({...photo});
    }
  }
  return failed;
}
