import { afterEach, expect, it, vi } from 'vitest';
import { prepareEquipmentImage, UPLOAD_IMAGE_TARGET } from './equipment-image-upload';

const webp = 'data:image/webp;base64,' + btoa('RIFF\0\0\0\0WEBPsynthetic');
const photo = () => new File([new Uint8Array(2_000_000)], 'photo.png', { type: 'image/png' });
function browser(width: number, height: number, encoded = webp) {
  const bitmap = { width, height, close: vi.fn() };
  const context = { drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: vi.fn(() => encoded) };
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
  vi.stubGlobal('document', { createElement: () => canvas });
  return { bitmap, canvas };
}
afterEach(() => vi.unstubAllGlobals());

it('reduces new uploads, retains more plate detail and keeps the aspect ratio', async () => {
  const { bitmap, canvas } = browser(4000, 3000);
  expect(await prepareEquipmentImage(photo(), 'placa_datos')).toBe(webp);
  expect([canvas.width, canvas.height]).toEqual([2400, 1800]);
  expect(bitmap.close).toHaveBeenCalledOnce();
  await prepareEquipmentImage(photo(), 'foto_frontal');
  expect([canvas.width, canvas.height]).toEqual([2000, 1500]);
  await prepareEquipmentImage(photo(), 'foto_equipo');
  expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
});

it('does not enlarge small images and rejects oversized results while releasing decoded memory', async () => {
  const { canvas } = browser(600, 400);
  await prepareEquipmentImage(photo(), 'placa_datos');
  expect([canvas.width, canvas.height]).toEqual([600, 400]);
  const oversized = browser(4000, 3000, 'x'.repeat(UPLOAD_IMAGE_TARGET + 1));
  await expect(prepareEquipmentImage(photo(), 'foto_trasera')).rejects.toThrow('No se pudo ajustar');
  expect(oversized.bitmap.close).toHaveBeenCalledOnce();
});

it('rejects invalid files and excessive decoded resolution', async () => {
  const { bitmap } = browser(8000, 6000);
  await expect(prepareEquipmentImage(photo(), 'placa_datos')).rejects.toThrow('40 megapíxeles');
  expect(bitmap.close).toHaveBeenCalledOnce();
  await expect(prepareEquipmentImage(new File(['text'], 'file.txt', { type: 'text/plain' }), 'foto_equipo')).rejects.toThrow('PNG, JPG o WebP');
});
