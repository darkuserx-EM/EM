import {maintenanceFleetFilters,type MaintenanceFleetFilter} from './maintenance-fleet';
const pages = ['/flota','/preventivos','/reportes'];
const keys = ['fleet','client','from','to','origin','equipment','fleetSearch','fleetStatus','fleetMaintenance','retired','maintenanceSearch','maintenanceState','cycle'];
export function fleetFilter(params:URLSearchParams):MaintenanceFleetFilter {
 const value=params.get('fleet') as MaintenanceFleetFilter;
 return maintenanceFleetFilters.includes(value)?value:'Todos';
}
/** Only transfer filter context, never detail IDs, unrelated query strings or authorization. */
export function fleetContextLink(target:string,pathname:string,search:string) {
 const destination=new URL(target,'https://portal.invalid');
 if(!pages.includes(pathname)||!pages.includes(destination.pathname)||destination.origin!=='https://portal.invalid')return target;
 const current=new URLSearchParams(search);
 for(const key of keys)if(current.has(key)&&!destination.searchParams.has(key))destination.searchParams.set(key,current.get(key)!);
 return destination.pathname+destination.search+destination.hash;
}
export function updateFleetParams(current:URLSearchParams,changes:Record<string,string>) {
 const next=new URLSearchParams(current);
 if('client' in changes||'fleet' in changes)next.delete('equipment');
 for(const [key,value] of Object.entries(changes)){if(value)next.set(key,value);else next.delete(key);}
 return next;
}
