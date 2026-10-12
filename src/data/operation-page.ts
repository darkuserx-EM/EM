import type { Database, EntityRecord } from '../domain/model';
import { filterOperations, emptyOperationFilters, isOperationalOrder, type OperationFilters } from '../domain/operation-query';

export const pagedEntities = ['Ticket','OrdenServicio','LecturaHorometro'] as const;
export type PagedEntity = typeof pagedEntities[number];
export type OperationQuery = Partial<OperationFilters> & {page?:number;pageSize?:number;id?:string;ticket?:string;order?:string};
export type OperationPage = {rows:EntityRecord[];total:number;page:number;pageSize:number;revision:number;counts:{total:number;actual:number;historico:number;states:Record<string,number>;actualStates:Record<string,number>};states:string[]};
export const isPagedEntity = (entity:string):entity is PagedEntity => pagedEntities.some(name=>name===entity);
export function localOperationPage(entity:PagedEntity,query:OperationQuery,db:Database):OperationPage {
  const all=db.entities[entity], counts:OperationPage['counts']={total:all.length,actual:0,historico:0,states:Object.create(null),actualStates:Object.create(null)};
  for(const row of all){const actual=isOperationalOrder(row);counts[actual?'actual':'historico']++;const key=String(row.estado||'');counts.states[key]=(counts.states[key]||0)+1;if(actual)counts.actualStates[key]=(counts.actualStates[key]||0)+1;}
  const filtered=filterOperations(all,{...emptyOperationFilters,...query},db.entities.Equipo,db.entities.Cliente).filter(row=>(!query.id||row.id===query.id)&&(!query.ticket||row.ticket_id===query.ticket)&&(!query.order||row.orden_id===query.order));
  const pageSize=query.pageSize||25,total=filtered.length,page=Math.min(query.page||1,Math.max(1,Math.ceil(total/pageSize)));
  return {rows:structuredClone(filtered.slice((page-1)*pageSize,page*pageSize)),total,page,pageSize,revision:db.revision,counts,states:[...new Set(all.map(row=>String(row.estado||'')))].filter(Boolean)};
}
