import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { createSeed, demoUsers } from './seed';
import { LocalDataSource } from './repository';
import { makeBackup, parseBackup } from './excel';
import { validateDatabase } from '../domain/validation';
import type { Scalar } from '../domain/model';

describe('respaldo real con valores opcionales (#42)', () => {
  it('restaura nulos, ceros, lecturas positivas y columnas presentes sólo en algunas filas', async () => {
    let saved = JSON.stringify(createSeed());
    const source = new LocalDataSource({ getItem: () => saved, setItem: (_key, value) => { saved = value; } }, { demoHistory: false });
    const admin = demoUsers[0];
    const repo = source.repository('OrdenServicio', admin);
    const base = { equipo_id: 'equipment-1', cliente_id: 'client-1', sintoma: 'Prueba sintética', tipo: 'Correctivo', estado: 'Borrador' };
    const records = [];
    const variants: Record<string, Scalar>[] = [{ horometro: null, odometro_millas: null }, { horometro: 0 }, { horometro: 900 }, {}];
    for (const fields of variants) records.push(await repo.create({ ...base, ...fields }));
    const original = source.snapshot(admin);
    validateDatabase(original);
    const parsed = parseBackup(XLSX.read(XLSX.write(makeBackup(original), { type: 'array', bookType: 'xlsx' }), { type: 'array' }));
    for (const row of records) {
      const restored = parsed.entities.OrdenServicio.find(item => item.id === row.id)!;
      expect(restored.horometro ?? null).toBe(row.horometro ?? null);
      expect(restored.creado_por).toBe(row.creado_por);
    }
    await source.repository('Catalogos', admin).create({ categoria: 'Marcas', nombre: 'Después del respaldo', activo: true });
    const liveAudit = source.snapshot(admin).entities.Bitacora;
    source.restore(admin, parsed, source.getRevision());
    expect(source.snapshot(admin).entities.Bitacora.slice(0, -1)).toEqual(liveAudit);
    expect(source.snapshot(admin).entities.OrdenServicio).toEqual(parsed.entities.OrdenServicio);
    const invalid = makeBackup(original);
    const sheet = invalid.Sheets.OrdenServicio;
    const headers = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0];
    sheet[XLSX.utils.encode_cell({ r: 1, c: headers.indexOf('horometro') })] = { t: 's', v: 'inválido' };
    expect(() => parseBackup(invalid)).toThrow();
  });
});
