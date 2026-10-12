import { expect,it } from 'vitest';
import { localAuditPage } from './audit-log';
import { createSeed } from './seed';
it('pagina fechas iguales sin duplicar y respeta los filtros de equipo y hallazgo',()=>{
  const sample=createSeed().entities.Bitacora[0];
  const rows=Array.from({length:125},(_,i)=>({...sample,id:`row-${i.toString().padStart(3,'0')}`,equipo_id:'one',hallazgo_id:i<5?'finding':''}));
  const seen=new Set<string>();let cursor:string|undefined;
  do {const page=localAuditPage(rows,{equipo_id:'one',limit:20,cursor});for(const row of page.rows){expect(seen.has(row.id)).toBe(false);seen.add(row.id);}cursor=page.nextCursor||undefined;}while(cursor);
  expect(seen.size).toBe(125);expect(localAuditPage(rows,{hallazgo_id:'finding'}).rows).toHaveLength(5);expect(localAuditPage(rows,{equipo_id:'another'}).rows).toHaveLength(0);
});
