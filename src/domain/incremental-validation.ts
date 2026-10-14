import {entityNames, type Database, type EntityName, type EntityRecord} from './model';
import {ValidationError} from './errors';
import {enabledEquipment} from './technician-work';
import {uniqueKeys,validateDatabase,validateDatabaseStructure} from './validation';

// Dependency declarations mirror the links checked by validateDatabase. Tests
// compare both validators, including reverse effects of edits and deletions.
const links: Partial<Record<EntityName, readonly (readonly [string,EntityName])[]>> = {
  Equipo: [['cliente_id','Cliente'],['sede_id','Sede']],
  Contacto: [['cliente_id','Cliente']],
  Sede: [['cliente_id','Cliente'],['autoriza_contacto_id','Contacto']],
  Ticket: [['equipo_id','Equipo'],['cliente_id','Cliente'],['sede_id','Sede'],['responsable_id','Tecnico'],['ticket_id','Ticket'],['orden_id','OrdenServicio']],
  OrdenServicio: [['equipo_id','Equipo'],['cliente_id','Cliente'],['sede_id','Sede'],['tecnico_id','Tecnico'],['ticket_id','Ticket'],['orden_id','OrdenServicio']],
  LecturaHorometro: [['equipo_id','Equipo'],['cliente_id','Cliente'],['sede_id','Sede'],['tecnico_id','Tecnico'],['ticket_id','Ticket'],['orden_id','OrdenServicio']],
  OTRepuesto: [['equipo_id','Equipo'],['cliente_id','Cliente'],['orden_id','OrdenServicio']],
  OTHoras: [['equipo_id','Equipo'],['cliente_id','Cliente'],['orden_id','OrdenServicio']],
  Hallazgo: [['equipo_id','Equipo'],['orden_origen_id','OrdenServicio'],['orden_resolucion_id','OrdenServicio']],
  PlanPM: [['equipo_id','Equipo'],['base_orden_id','OrdenServicio'],['anterior_id','PlanPM']],
};
const identity = (entity: EntityName,id: string) => JSON.stringify([entity,id]);
type IndexedRow = {entity:EntityName; row:EntityRecord; serialized:string; keys:[string,string][]; references:string[]};
type Index = {rows:Map<string,IndexedRow>; reverse:Map<string,Set<string>>};
function indexDatabase(data: Database, previous?: Index): Index {
  const rows=new Map<string,IndexedRow>(),reverse=new Map<string,Set<string>>();
  for(const entity of entityNames) {
    const unique=new Set<string>();
    for(const row of data.entities[entity]) {
      if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id.trim())throw new ValidationError(`${entity}: identificador ausente o duplicado.`);
      const key=identity(entity,row.id);if(rows.has(key))throw new ValidationError(`${entity}: identificador ausente o duplicado.`);
      // Reject cells JSON.stringify would silently omit or transform. Non-finite
      // numbers get a distinct fingerprint even when an optional field was null.
      const cells=Object.entries(row);
      if(cells.some(([field,cell])=>['__proto__','constructor','prototype'].includes(field)||(cell!==null&&!['string','number','boolean'].includes(typeof cell))))throw new ValidationError(`${entity}: contenido no permitido.`);
      const serialized=cells.some(([,cell])=>typeof cell==='number'&&!Number.isFinite(cell))
        ? JSON.stringify(row,(_field,cell)=>typeof cell==='number'&&!Number.isFinite(cell)?['non-finite',String(cell)]:cell)
        : JSON.stringify(row);
      const old=previous?.rows.get(key);
      const entry:IndexedRow=old?.serialized===serialized ? old : {
        entity,row:{...row},serialized,keys:uniqueKeys(entity,row),
        references:[...(links[entity]||[]).filter(([field])=>!!row[field]).map(([field,target])=>identity(target,String(row[field]))), ...(entity==='Tecnico' ? enabledEquipment(row).map(id=>identity('Equipo',id)) : [])],
      };
      for(const [key,message] of entry.keys) {if(unique.has(key))throw new ValidationError(`${entity}: ${message}`);unique.add(key);}
      rows.set(key,entry);
      for(const reference of entry.references) {if(!reverse.has(reference))reverse.set(reference,new Set());reverse.get(reference)!.add(key);}
    }
  }
  return {rows,reverse};
}
function expand(selected:Set<string>, neighbors:(key:string)=>Iterable<string>) {
  const queue=[...selected];
  for(let i=0;i<queue.length;i++)for(const key of neighbors(queue[i]))if(!selected.has(key)){selected.add(key);queue.push(key);}
}

/** A validated baseline is internal server state, never supplied by an HTTP caller. */
export class IncrementalValidation {
  private constructor(private index: Index, readonly checkedRows: number) {}
  static create(value: unknown) {
    validateDatabase(value);
    const index=indexDatabase(value);
    return new IncrementalValidation(index,index.rows.size);
  }
  check(value: unknown): IncrementalValidation {
    validateDatabaseStructure(value);
    const index=indexDatabase(value,this.index),affected=new Set<string>();
    for(const [key,row] of index.rows)if(this.index.rows.get(key)?.serialized!==row.serialized)affected.add(key);
    for(const key of this.index.rows.keys())if(!index.rows.has(key))affected.add(key);
    // An edited parent may invalidate an otherwise unchanged child. Then include
    // forward references so the shared validator sees the exact required context.
    expand(affected,key=>new Set([...(this.index.reverse.get(key)||[]),...(index.reverse.get(key)||[])]));
    expand(affected,key=>index.rows.get(key)?.references||[]);
    const selected:Database={schemaVersion:value.schemaVersion,revision:value.revision,entities:Object.fromEntries(entityNames.map(entity=>[entity,[] as EntityRecord[]])) as Database['entities']};
    let checked=0;
    for(const key of affected) {
      const entry=index.rows.get(key);if(entry){selected.entities[entry.entity].push(entry.row);checked++;}
    }
    validateDatabase(selected);
    return new IncrementalValidation(index,checked);
  }
  validate(value: unknown): asserts value is Database { this.check(value); }
}
