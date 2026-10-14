import { describe, expect, it, vi } from 'vitest';
vi.mock('../../data/remote',() => ({api:vi.fn(),videoChunk:vi.fn()}));
import { photoSelectionError, uploadTicketPhotos, type TicketPhotoDraft } from './ticket-photo-upload';

const draft = (name:string):TicketPhotoDraft => ({id:crypto.randomUUID(),file:new File(['image'],name,{type:'image/png'}),status:'pending'});
describe('fotografías de solicitudes',() => {
  it('acepta MP4, rechaza archivos vacíos y respeta los límites de foto y video',() => {
    expect(photoSelectionError({name:'video.mp4',type:'video/mp4',size:2000})).toBe('');
    expect(photoSelectionError({name:'video.mp4',type:'video/mp4',size:26*1024*1024})).toContain('25 MB');
    expect(photoSelectionError({name:'foto.png',type:'image/png',size:10*1024*1024+1})).toContain('10 MB');
    expect(photoSelectionError({name:'foto.png',type:'image/png',size:0})).not.toBe('');
    expect(photoSelectionError(draft('foto.png').file)).toBe('');
  });
  it('conserva los IDs y bytes para reintentar solo fotos pendientes tras perder una respuesta',async () => {
    const photos=[draft('a.png'),draft('b.png')],changed=vi.fn();
    const prepare=vi.fn(async (file:File) => 'data:image/webp;base64,'+file.name);
    const send=vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Conexión interrumpida')).mockResolvedValue({});
    expect(await uploadTicketPhotos('ticket-1',photos,changed,{prepare,send})).toBe(1);
    expect(photos.map(row=>row.status)).toEqual(['saved','error']);
    const attempted=send.mock.calls[1][0];
    expect(await uploadTicketPhotos('ticket-1',photos,changed,{prepare,send})).toBe(0);
    expect(send).toHaveBeenCalledTimes(3);expect(send.mock.calls[2][0]).toEqual(attempted);
    expect(prepare).toHaveBeenCalledTimes(2);expect(photos.every(row=>row.status==='saved')).toBe(true);
  });
  it('un error de preparación conserva el archivo y permite continuar con las otras fotos',async () => {
    const photos=[draft('a.png'),draft('b.png')];
    const prepare=vi.fn().mockRejectedValueOnce(new Error('Imagen dañada')).mockResolvedValue('data:image/png;base64,bytes');
    const send=vi.fn().mockResolvedValue({});
    expect(await uploadTicketPhotos('ticket-1',photos,()=>{},{prepare,send})).toBe(1);
    expect(photos[0].error).toBe('Imagen dañada');expect(photos[0].file.name).toBe('a.png');expect(send).toHaveBeenCalledTimes(1);
  });
});
