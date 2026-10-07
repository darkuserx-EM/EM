import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { LocalDataSource, STORAGE_KEY, type StorageAdapter } from './repository';
import { demoUsers } from './seed';
import { parseClientWorkbook } from './client-excel';
import { exportRows, rowsToSheet } from './excel';
import type { ClientImportRow } from '../domain/client-import';
const admin = demoUsers[0];
function fixture() {
  let value: string | null = null;
  const storage: StorageAdapter = { getItem: () => value, setItem: (_key, next) => { value = next; } };
  return { storage, source: new LocalDataSource(storage) };
}
function workbook(rows: unknown[][]) {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Cliente'); return book;
}
const threeClients = () => workbook([
  ['referencia_cliente','nombre','estado','nit'],
  ['QA-01','Importación de prueba Uno','Activo','0000123-4'],
  ['QA-02','Importación de prueba Dos','Prospecto','CF'],
  ['QA-03','Importación de prueba Tres','Activo','CF'],
]);

describe('importación administrativa de clientes', () => {
  it('lee la plantilla entregada y guarda tres clientes con contactos y sedes en una operación', () => {
    const { source, storage } = fixture();
    const book = XLSX.read(readFileSync('public/templates/Plantilla-clientes-EMSA.xlsx'), {type:'buffer'});
    XLSX.utils.sheet_add_aoa(book.Sheets.Cliente, [
      ['QA-01','Importación de prueba Uno','Comercial Uno','Activo','0000123-4'],
      ['QA-02','Importación de prueba Dos','','Prospecto'],
      ['QA-03','Importación de prueba Tres','','Activo'],
    ], { origin:'A2' });
    XLSX.utils.sheet_add_aoa(book.Sheets.Contacto, [['QA-01','Contacto de prueba','','+502 0000 0000','prueba@example.com','Sí']], {origin:'A2'});
    XLSX.utils.sheet_add_aoa(book.Sheets.Sede, [['QA-03','Bodega de prueba','Dirección de prueba','Villa Nueva','Guatemala']], {origin:'A2'});
    const inputs = parseClientWorkbook(XLSX.read(XLSX.write(book,{type:'array',bookType:'xlsx'}),{type:'array'}));
    expect(inputs).toHaveLength(5);
    expect(source.previewClientImport(admin,inputs).every(row=>!row.errors.length)).toBe(true);
    const revision = source.getRevision();
    const id = source.importClients(admin,inputs,revision);
    const after = new LocalDataSource(storage).snapshot(admin);
    expect(after.revision).toBe(revision+1);
    expect(after.entities.Cliente).toHaveLength(9);
    expect(after.entities.Cliente.at(-3)).toMatchObject({id,codigo:'CLI-007',nit:'0000123-4',creado_por:admin.id});
    expect(after.entities.Contacto[0].cliente_id).toBe(id);
    expect(after.entities.Sede[0].cliente_id).toBe(after.entities.Cliente.at(-1)?.id);
    expect(after.entities.Bitacora.at(-1)?.accion).toBe('Importación');
    const beforeRepeat=source.snapshot(admin);
    expect(()=>source.importClients(admin,inputs,source.getRevision())).toThrow('ya existe');
    expect(source.snapshot(admin)).toEqual(beforeRepeat);
  });
  it('señala una fila inválida y no guarda ninguna parte del lote', () => {
    const {source}=fixture(); const before=source.snapshot(admin); const book=threeClients();
    book.Sheets.Cliente.B4={t:'s',v:''};
    const rows=parseClientWorkbook(book);
    expect(source.previewClientImport(admin,rows)[2].errors.join(' ')).toContain('obligatorio');
    expect(()=>source.importClients(admin,rows,source.getRevision())).toThrow('fila 4');
    expect(source.snapshot(admin)).toEqual(before);
  });
  it('detecta NIT y nombres duplicados normalizados, dentro del archivo y frente al portal', async () => {
    const {source}=fixture(); const book=threeClients();
    book.Sheets.Cliente.D3={t:'s',v:'00001234'};
    expect(source.previewClientImport(admin,parseClientWorkbook(book))[1].errors.join(' ')).toContain('NIT');
    await source.repository('Cliente',admin).create({nombre:'Importación de prueba Uno',estado:'Activo'});
    expect(source.previewClientImport(admin,parseClientWorkbook(threeClients()))[0].errors.join(' ')).toContain('nombre');
  });
  it('conserva columnas opcionales ausentes al actualizar un ID exportado', async () => {
    const {source}=fixture();
    const row=await source.repository('Cliente',admin).create({nombre:'Cliente con datos',estado:'Activo',nit:'000099-1',notas_operativas:'Conservar esta nota',referencia_cliente:'EXISTE'});
    const book=workbook([['id','nombre','estado'],[row.id,'Cliente actualizado','Inactivo']]);
    const inputs=parseClientWorkbook(book);
    expect(source.previewClientImport(admin,inputs)[0].action).toBe('Actualizar');
    source.importClients(admin,inputs,source.getRevision());
    expect(await source.repository('Cliente',admin).getById(row.id)).toMatchObject({nombre:'Cliente actualizado',nit:'000099-1',notas_operativas:'Conservar esta nota',codigo:row.codigo});
    const exported=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(exported,rowsToSheet('Cliente',await source.repository('Cliente',admin).export()),'Cliente');
    const parsed=parseClientWorkbook(XLSX.read(XLSX.write(exported,{type:'array',bookType:'xlsx'}),{type:'array'}));
    expect(source.previewClientImport(admin,parsed).every(item=>item.action==='Actualizar' && !item.errors.length)).toBe(true);
  });
  it('omite filas vacías y conserva sus números reales para los errores', () => {
    const rows=parseClientWorkbook(workbook([['nombre','estado'],['A','Activo'],[],['B','Incorrecto']]));
    expect(rows.map(row=>row.line)).toEqual([2,4]);
    expect(()=>parseClientWorkbook(workbook([['nombre','estado'],['','']]))).toThrow('no contiene');
  });
  it('rechaza fórmulas, celdas con error, encabezados repetidos y columnas desconocidas', () => {
    const {source}=fixture(); const book=threeClients(); book.Sheets.Cliente.B2={t:'s',v:'Nombre calculado',f:'"Nombre calculado"'};
    book.Sheets.Cliente.C3={t:'e',v:7};
    const preview=source.previewClientImport(admin,parseClientWorkbook(book));
    expect(preview[0].errors.join(' ')).toContain('fórmula'); expect(preview[1].errors.join(' ')).toContain('error de Excel');
    expect(()=>parseClientWorkbook(workbook([['nombre','nombre','estado'],['A','A','Activo']]))).toThrow('repetidos');
    expect(()=>parseClientWorkbook(workbook([['nombre','estado','dato_desconocido'],['A','Activo','X']]))).toThrow('no reconocidos');
  });
  it('impide referencias rotas, IDs desconocidos y duplicados de contactos/sedes', () => {
    const {source}=fixture(); const before=source.snapshot(admin); const rows=parseClientWorkbook(threeClients());
    const orphan:ClientImportRow={entity:'Sede',line:2,reference:'NO-EXISTE',fields:{nombre:'Bodega'}};
    expect(()=>source.importClients(admin,[...rows,orphan],source.getRevision())).toThrow('referencia_cliente');
    expect(source.snapshot(admin)).toEqual(before);
    expect(source.previewClientImport(admin,[{...rows[0],id:'desconocido'}])[0].errors.join(' ')).toContain('ID no existe');
    const site:ClientImportRow={entity:'Sede',line:2,reference:'QA-01',fields:{nombre:'Bodega'}};
    expect(source.previewClientImport(admin,[...rows,site,{...site,line:3}]).at(-1)?.errors.join(' ')).toContain('ya existe');
  });
  it('invalida vistas previas antiguas y detecta escrituras desde otra pestaña', async () => {
    const {source,storage}=fixture(); const rows=parseClientWorkbook(threeClients()); const revision=source.getRevision();
    await source.repository('Cliente',admin).create({nombre:'Nuevo antes de confirmar',estado:'Activo'});
    expect(()=>source.importClients(admin,rows,revision)).toThrow('vista previa');
    const other=new LocalDataSource(storage); await other.repository('Cliente',admin).create({nombre:'Cambio en otra pestaña',estado:'Activo'});
    const saved=storage.getItem(STORAGE_KEY);
    expect(()=>source.importClients(admin,rows,source.getRevision())).toThrow('otra pestaña');
    expect(storage.getItem(STORAGE_KEY)).toBe(saved);
  });
  it('conserva los datos si el navegador no puede guardar', () => {
    const {source,storage}=fixture();const before=source.snapshot(admin);storage.setItem=()=>{throw new Error('Quota');};
    expect(()=>source.importClients(admin,parseClientWorkbook(threeClients()),source.getRevision())).toThrow('No se pudo guardar');
    expect(source.snapshot(admin)).toEqual(before);
  });
  it('bloquea importación, vista previa y exportación fuera de Administración', async () => {
    const {source}=fixture();const rows=parseClientWorkbook(threeClients());
    for(const actor of demoUsers.slice(1)) {
      expect(()=>source.previewClientImport(actor,rows)).toThrow('administración');
      expect(()=>source.importClients(actor,rows,source.getRevision())).toThrow('administración');
      await expect(source.repository('Cliente',actor).import(rows.map(row=>({fields:row.fields})),source.getRevision())).rejects.toThrow('administración');
      for(const entity of ['Cliente','Equipo','Contacto','Sede','OrdenServicio'] as const) await expect(source.repository(entity,actor).export()).rejects.toThrow('administración');
      expect(()=>exportRows('Cliente',[],actor)).toThrow('administración');
    }
  });
});
