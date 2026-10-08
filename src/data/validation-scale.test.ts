import { expect, it } from 'vitest';
import { validateDatabase } from '../domain/validation';
import { createSeed, demoUsers } from './seed';
import { LocalDataSource } from './repository';

function largeDatabase() {
  const db = createSeed();
  const date = '2026-10-08T12:00:00.000Z';
  db.entities.Bitacora = Array.from({ length: 25000 }, (_, i) => ({ id:`audit-${i}`, codigo:`LOG-${i+1}`, creado_por:'test', actualizado_por:'test', fecha_creacion:date, fecha_actualizacion:date, entidad:'Cliente', accion:'Creación', detalle:'Prueba sintética' }));
  return db;
}
it('lee, guarda y restaura más de 20000 movimientos en el servidor, conservando el límite local', async () => {
  const db = largeDatabase();
  expect(() => validateDatabase(db)).not.toThrow();
  let saved = JSON.stringify(db);
  const storage = {getItem:()=>saved,setItem:(_key:string,value:string)=>{saved=value;}};
  expect(() => new LocalDataSource(storage,{demoHistory:false})).toThrow('demasiados registros');
  const server = new LocalDataSource(storage,{demoHistory:false,maxRows:Infinity});
  await server.repository('Catalogos',demoUsers[0]).create({categoria:'Marcas',nombre:'Marca de escala',activo:true});
  expect(server.snapshot(demoUsers[0]).entities.Bitacora).toHaveLength(25001);
  server.restore(demoUsers[0],db,server.getRevision());
  expect(server.snapshot(demoUsers[0]).entities.Bitacora).toHaveLength(25001);
  expect(() => validateDatabase(db,{maxRows:20000})).toThrow('demasiados registros');
  db.entities.Bitacora[1].codigo = '  log-1  ';
  expect(() => validateDatabase(db)).toThrow('El código ya existe');
}, 15000);
it('conserva las reglas normalizadas de serie, referencia y categoría/nombre', () => {
  const equipment = createSeed(); equipment.entities.Equipo[1].serie = ` ${String(equipment.entities.Equipo[0].serie).toLowerCase()} `;
  expect(() => validateDatabase(equipment)).toThrow('La serie ya existe');
  const clients = createSeed(); clients.entities.Cliente[0].referencia_cliente = 'LAMFER'; clients.entities.Cliente[1].referencia_cliente = ' lamfer ';
  expect(() => validateDatabase(clients)).toThrow('La referencia de cliente ya existe');
  const catalogs = createSeed(); const first = catalogs.entities.Catalogos[0];
  catalogs.entities.Catalogos.push({...first,id:'new',codigo:'CAT-999',nombre:` ${String(first.nombre).toLowerCase()} `});
  expect(() => validateDatabase(catalogs)).toThrow('El nombre ya existe');
});
