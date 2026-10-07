import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { LocalDataSource } from './repository';
import { demoUsers } from './seed';
import { makeBackup, makeEquipmentHistoryWorkbook, parseBackup, readWorkbook } from './excel';
import { equipmentHistory } from '../domain/equipment-history';
import { equipmentImageFields, equipmentImageLabels, equipmentImageSource, MAX_EQUIPMENT_IMAGE_LENGTH, validEquipmentImage } from '../domain/equipment-images';
const admin = demoUsers[0];
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp9sAAAAASUVORK5CYII=';
const large = 'data:image/png;base64,' + btoa(atob(png.split(',')[1]) + 'texto de ejemplo '.repeat(5000));
function fixture() { let saved: string | null = null; const storage = {getItem:()=>saved,setItem:(_key:string,value:string)=>{saved=value;}}; const source = new LocalDataSource(storage); return {source,storage,fleet:source.repository('Equipo',admin)}; }
const fields = { marca:'Prueba', modelo:'Adjuntos', serie:'QA-ADJUNTOS', tipo:'Stock picker', propiedad:'Propio', estado:'Disponible', horometro:120 };
describe('fotografías y placa de datos', () => {
  it('conserva los adjuntos al reabrir, editar otro campo y quitar solo una imagen', async () => {
    const {source,storage,fleet} = fixture();
    const row = await fleet.create({...fields,foto_equipo:png,placa_datos:large});
    await fleet.update(row.id,{notas:'Solo observaciones'});
    expect(await new LocalDataSource(storage).repository('Equipo',admin).getById(row.id)).toMatchObject({foto_equipo:png,placa_datos:large,horometro:120});
    await fleet.update(row.id,{foto_equipo:''});
    expect(await fleet.getById(row.id)).toMatchObject({foto_equipo:'',placa_datos:large});
    expect(source.snapshot(admin).entities.Bitacora.at(-1)?.detalle).toContain('Imagen de referencia del equipo: retirada');
    expect(JSON.stringify(source.snapshot(admin).entities.Bitacora)).not.toContain('base64');
    expect(source.snapshot(admin).entities.LecturaHorometro.filter(item=>item.equipo_id===row.id)).toHaveLength(1);
  });
  it('rechaza archivos activos, URL externas, firmas inválidas y tamaños excesivos sin guardar parcialmente', async () => {
    const {source,fleet} = fixture(); const before = source.snapshot(admin);
    for (const field of equipmentImageFields) for (const image of ['data:image/svg+xml;base64,PHN2Zz4=', 'https://example.com/foto.jpg', 'data:image/png;base64,SG9sYQ==', 'x'.repeat(MAX_EQUIPMENT_IMAGE_LENGTH+1)]) await expect(fleet.create({...fields,[field]:image})).rejects.toThrow(equipmentImageLabels[field]);
    expect(source.snapshot(admin)).toEqual(before);
    for (const actor of demoUsers.slice(1)) await expect(source.repository('Equipo',actor).update('equipment-1',{foto_equipo:png})).rejects.toThrow('administración');
  });
  it('respalda fotos mayores que una celda de Excel y recupera todos los bytes', async () => {
    const {source,fleet} = fixture(); const row = await fleet.create({...fields,foto_equipo:png,placa_datos:large});
    const workbook=makeBackup(source.snapshot(admin));
    expect(workbook.SheetNames).toContain('_imagenes_equipo');
    const restored = parseBackup(XLSX.read(XLSX.write(workbook,{type:'array',bookType:'xlsx'}),{type:'array'}));
    expect(restored.entities.Equipo.find(item=>item.id===row.id)).toMatchObject({foto_equipo:png,placa_datos:large});
    const history = makeEquipmentHistoryWorkbook(row,equipmentHistory(row.id,[],[],[],[]),'','');
    expect(history.SheetNames).toContain('_imagenes_equipo');
  });
  it('detecta partes faltantes o duplicadas en respaldos y no acepta enlaces sin archivo', async () => {
    const {source,fleet} = fixture(); await fleet.create({...fields,placa_datos:large});
    const broken=makeBackup(source.snapshot(admin));
    const chunks=XLSX.utils.sheet_to_json<Record<string,unknown>>(broken.Sheets._imagenes_equipo);
    broken.Sheets._imagenes_equipo=XLSX.utils.json_to_sheet(chunks.slice(1));
    expect(()=>parseBackup(broken)).toThrow('Faltan partes');
    broken.Sheets._imagenes_equipo=XLSX.utils.json_to_sheet([...chunks,chunks[0]]);
    expect(()=>parseBackup(broken)).toThrow('repetidas');
    delete broken.Sheets._imagenes_equipo;
    expect(()=>parseBackup(broken)).toThrow('no incluye');
    const db=source.snapshot(admin); db.entities.Equipo[0].foto_equipo='media:'+'a'.repeat(64);
    expect(()=>makeBackup(db)).toThrow('Falta descargar');
  });
  it('genera rutas privadas solo para referencias válidas y mantiene el original en modo local', () => {
    const reference='media:'+'b'.repeat(64);
    expect(validEquipmentImage(png)).toBe(true);
    expect(equipmentImageSource({id:'eq-1',foto_equipo:reference},'foto_equipo')).toBe(`/api/equipment-images/eq-1/foto_equipo/${'b'.repeat(64)}`);
    expect(equipmentImageSource({foto_equipo:png},'foto_equipo')).toBe(png);
    expect(equipmentImageSource({foto_equipo:'javascript:alert(1)'},'foto_equipo')).toBe('');
  });
  it('mantiene independientes las cuatro vistas, la referencia y la placa al editar y respaldar', async () => {
    const {source,storage,fleet} = fixture();
    const images = Object.fromEntries(equipmentImageFields.map((field,index) => [field, 'data:image/png;base64,' + btoa(atob(png.split(',')[1]) + `${index}`.repeat(30000))]));
    const row = await fleet.create({...fields,...images});
    await fleet.update(row.id,{foto_frontal:png,foto_lateral_2:''});
    const expected = {...images,foto_frontal:png,foto_lateral_2:''};
    expect(await new LocalDataSource(storage).repository('Equipo',admin).getById(row.id)).toMatchObject(expected);
    expect(source.snapshot(admin).entities.Bitacora.at(-1)?.detalle).toContain('Foto frontal: actualizada');
    expect(source.snapshot(admin).entities.Bitacora.at(-1)?.detalle).toContain('Foto lateral 2: retirada');
    const workbook=makeBackup(source.snapshot(admin));
    const restored=parseBackup(XLSX.read(XLSX.write(workbook,{type:'array',bookType:'xlsx'}),{type:'array'}));
    expect(restored.entities.Equipo.find(item=>item.id===row.id)).toMatchObject(expected);
    expect(JSON.stringify(source.snapshot(admin).entities.Bitacora)).not.toContain('base64');
  });
  it('admite respaldos mayores de 8 MB sin ampliar el límite de las importaciones normales', async () => {
    const workbook=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Ejemplo']]));
    const bytes=XLSX.write(workbook,{type:'array',bookType:'xlsx'});
    const file={name:'respaldo.xlsx',size:9*1024*1024,arrayBuffer:async()=>bytes} as File;
    await expect(readWorkbook(file)).rejects.toThrow('8 MB');
    expect((await readWorkbook(file,false,32)).SheetNames).toHaveLength(1);
    await expect(readWorkbook({...file,size:33*1024*1024} as File,false,32)).rejects.toThrow('32 MB');
  });
});
