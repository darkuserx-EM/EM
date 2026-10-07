import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { LocalDataSource, STORAGE_KEY } from './repository';
import { createSeed } from './seed';
import { makeBackup, parseBackup } from './excel';
import { addClientSectors, MAX_CLIENT_LOGO_LENGTH, validClientLogo } from '../domain/client-profile';
import type { Actor } from '../domain/model';

const admin: Actor = { id:'test-admin',nombre:'Pruebas',rol:'Administrador' };
const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVioAAAAASUVORK5CYII=';
function source() { const db=createSeed(); for(const key of Object.keys(db.entities) as (keyof typeof db.entities)[]) if(key!=='Catalogos')db.entities[key]=[];let text=JSON.stringify(db);return new LocalDataSource({getItem:key=>key===STORAGE_KEY?text:null,setItem:(_key,value)=>text=value},{demoHistory:false}); }
describe('perfil del cliente',()=>{
  it('conserva nombre comercial, Plus Code y logo al guardar y respaldar en Excel',async()=>{
    const store=source();const row=await store.repository('Cliente',admin).create({nombre:'Empresa legal de prueba',nombre_comercial:'Marca de prueba',estado:'Activo',sector:'Farmacéutica',plus_code:'Referencia ficticia',logo});
    expect(row.codigo).toBe('CLI-001');
    const bytes=XLSX.write(makeBackup(store.snapshot(admin)),{type:'buffer',bookType:'xlsx'});
    const parsed=parseBackup(XLSX.read(bytes,{type:'buffer'}));
    expect(parsed.entities.Cliente[0]).toMatchObject({nombre_comercial:'Marca de prueba',plus_code:'Referencia ficticia',logo});
  });
  it('preserva campos antiguos al editar solo los campos visibles y permite retirar el logo',async()=>{
    const store=source();const repo=store.repository('Cliente',admin);
    const row=await repo.create({nombre:'Empresa de prueba',estado:'Activo',referencia_cliente:'ANTERIOR',dia_facturacion:15,reporte_mensual_horas:'Sí',logo});
    await repo.update(row.id,{nombre_comercial:'Marca',logo:''});
    expect(await repo.getById(row.id)).toMatchObject({nombre_comercial:'Marca',referencia_cliente:'ANTERIOR',dia_facturacion:15,reporte_mensual_horas:'Sí',logo:''});
    expect(store.snapshot(admin).entities.Bitacora.at(-1)?.detalle).not.toContain('base64');
  });
  it('rechaza logos externos, SVG, contenido mal identificado y tamaños excesivos',async()=>{
    expect(validClientLogo(logo)).toBe(true);
    for(const value of ['https://example.test/logo.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,PGh0bWw+',logo+'A'.repeat(MAX_CLIENT_LOGO_LENGTH)]) {
      expect(validClientLogo(value)).toBe(false);
      await expect(source().repository('Cliente',admin).create({nombre:'Empresa',estado:'Activo',logo:value})).rejects.toThrow('Logo');
    }
  });
  it('agrega el catálogo de sectores una sola vez y conserva códigos ya utilizados',()=>{
    const db=createSeed();db.entities.Catalogos=db.entities.Catalogos.filter(row=>row.categoria!=='Sectores / actividades');
    const count=db.entities.Catalogos.length;db.entities.Catalogos[0].codigo='CAT-099';
    expect(addClientSectors(db)).toBe(true);expect(db.entities.Catalogos[count].codigo).toBe('CAT-100');
    const saved=JSON.stringify(db);expect(addClientSectors(db)).toBe(false);expect(JSON.stringify(db)).toBe(saved);
  });
});
