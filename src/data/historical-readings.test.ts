import { describe, expect, it } from 'vitest';
import { LocalDataSource, STORAGE_KEY } from './repository';
import { createSeed, demoUsers } from './seed';
import type { HistoricalReportsImport } from './historical-reports';
import type { EntityRecord } from '../domain/model';
import { validateDatabase } from '../domain/validation';
const admin = demoUsers[0];
function fixture(change?: (row: EntityRecord) => void, duplicate = false) {
  const db = createSeed(); const machine = db.entities.Equipo.find(row => row.cliente_id)!;
  const original: EntityRecord = { id: 'retained-reading', codigo: 'HOR-901', creado_por: 'original-author', fecha_creacion: '2025-01-01T00:00:00Z', actualizado_por: 'original-author', fecha_actualizacion: '2025-01-01T00:00:00Z', equipo_id: machine.id, cliente_id: machine.cliente_id, fecha: '2025-02-08T14:00:00-06:00', valor: 100, odometro_millas: null, es_estimado: false, orden_id: '', importado: true, origen_id: 'source-901', registrado_por: 'Técnico original', valor_original: 100, fuente_sha256: 'original-file' };
  change?.(original); db.entities.LecturaHorometro.push(original);
  const report = { origen_id: 'source-901', orden_origen: 'IMPORT-901', serie: String(machine.serie), fecha: '2025-02-08T20:00:00.000Z', fecha_fin: '', estado: 'Completado', prioridad: '', tipo: 'Correctivo', diagnostico: '', trabajo: '', notas_seguridad: '', tecnicos: '', recibido_por: '', inspector: '', horometro: 100, odometro_millas: null, insumos_origen: '', repuestos_origen: '', adjuntos_referencias: '', firma_cliente_referencia: '', checklist_origen: '', bocina_origen: '', mes_origen: '', semana_origen: '', dia_origen: '', ubicacion_coordenadas: '' };
  const payload: HistoricalReportsImport = {cliente_id: String(machine.cliente_id), sede_id: '', equipos: [], reportes: [report]};
  if (duplicate) {
    db.entities.OrdenServicio.push({...original, id:'imported-order', codigo:'OS-H-0901', importado:true, origen_id:report.origen_id, orden_origen:report.orden_origen, fecha:report.fecha, horometro:report.horometro});
    db.entities.LecturaHorometro.push({...original,id:'duplicate-reading',codigo:'HOR-H-0901',fecha:report.fecha,orden_id:'imported-order',registrado_por:'Importación histórica AppSheet'});
  }
  let saved = JSON.stringify(db);
  const source = new LocalDataSource({getItem:key=>key===STORAGE_KEY?saved:null,setItem:(_key,value)=>{saved=value;}},{demoHistory:false});
  return {source,payload,original, before:source.snapshot(admin)};
}
const pairs = [{conservar_id:'retained-reading',duplicada_id:'duplicate-reading'}];
describe('lecturas conservadas e importación histórica', () => {
  it('reutiliza el mismo instante en UTC/Guatemala sin perder identidad ni procedencia y resiste el reintento', () => {
    const {source,payload,original,before}=fixture();
    expect(source.importHistoricalReports(admin,payload,source.getRevision())).toMatchObject({lecturas:0,lecturas_reutilizadas:1,reportes:1});
    const after=source.snapshot(admin);const row=after.entities.LecturaHorometro.find(r=>r.id===original.id)!;
    expect(after.entities.LecturaHorometro).toHaveLength(before.entities.LecturaHorometro.length);
    expect(row).toMatchObject({...original,orden_id:after.entities.OrdenServicio.at(-1)!.id,actualizado_por:admin.id,fecha_actualizacion:row.fecha_actualizacion});
    expect(JSON.parse(String(after.entities.Bitacora.find(r=>r.accion==='Lectura histórica reutilizada')!.lectura_original_json))).toEqual(original);
    expect(source.importHistoricalReports(admin,payload,source.getRevision())).toMatchObject({lecturas:0,reportes:0,repetidos:1});
    expect(source.snapshot(admin)).toEqual(after);
  });
  it.each([{valor:101},{odometro_millas:0},{es_estimado:true},{odometro_estimado:true},{cliente_id:'client-2'},{fecha:'2025-02-09T20:00:00Z'}])('bloquea discrepancias sin guardar parcialmente: %j', fields => {
    const {source,payload,before}=fixture(row=>Object.assign(row,fields));
    expect(()=>source.importHistoricalReports(admin,payload,source.getRevision())).toThrow('coincidencia');expect(source.snapshot(admin)).toEqual(before);
  });
  it('no mezcla lecturas iguales de instantes diferentes ni reutiliza una ya vinculada', () => {
    const {source,payload,before}=fixture(row=>{row.fecha='2025-02-07T20:00:00Z';row.origen_id='another-source';});
    expect(source.importHistoricalReports(admin,payload,source.getRevision())).toMatchObject({lecturas:1});
    expect(source.snapshot(admin).entities.LecturaHorometro).toHaveLength(before.entities.LecturaHorometro.length+1);
    payload.reportes[0]={...payload.reportes[0],origen_id:'new-source',orden_origen:'new-order'};
    const after=source.snapshot(admin);expect(()=>source.importHistoricalReports(admin,payload,source.getRevision())).toThrow('coincidencia');expect(source.snapshot(admin)).toEqual(after);
  });
  it('dos reportes con el mismo instante bloquean todo el lote', () => {
    const {source,payload,before}=fixture();payload.reportes.push({...payload.reportes[0],origen_id:'another-source',orden_origen:'another-order'});
    expect(()=>source.importHistoricalReports(admin,payload,source.getRevision())).toThrow('coincidencia');expect(source.snapshot(admin)).toEqual(before);
  });
  it('concilia solo el par indicado y conserva ambos originales íntegros en la bitácora', () => {
    const {source,before,original}=fixture(undefined,true);
    expect(source.reconcileHistoricalReadings(admin,pairs,source.getRevision())).toEqual({conciliadas:1});
    const after=source.snapshot(admin);validateDatabase(after);
    expect(after.entities.LecturaHorometro).toHaveLength(before.entities.LecturaHorometro.length-1);
    expect(after.entities.LecturaHorometro.find(r=>r.id===original.id)?.orden_id).toBe('imported-order');
    const audit=after.entities.Bitacora.at(-1)!;
    expect(JSON.parse(String(audit.lectura_original_json))).toEqual(original);
    expect(JSON.parse(String(audit.lectura_duplicada_json))).toEqual(before.entities.LecturaHorometro.at(-1));
    for(const [entity,rows] of Object.entries(before.entities)) if(!['LecturaHorometro','Bitacora'].includes(entity)) expect(after.entities[entity as keyof typeof after.entities]).toEqual(rows);
    expect(after.entities.Bitacora.slice(0,-1)).toEqual(before.entities.Bitacora);
    expect(()=>source.reconcileHistoricalReadings(admin,pairs,source.getRevision())).toThrow();expect(source.snapshot(admin)).toEqual(after);
  });
  it('rechaza pares ambiguos, repetidos, divergentes y revisiones obsoletas de forma atómica', () => {
    for(const input of [[...pairs,...pairs],[...pairs,{conservar_id:'missing',duplicada_id:'missing2'}]]) {
      const {source,before}=fixture(undefined,true);expect(()=>source.reconcileHistoricalReadings(admin,input,source.getRevision())).toThrow();expect(source.snapshot(admin)).toEqual(before);
    }
    const {source,before}=fixture(undefined,true);expect(()=>source.reconcileHistoricalReadings(admin,pairs,source.getRevision()+1)).toThrow('cambiaron');expect(source.snapshot(admin)).toEqual(before);
    const changed=fixture(row=>{row.valor=101;},true);expect(()=>changed.source.reconcileHistoricalReadings(admin,pairs,changed.source.getRevision())).toThrow('equivalentes');expect(changed.source.snapshot(admin)).toEqual(changed.before);
  });
  it('mantiene importación y conciliación exclusivas de administración', () => {
    const {source,payload,before}=fixture(undefined,true);
    for(const actor of [demoUsers[1],demoUsers[2],demoUsers[5]]) {
      expect(()=>source.importHistoricalReports(actor,payload,source.getRevision())).toThrow();
      expect(()=>source.reconcileHistoricalReadings(actor,pairs,source.getRevision())).toThrow();
    }
    expect(source.snapshot(admin)).toEqual(before);
  });
});
