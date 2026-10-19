import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { LocalDataSource, STORAGE_KEY } from './repository';
import { createSeed, demoUsers } from './seed';
import { filterVisible } from '../domain/permissions';
import type { Actor } from '../domain/model';
import { parseReadingSheet } from './reading-sheet';
import { makeBackup, parseBackup } from './excel';
const admin=demoUsers[0];
function fixture() {
  const db=createSeed();const equipment=db.entities.Equipo.find(r=>r.cliente_id)!;db.entities.LecturaHorometro=[];
  let saved=JSON.stringify(db);const source=new LocalDataSource({getItem:key=>key===STORAGE_KEY?saved:null,setItem:(_key,value)=>{saved=value;}},{demoHistory:false});
  const client:Actor={id:'sender',nombre:'Cliente prueba',rol:'Cliente',cliente_id:String(equipment.cliente_id)};
  const payload={archivo:'lecturas.xlsx',filas:[{equipo_id:equipment.id,fecha:'2025-01-02T14:00:00.000Z',valor:100,observacion:'Lectura de turno'}]};
  return {source,client,payload,equipment};
}
describe('lecturas del cliente con aprobación',()=>{
  it('mantiene pendientes fuera del historial y aprueba una sola vez con autoría y motivo',()=>{
    const {source,client,payload}=fixture();const before=source.snapshot(admin);
    expect(source.submitReadings(client,payload,source.getRevision())).toEqual({enviadas:1,repetidas:0});
    expect(source.snapshot(admin).entities.LecturaHorometro).toEqual(before.entities.LecturaHorometro);
    expect(source.submitReadings(client,payload,source.getRevision())).toEqual({enviadas:0,repetidas:1});
    const row=source.snapshot(admin).entities.LecturaEnviada[0];
    source.reviewReading(admin,{id:row.id,aprobar:true,motivo:'Confirmado contra la fotografía'},source.getRevision());
    expect(source.snapshot(admin).entities.LecturaHorometro).toHaveLength(1);
    expect(source.snapshot(admin).entities.LecturaEnviada[0]).toMatchObject({estado:'Aprobada',creado_por:client.id,revisado_por:admin.id});
    expect(parseBackup(makeBackup(source.snapshot(admin))).entities.LecturaEnviada).toEqual(source.snapshot(admin).entities.LecturaEnviada);
    expect(()=>source.reviewReading(admin,{id:row.id,aprobar:true,motivo:'Reintento'},source.getRevision())).toThrow('ya fue revisada');
    expect(source.submitReadings(client,payload,source.getRevision())).toEqual({enviadas:0,repetidas:1});
  });
  it('protege los cuatro perfiles y el alcance entre clientes',()=>{
    const {source,client,payload}=fixture();
    for(const rol of ['Administrador','Coordinador','Técnico'] as const) expect(()=>source.submitReadings({...client,rol},payload,source.getRevision())).toThrow();
    expect(()=>source.submitReadings({...client,cliente_id:'ajeno'},payload,source.getRevision())).toThrow('flota');
    source.submitReadings(client,payload,source.getRevision());const db=source.snapshot(admin);const id=db.entities.LecturaEnviada[0].id;
    for(const rol of ['Cliente','Coordinador','Técnico'] as const) expect(()=>source.reviewReading({...client,rol},{id,aprobar:true,motivo:'Intento'},source.getRevision())).toThrow();
    for(const actor of [{...client,cliente_id:'otro'},{...client,rol:'Técnico' as const},{...client,rol:'Coordinador' as const}]) expect(filterVisible(actor,'LecturaEnviada',db.entities.LecturaEnviada,db.entities)).toEqual([]);
    expect(filterVisible(client,'LecturaEnviada',db.entities.LecturaEnviada,db.entities)).toHaveLength(1);
  });
  it('rechaza conflictos y revisión vieja sin guardar parcialmente, conserva rechazos',()=>{
    const {source,client,payload}=fixture();const revision=source.getRevision();source.submitReadings(client,payload,revision);
    const id=source.snapshot(admin).entities.LecturaEnviada[0].id;
    expect(()=>source.reviewReading(admin,{id,aprobar:true,motivo:'ok'},revision)).toThrow('cambiaron');
    expect(()=>source.submitReadings(client,{...payload,filas:[{...payload.filas[0],valor:101}]},source.getRevision())).toThrow('distinto');
    source.reviewReading(admin,{id,aprobar:false,motivo:'Error de captura'},source.getRevision());
    expect(source.snapshot(admin).entities.LecturaHorometro).toHaveLength(0);
    source.submitReadings(client,{...payload,filas:[{...payload.filas[0],valor:101}]},source.getRevision());
    expect(source.snapshot(admin).entities.LecturaEnviada.map(r=>r.estado)).toEqual(['Rechazada','Pendiente']);
  });
  it('lee la plantilla y omite equipos sin medición, rechaza filas duplicadas',()=>{
    const {equipment}=fixture();const book=XLSX.utils.book_new();const rows=[['Fecha','Hora Guatemala','Serie','Horómetro (h)','Observación'],['02/01/2025','08:00:00',equipment.serie,100,''],['','',equipment.serie,'','']];
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Lecturas Distelsa');
    const read=()=>parseReadingSheet(XLSX.write(book,{type:'array',bookType:'xlsx'}),[equipment]);
    expect(read()).toEqual([{equipo_id:equipment.id,fecha:'2025-01-02T14:00:00.000Z',valor:100,observacion:''}]);
    book.Sheets['Lecturas Distelsa']=XLSX.utils.aoa_to_sheet([...rows,rows[1]]);expect(read).toThrow('repetidos');
  });
  it('bloquea retrocesos y aumentos imposibles sin modificar el historial',()=>{
    const {source,client,payload}=fixture();source.submitReadings(client,payload,source.getRevision());
    source.reviewReading(admin,{id:source.snapshot(admin).entities.LecturaEnviada[0].id,aprobar:true,motivo:'Verificado'},source.getRevision());
    for (const valor of [90,200]) {
      source.submitReadings(client,{...payload,filas:[{...payload.filas[0],fecha:'2025-01-02T15:00:00.000Z',valor}]},source.getRevision());
      const row=source.snapshot(admin).entities.LecturaEnviada.at(-1)!;
      const before=source.snapshot(admin);
      expect(()=>source.reviewReading(admin,{id:row.id,aprobar:true,motivo:'Verificado'},source.getRevision())).toThrow();
      expect(source.snapshot(admin)).toEqual(before);
      source.reviewReading(admin,{id:row.id,aprobar:false,motivo:'Solicitar corrección'},source.getRevision());
    }
  });
});
