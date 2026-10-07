import {describe,expect,it} from 'vitest';
import * as XLSX from 'xlsx';
import {LocalDataSource} from './repository';
import {demoUsers} from './seed';
import {makeBackup,parseBackup} from './excel';
const admin=demoUsers[0];
function source(){let value:string|null=null;return new LocalDataSource({getItem:()=>value,setItem:(_key,next)=>{value=next;}});}

describe('contacto que autoriza el ingreso a la sede',()=>{
  it('conserva la relación con el contacto en la sede y en Excel',async()=>{
    const db=source();const contacts=db.repository('Contacto',admin);const sites=db.repository('Sede',admin);
    const contact=await contacts.create({cliente_id:'client-1',nombre:'Persona de prueba',telefono:'+502 0000 0000'});
    const site=await sites.create({cliente_id:'client-1',nombre:'Bodega de prueba',departamento:'Guatemala',autoriza_contacto_id:contact.id,horario_atencion:'Dato histórico'});
    await contacts.update(contact.id,{nombre:'Persona actualizada'});
    await sites.update(site.id,{municipio:'Municipio de prueba'});
    const restored=parseBackup(XLSX.read(XLSX.write(makeBackup(db.snapshot(admin)),{bookType:'xlsx',type:'buffer'}),{type:'buffer'}));
    expect(restored.entities.Sede.find(row=>row.id===site.id)).toMatchObject({autoriza_contacto_id:contact.id,horario_atencion:'Dato histórico'});
    expect(restored.entities.Contacto.find(row=>row.id===contact.id)?.nombre).toBe('Persona actualizada');
    await sites.update(site.id,{autoriza_contacto_id:''});
    expect((await sites.getById(site.id))?.autoriza_contacto_id).toBe('');
  });
  it('rechaza contactos inexistentes o de otra empresa sin escrituras parciales',async()=>{
    const db=source();const contact=await db.repository('Contacto',admin).create({cliente_id:'client-2',nombre:'Otro cliente'});const before=db.snapshot(admin);
    for(const id of ['inexistente',contact.id])await expect(db.repository('Sede',admin).create({cliente_id:'client-1',nombre:'Prueba',autoriza_contacto_id:id})).rejects.toThrow('mismo cliente');
    expect(db.snapshot(admin)).toEqual(before);
    const site=await db.repository('Sede',admin).create({cliente_id:'client-2',nombre:'Válida',autoriza_contacto_id:contact.id});
    const linked=db.snapshot(admin);
    await expect(db.repository('Contacto',admin).update(contact.id,{cliente_id:'client-1'})).rejects.toThrow('mismo cliente');
    expect(db.snapshot(admin)).toEqual(linked);
    const corrupt=structuredClone(linked);corrupt.entities.Sede.find(row=>row.id===site.id)!.cliente_id='client-1';
    expect(()=>db.restore(admin,corrupt,db.getRevision())).toThrow('mismo cliente');
  });
  it('señala la relación incorrecta en la vista previa de importación',async()=>{
    const db=source();const contact=await db.repository('Contacto',admin).create({cliente_id:'client-2',nombre:'Contacto importación'});
    const row={entity:'Sede' as const,line:2,fields:{nombre:'Sede importada',cliente_id:'client-1',autoriza_contacto_id:contact.id}};
    expect(db.previewClientImport(admin,[row])[0].errors.join(' ')).toContain('mismo cliente');
    row.fields.cliente_id='client-2';
    expect(db.previewClientImport(admin,[row])[0].errors).toEqual([]);
    db.importClients(admin,[row],db.getRevision());
    expect(db.snapshot(admin).entities.Sede.at(-1)?.autoriza_contacto_id).toBe(contact.id);
  });
});
