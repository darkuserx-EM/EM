import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { LocalDataSource } from './repository';
import { demoUsers } from './seed';
import { makeBackup, parseBackup } from './excel';
import { capacityPounds, equipmentFormValues, equipmentSpecificationDetails, inchesToMeters, liftInches, measurementLabel } from '../domain/equipment-specifications';
import { cleanFields } from '../domain/validation';
import type { Scalar } from '../domain/model';
const admin = demoUsers[0];
const equipment = { marca: 'Prueba', modelo: 'Demo', serie: 'QA-ESPECIFICACIONES', tipo: 'Reach', propiedad: 'Propio', estado: 'Disponible', horometro: 125 };
function fixture() {
  let saved: string | null = null;
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
  const source = new LocalDataSource(storage);
  return { source, storage, fleet: source.repository('Equipo', admin) };
}
describe('especificaciones de equipos y unidades', () => {
  it('convierte pulgadas a metros sin confundir altura de elevación, torre y cuchillas', () => {
    expect(inchesToMeters(210)).toBeCloseTo(5.334, 10);
    expect(measurementLabel(195)).toBe('195″ · 4.953 m');
    expect(measurementLabel(42)).toBe('42″ · 1.067 m');
  });
  it('guarda unidades nuevas, llantas separadas y serie de batería; persisten al reabrir y en Excel', async () => {
    const { source, storage, fleet } = fixture();
    const fields = { capacidad_lb: 3000, altura_elevacion_in: 210, altura_torre_in: 95, largo_cuchillas_in: 42, voltaje: 36, combustible: 'Eléctrico', bateria: 'SERIE-BATERIA-01', cargador: 'CARGADOR-01', llantas_delanteras: '5 × 4.1″', llantas_traseras: 'Llanta de prueba', caster: 'No aplica' };
    const row = await fleet.create({ ...equipment, ...fields });
    expect(row).toMatchObject(fields);
    expect(row.capacidad_kg).toBeCloseTo(1360.77711, 8);
    expect(row.altura_elevacion_m).toBeCloseTo(5.334, 8);
    expect(await new LocalDataSource(storage).repository('Equipo', admin).getById(row.id)).toMatchObject(fields);
    const restored = parseBackup(XLSX.read(XLSX.write(makeBackup(source.snapshot(admin)), { type: 'array', bookType: 'xlsx' }), { type: 'array' }));
    expect(restored.entities.Equipo.find(item => item.id === row.id)).toMatchObject(fields);
    expect(equipmentSpecificationDetails(row)).toContainEqual(['Altura de torre bajada', '95″ · 2.413 m']);
    expect(equipmentSpecificationDetails(row)).toContainEqual(['Capacidad', '3,000 lb']);
    expect(source.snapshot(admin).entities.LecturaHorometro.filter(item => item.equipo_id === row.id)).toHaveLength(1);
  });
  it('conserva medidas antiguas, llantas y horómetro al editar; 42 pulgadas solo es valor inicial de altas', async () => {
    const { source, fleet } = fixture();
    const row = await fleet.create({ ...equipment, capacidad_kg: 1500, altura_elevacion_m: 6, llantas: 'Dato anterior completo' });
    const legacy = { ...row }; delete legacy.capacidad_lb; delete legacy.altura_elevacion_in;
    expect(capacityPounds(legacy)).toBeCloseTo(3306.93393277, 6);
    expect(liftInches(legacy)).toBeCloseTo(236.22047244, 6);
    expect(equipmentFormValues(legacy).largo_cuchillas_in).toBeUndefined();
    expect(equipmentFormValues().largo_cuchillas_in).toBe('42');
    const updated = await fleet.update(row.id, { altura_torre_in: 92, llantas_delanteras: '4 × 4.1″' });
    expect(updated).toMatchObject({ capacidad_kg: 1500, altura_elevacion_m: 6, llantas: 'Dato anterior completo', horometro: 125 });
    expect(source.snapshot(admin).entities.LecturaHorometro.filter(item => item.equipo_id === row.id)).toHaveLength(1);
    expect(equipmentSpecificationDetails(legacy)).toContainEqual(['Llantas: dato anterior', 'Dato anterior completo']);
  });
  it('sincroniza correcciones y borrados en ambas unidades, también para clientes anteriores', async () => {
    const { fleet } = fixture();
    const row = await fleet.create({ ...equipment, capacidad_lb: 3000, altura_elevacion_in: 210 });
    const edited = await fleet.update(row.id, { capacidad_lb: 4000, altura_elevacion_in: 240 });
    expect(edited.capacidad_kg).toBeCloseTo(1814.36948, 8);
    expect(edited.altura_elevacion_m).toBeCloseTo(6.096, 8);
    const cleared = await fleet.update(row.id, { capacidad_lb: null, altura_elevacion_in: null });
    expect(cleared).toMatchObject({ capacidad_lb: null, capacidad_kg: null, altura_elevacion_in: null, altura_elevacion_m: null });
    expect(capacityPounds(cleared)).toBeNull(); expect(liftInches(cleared)).toBeNull();
    expect(cleanFields('Equipo', { capacidad_kg: 0, altura_elevacion_m: 0 })).toMatchObject({ capacidad_lb: 0, altura_elevacion_in: 0 });
    expect(cleanFields('Equipo', { capacidad_kg: '', altura_elevacion_m: null })).toMatchObject({ capacidad_lb: null, altura_elevacion_in: null });
  });
  it('rechaza especificaciones inválidas sin alterar equipo ni lectura inicial', async () => {
    const { source, fleet } = fixture(); const before = source.snapshot(admin);
    const invalid: Record<string, Scalar>[] = [{ capacidad_lb: -1 }, { altura_elevacion_in: '210 pulgadas' }, { altura_torre_in: -5 }, { largo_cuchillas_in: Infinity }, { voltaje: -24 }];
    for (const fields of invalid) {
      await expect(fleet.create({ ...equipment, ...fields })).rejects.toThrow('número');
    }
    expect(source.snapshot(admin)).toEqual(before);
  });
});
