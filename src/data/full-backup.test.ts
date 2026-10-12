import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createSeed } from './seed';
import { inspectFullBackup, type ArchiveEntry } from './full-backup';

const utf8 = new TextEncoder();
const digest = (text: string) => bytesToHex(sha256(utf8.encode(text)));
function archive(entries: ArchiveEntry[]) {
  const body = entries.map(entry => JSON.stringify(entry) + '\n').join('');
  const counts = Object.fromEntries(['record','media','attachment'].map(type => [type, entries.filter(entry => entry.type === type).length]));
  return body + JSON.stringify({ type: 'complete', counts, sha256: digest(body) }) + '\n';
}
function fixture() {
  const database = createSeed();
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp9sAAAAASUVORK5CYII=';
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const hash = digest(`data:image/png;base64,${base64}`);
  database.entities.Equipo[0].foto_equipo = `media:${hash}`;
  const entries: ArchiveEntry[] = [{ type: 'portal-em.full', version: 1, schemaVersion: 1, revision: database.revision, exportedAt: '2026-10-01T12:00:00.000Z' }];
  for (const [entity, rows] of Object.entries(database.entities)) for (const record of rows) entries.push({ type: 'record', entity: entity as ArchiveEntry['entity'], record });
  entries.push({ type: 'media', file: { metadata: { equipment_id: database.entities.Equipo[0].id, field: 'foto_equipo', hash, mime: 'image/png', size: bytes.length, sha256: bytesToHex(sha256(bytes)), uploaded_by: 'qa', created_at: 1790856000000 }, base64 } });
  return { entries, database };
}

describe('respaldo completo por archivos', () => {
  it('verifica registros, referencias y bytes antes de recuperar', async () => {
    const { entries, database } = fixture();
    const result = await inspectFullBackup(new Blob([archive(entries)]));
    expect(result.database).toEqual(database);
    expect(result.counts.media).toBe(1);
  });
  it('rechaza la descarga sin cierre y contenido posterior al cierre', async () => {
    const { entries } = fixture();
    await expect(inspectFullBackup(new Blob([archive(entries).slice(0,-1)]))).rejects.toThrow('truncado');
    await expect(inspectFullBackup(new Blob([archive(entries) + '{}\n']))).rejects.toThrow('después');
  });
  it('detecta una fotografía ausente aunque la suma global sea válida', async () => {
    const { entries } = fixture();
    await expect(inspectFullBackup(new Blob([archive(entries.filter(entry => entry.type !== 'media'))]))).rejects.toThrow('no contiene una fotografía');
  });
  it('rechaza fotografías corruptas y duplicadas', async () => {
    const { entries } = fixture();
    const photo = entries.at(-1)!;
    await expect(inspectFullBackup(new Blob([archive([...entries, photo])]))).rejects.toThrow('repetida');
    photo.file!.metadata.sha256 = '0'.repeat(64);
    await expect(inspectFullBackup(new Blob([archive(entries)]))).rejects.toThrow('integridad');
  });
  it('detecta una alteración del cierre sin depender del nombre del archivo', async () => {
    const { entries } = fixture();
    const file = archive(entries).replace('"media":1', '"media":2');
    await expect(inspectFullBackup(new Blob([file]))).rejects.toThrow('número de registros');
  });
});
