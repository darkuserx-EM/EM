import { it, expect } from 'vitest';
import { createSeed, demoUsers } from '../data/seed';
import { LocalDataSource } from '../data/repository';
import { auditActorLabel } from './audit-actor';
import { makeBackup, parseBackup } from '../data/excel';
import * as XLSX from 'xlsx';

it('registra nombre y rol del actor autenticado y conserva el ID al respaldar', async () => {
  let saved = JSON.stringify(createSeed());
  const source = new LocalDataSource({ getItem: () => saved, setItem: (_k,v) => { saved = v; } }, { demoHistory: false });
  const client = { ...demoUsers[5], id: 'authenticated-client', nombre: 'Cliente de auditoría' };
  await source.repository('Ticket', client).create({ equipo_id: 'equipment-1', titulo: 'Prueba', descripcion: 'Prueba de autoría' });
  const entry = source.snapshot(demoUsers[0]).entities.Bitacora.at(-1)!;
  expect(entry).toMatchObject({ creado_por: client.id, registrado_por: client.nombre, registrado_rol: 'Cliente' });
  const db = parseBackup(XLSX.read(XLSX.write(makeBackup(source.snapshot(demoUsers[0])), { type: 'array', bookType: 'xlsx' }), { type: 'array' }));
  expect(db.entities.Bitacora.at(-1)).toMatchObject(entry);
  expect(auditActorLabel(entry, [], demoUsers[0])).toBe('Cliente de auditoría · Cliente');
  expect(await source.repository('Bitacora', client).getAll()).toEqual([]);
  const legacy = { ...entry }; delete legacy.registrado_por; delete legacy.registrado_rol;
  expect(auditActorLabel(legacy, [{ id: client.id, name: 'Cuenta recuperada', role: 'Cliente' }], demoUsers[0])).toBe('Cuenta recuperada · Cliente');
  expect(auditActorLabel(legacy, [], demoUsers[0])).toBe('Cuenta no disponible');
});
