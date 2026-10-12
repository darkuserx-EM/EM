import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { entityNames, type Database, type EntityName, type EntityRecord } from '../domain/model';
import { validateDatabase } from '../domain/validation';
import { equipmentImageFields, isEquipmentImageReference } from '../domain/equipment-images';

export interface BackupFile { metadata: Record<string, string | number>; base64: string }
export interface ArchiveEntry { type: string; version?: number; schemaVersion?: number; revision?: number; exportedAt?: string; entity?: EntityName; record?: EntityRecord; file?: BackupFile; counts?: Record<string, number>; sha256?: string }
const utf8 = new TextEncoder();
export async function* archiveLines(file: Blob) {
  const reader = file.stream().pipeThrough(new TextDecoderStream('utf-8', { fatal: true })).getReader(); let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      pending += value; let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (!line || line.length > 6 * 1024 * 1024) throw new Error('El respaldo contiene una línea inválida o demasiado grande.');
        yield { raw: `${line}\n`, entry: JSON.parse(line) as ArchiveEntry };
      }
      if (pending.length > 6 * 1024 * 1024) throw new Error('Una entrada excede el tamaño permitido.');
    }
    if (pending.length) throw new Error('El respaldo está truncado; vuelve a descargarlo.');
  } finally { await reader.cancel(); reader.releaseLock(); }
}
export async function inspectFullBackup(file: Blob) {
  const hash = sha256.create(), counts = { record: 0, media: 0, attachment: 0 };
  let header: ArchiveEntry | undefined, complete = false, recordBytes = 0;
  const entities = Object.fromEntries(entityNames.map(name => [name, [] as EntityRecord[]])) as Database['entities'];
  const photos = new Set<string>(), attachments = new Set<string>();
  const mediaKey = (id: string, field: string, hash: string) => JSON.stringify([id, field, hash]);
  for await (const { raw, entry } of archiveLines(file)) {
    if (complete) throw new Error('Hay contenido después del cierre del respaldo.');
    if (!header) {
      if (entry.type !== 'portal-em.full' || entry.version !== 1 || entry.schemaVersion !== 1 || !Number.isSafeInteger(entry.revision) || !entry.exportedAt || !Number.isFinite(Date.parse(entry.exportedAt))) throw new Error('No es un respaldo completo compatible de Portal EM.');
      header = entry; hash.update(utf8.encode(raw)); continue;
    }
    if (entry.type === 'complete') {
      if (entry.sha256 !== bytesToHex(hash.digest()) || Object.entries(counts).some(([key, value]) => entry.counts?.[key] !== value)) throw new Error('La integridad o el número de registros del respaldo no coincide.');
      complete = true; continue;
    }
    hash.update(utf8.encode(raw));
    if (entry.type === 'record') {
      if (!entry.entity || !entityNames.includes(entry.entity) || !entry.record) throw new Error('Registro desconocido en el respaldo.');
      recordBytes += utf8.encode(raw).length;
      if (recordBytes > 24 * 1024 * 1024) throw new Error('Los registros superan 24 MB. Usa la recuperación de la base desde el alojamiento; las fotografías se recuperan por separado.');
      entities[entry.entity].push(entry.record); counts.record++;
    } else if (entry.type === 'media' || entry.type === 'attachment') {
      const stored = entry.file; const m = stored?.metadata;
      if (!m || typeof stored?.base64 !== 'string' || stored.base64.length > 5592408 || !/^[A-Za-z0-9+/]+={0,2}$/.test(stored.base64)) throw new Error('Archivo inválido en el respaldo.');
      const bytes = Uint8Array.from(atob(stored.base64), c => c.charCodeAt(0));
      if (bytes.length !== m.size || bytesToHex(sha256(bytes)) !== m.sha256) throw new Error('Una fotografía o evidencia no supera la verificación de integridad.');
      if (entry.type === 'media') {
        if (!equipmentImageFields.includes(m.field as typeof equipmentImageFields[number]) || bytesToHex(sha256(utf8.encode(`data:${m.mime};base64,${stored.base64}`))) !== m.hash) throw new Error('Referencia de fotografía inválida.');
        const key = mediaKey(String(m.equipment_id), String(m.field), String(m.hash));
        if (photos.has(key)) throw new Error('Una fotografía está repetida en el respaldo.'); photos.add(key); counts.media++;
      } else {
        if (attachments.has(String(m.id))) throw new Error('Una evidencia está repetida.'); attachments.add(String(m.id)); counts.attachment++;
      }
    } else throw new Error('Tipo de entrada desconocido en el respaldo.');
  }
  if (!complete || !header) throw new Error('La descarga está incompleta; falta el cierre del respaldo.');
  const database: Database = { schemaVersion: 1, revision: header.revision!, entities };
  validateDatabase(database);
  for (const row of entities.Equipo) for (const field of equipmentImageFields) if (isEquipmentImageReference(row[field]) && !photos.has(mediaKey(row.id, field, row[field].slice(6)))) throw new Error('El respaldo no contiene una fotografía referenciada por un equipo.');
  return { database, counts, exportedAt: header.exportedAt! };
}
