import { validEquipmentImage, type EquipmentImageField } from '../../domain/equipment-images';

// Only new uploads use this target. Existing images retain the legacy server limit.
export const UPLOAD_IMAGE_TARGET = 1_500_000;
const readDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
  reader.readAsDataURL(file);
});

export async function prepareEquipmentImage(file: File, field: EquipmentImageField) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Selecciona una imagen PNG, JPG o WebP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('La imagen debe pesar como máximo 10 MB.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('No se pudo abrir la imagen. Prueba con otro archivo.'); });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error('La resolución es demasiado grande. Usa una imagen de hasta 40 megapíxeles.');
    const maxSide = field === 'placa_datos' ? 2400 : field === 'foto_equipo' ? 1600 : 2000;
    const qualities = field === 'placa_datos' ? [0.90, 0.86] : [0.84, 0.78];
    // Keep an already compact original if re-encoding would make it larger.
    const original = Math.max(bitmap.width, bitmap.height) <= maxSide && file.size * 4 / 3 + 32 <= UPLOAD_IMAGE_TARGET ? await readDataUrl(file) : '';
    const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la imagen en este navegador.');
    for (const limit of [maxSide, Math.round(maxSide * 0.8)]) {
      const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of qualities) {
        const result = canvas.toDataURL('image/webp', quality);
        if (result.length <= UPLOAD_IMAGE_TARGET && validEquipmentImage(result)) {
          return original && original.length <= result.length && validEquipmentImage(original) ? original : result;
        }
      }
    }
    if (original && validEquipmentImage(original)) return original;
    throw new Error('No se pudo ajustar esta imagen. Prueba con una fotografía más ligera y bien enfocada.');
  } finally { bitmap.close(); }
}
