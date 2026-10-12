import {afterEach,expect,it,vi} from 'vitest';
import {RemoteDataSource} from './remote';
import {createSeed,demoUsers} from './seed';
import {localOperationPage,pagedEntities} from './operation-page';
import {LocalDataSource} from './repository';
const actor=demoUsers[0];
afterEach(()=>vi.unstubAllGlobals());
function fixture(){const db=createSeed();const template=db.entities.OrdenServicio[0];db.entities.OrdenServicio=Array.from({length:401},(_,i)=>({...template,id:'os-'+i,codigo:'OS-'+i}));const compact={...db,syncToken:'v1',pagedEntities:[...pagedEntities],counts:{OrdenServicio:401},entities:{...db.entities,OrdenServicio:[]}};return {db,compact};}
it('el historial completo recorre páginas acotadas, comparte consultas y conserva conteos',async()=>{
 const {db,compact}=fixture();const fetch=vi.fn(async(path:string)=>{if(path.includes('/database'))return Response.json(compact);const url=new URL(path,'http://test');return Response.json(localOperationPage('OrdenServicio',{page:Number(url.searchParams.get('page')),pageSize:Number(url.searchParams.get('pageSize'))},db));});vi.stubGlobal('fetch',fetch);
 const source=new RemoteDataSource();await source.refresh();const repo=source.repository('OrdenServicio',actor);const [a,b]=await Promise.all([repo.getAll(),repo.getAll()]);expect(a).toHaveLength(401);expect(b).toEqual(a);expect(fetch).toHaveBeenCalledTimes(4);expect(source.recordCounts(actor).OrdenServicio).toBe(401);a[0].codigo='changed';expect((await repo.getAll())[0].codigo).not.toBe('changed');
});
it('un detalle por ID no descarga el resto de los reportes',async()=>{
 const {db,compact}=fixture();const fetch=vi.fn().mockResolvedValueOnce(Response.json(compact)).mockResolvedValueOnce(Response.json(localOperationPage('OrdenServicio',{id:'os-1',pageSize:1},db)));vi.stubGlobal('fetch',fetch);const source=new RemoteDataSource();await source.refresh();expect((await source.repository('OrdenServicio',actor).getById('os-1'))?.id).toBe('os-1');expect(fetch.mock.calls[1][0]).toContain('id=os-1&pageSize=1&token=v1');
});
it('no entrega totales parciales cuando cambia la revisión entre dos páginas',async()=>{
 const {db,compact}=fixture();const fetch=vi.fn().mockResolvedValueOnce(Response.json(compact)).mockResolvedValueOnce(Response.json(localOperationPage('OrdenServicio',{pageSize:200},db))).mockResolvedValueOnce(Response.json({error:'Los datos cambiaron'},{status:409})).mockResolvedValueOnce(Response.json({...compact,revision:1,syncToken:'v2'}));vi.stubGlobal('fetch',fetch);const source=new RemoteDataSource();await source.refresh();await expect(source.repository('OrdenServicio',actor).getAll()).rejects.toThrow('Los datos cambiaron');expect(source.getRevision()).toBe(1);
});
it('descarta respuestas pendientes al cerrar sesión',async()=>{
 const {db,compact}=fixture();let finish!:(value:Response)=>void;vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json(compact)).mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;})));const source=new RemoteDataSource();await source.refresh();const query=source.operationPage('OrdenServicio',actor);source.clear();finish(Response.json(localOperationPage('OrdenServicio',{},db)));await expect(query).rejects.toThrow('consulta cambió');
});
it('rechaza páginas repetidas en lugar de contar dos veces el historial',async()=>{
 const {db,compact}=fixture();const first=localOperationPage('OrdenServicio',{pageSize:200},db);vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json(compact)).mockImplementation(async()=>Response.json(first)));const source=new RemoteDataSource();await source.refresh();await expect(source.repository('OrdenServicio',actor).getAll()).rejects.toThrow('incompleto');
});
it('el modo local aplica permisos antes de paginar y permite consultar el historial de un equipo',async()=>{
 const db=createSeed();for(const row of db.entities.OrdenServicio)row.visible_cliente=true;const source=new LocalDataSource({getItem:()=>JSON.stringify(db),setItem:vi.fn()},{demoHistory:false});const client=demoUsers[5];const page=await source.operationPage('OrdenServicio',client,{pageSize:2});expect(page.total).toBeGreaterThan(2);expect(page.rows).toHaveLength(2);expect(page.rows.every(row=>row.cliente_id===client.cliente_id&&row.visible_cliente)).toBe(true);expect((await source.operationPage('Ticket',demoUsers[2])).total).toBe(0);const id=db.entities.Equipo[0].id;expect((await source.repository('LecturaHorometro',actor).getAll({equipment:id})).every(row=>row.equipo_id===id)).toBe(true);
});
