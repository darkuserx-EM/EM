import type {EntityRecord} from './model';
import {localDay} from './equipment-history';
import {validDay} from './maintenance-plan';
import {isCompletedService} from './vocabulary';
const safeDay=(value:unknown)=>{
 if(typeof value!=='string'||!value)return '';
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return validDay(value)?value:'';
 if(!/^\d{4}-\d{2}-\d{2}T/.test(value)||!validDay(value.slice(0,10))||!Number.isFinite(Date.parse(value)))return '';
 return localDay(value);
};
export const orderDay=(row:EntityRecord)=>row.schema_operacion===1?safeDay(row.fecha)||safeDay(row.fecha_programada)||safeDay(row.fecha_creacion):safeDay(row.fecha);
export const orderClosed=(row:EntityRecord)=>isCompletedService(row);
export function dashboardOrders(rows:EntityRecord[],filter:{from:string;to:string;client:string;equipment:string;origin:string}){
 return rows.filter(row=>{const day=orderDay(row);return (!filter.from||!!day&&day>=filter.from)&&(!filter.to||!!day&&day<=filter.to)&&(!filter.client||row.cliente_id===filter.client)&&(!filter.equipment||row.equipo_id===filter.equipment)&&(!filter.origin||(filter.origin==='Actual')===(row.schema_operacion===1));});
}
export function monthlyServices(rows:EntityRecord[]){
 const groups=new Map<string,number>();for(const row of rows){const day=orderDay(row);if(!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;const key=day.slice(0,7);groups.set(key,(groups.get(key)||0)+1);}return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([month,count])=>({month,count}));
}
