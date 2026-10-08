import { afterEach, expect, it, vi } from 'vitest';
import { api, RemoteDataSource, setCsrf } from './remote';
import { createSeed, demoUsers } from './seed';
afterEach(()=>vi.unstubAllGlobals());
it('rechaza respuestas HTML incluso con estado 200 sin darlas por un guardado exitoso',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>Error de alojamiento</html>',{status:200})));
  await expect(api('mutate',{action:'create'})).rejects.toThrow('HTTP 200');
});
it('conserva la explicación de validación enviada por la API',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'Razón social obligatoria'},{status:400})));
  await expect(api('mutate',{})).rejects.toThrow('Razón social obligatoria');
});
it('no vuelve a enviar automáticamente un guardado cuya conexión falló',async()=>{
  const fetch=vi.fn(async()=>{throw new TypeError('Network failure');});vi.stubGlobal('fetch',fetch);
  await expect(api('mutate',{})).rejects.toThrow('No recibimos confirmación');expect(fetch).toHaveBeenCalledTimes(1);
});
it('usa el token recibido y conserva datos y suscriptores cuando no hay cambios',async()=>{
  const db = {...createSeed(),syncToken:'version-one'};
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(db)).mockResolvedValueOnce(new Response(null,{status:204}));vi.stubGlobal('fetch',fetch);
  const source = new RemoteDataSource();const listener=vi.fn();source.subscribe(listener);
  await source.refresh();await source.refresh();
  expect(fetch.mock.calls[1][0]).toBe('/api/database?since=version-one');
  expect(source.snapshot(demoUsers[0])).toEqual(db);expect(listener).toHaveBeenCalledTimes(1);
});
it('un 204 en un guardado no se interpreta como confirmación',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:204})));
  await expect(api('mutate',{})).rejects.toThrow('no confirmó');
});
it('no recupera datos de una respuesta pendiente después de cerrar sesión',async()=>{
  let finish!: (response:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
  const source=new RemoteDataSource();const refresh=source.refresh();source.clear();finish(Response.json(createSeed()));await refresh;
  expect(source.getRevision()).toBe(-1);
});
it('un 401 tardío de la sesión anterior no cierra una sesión nueva',async()=>{
  let finish!: (response:Response)=>void;const dispatchEvent=vi.fn();vi.stubGlobal('window',{dispatchEvent});
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
  setCsrf('previous');const pending=api('database');setCsrf('new-session');finish(Response.json({error:'Sesión vencida'},{status:401}));
  await expect(pending).rejects.toMatchObject({status:401});expect(dispatchEvent).not.toHaveBeenCalled();
});
it('una respuesta antigua no reemplaza los permisos de una respuesta nueva con igual revisión',async()=>{
  let finish!: (response:Response)=>void;const db=createSeed();
  vi.stubGlobal('fetch',vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;})).mockResolvedValueOnce(Response.json({...db,syncToken:'new-permissions',entities:{...db.entities,Equipo:[]}})));
  const source=new RemoteDataSource();const previous=source.refresh();await source.refresh();finish(Response.json({...db,syncToken:'old-permissions'}));await previous;
  expect(source.snapshot(demoUsers[0]).entities.Equipo).toEqual([]);
});
it('al recibir un conflicto recupera la revisión nueva sin repetir la escritura',async()=>{
  const db={...createSeed(),syncToken:'old'};
  const fetch=vi.fn().mockResolvedValueOnce(Response.json(db)).mockResolvedValueOnce(Response.json({error:'Los datos cambiaron'},{status:409})).mockResolvedValueOnce(Response.json({...db,revision:db.revision+1,syncToken:'new'}));vi.stubGlobal('fetch',fetch);
  const source=new RemoteDataSource();await source.refresh();
  await expect(source.repository('Catalogos',demoUsers[0]).create({})).rejects.toThrow('Los datos cambiaron');
  expect(source.getRevision()).toBe(db.revision+1);expect(fetch).toHaveBeenCalledTimes(3);
});
