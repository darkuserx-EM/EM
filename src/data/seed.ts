import { entityNames, type Actor, type Database, type EntityRecord } from '../domain/model';

import { clientSectors } from '../domain/client-profile';

export const demoUsers: Actor[] = [
  { id: 'user-admin', nombre: 'Administración EMSA', rol: 'Administrador' },
  { id: 'user-coord', nombre: 'Coordinación EMSA', rol: 'Coordinador' },
  { id: 'user-tec1', nombre: 'Carlos Méndez', rol: 'Técnico', tecnico_id: 'tech-1' },
  { id: 'user-tec2', nombre: 'Ana López', rol: 'Técnico', tecnico_id: 'tech-2' },
  { id: 'user-tec3', nombre: 'Luis García', rol: 'Técnico', tecnico_id: 'tech-3' },
  { id: 'user-client', nombre: 'Distribuidora del Valle', rol: 'Cliente', cliente_id: 'client-1' },
];
export function seedRecord(id: string, codigo: string, fields: Record<string, string | number | boolean | null>): EntityRecord {
  return { id, codigo, creado_por: 'sistema-demo', fecha_creacion: '2026-10-04T14:00:00.000Z', actualizado_por: 'sistema-demo', fecha_actualizacion: '2026-10-04T14:00:00.000Z', ...fields };
}
export function createSeed(): Database {
  const entities = Object.fromEntries(entityNames.map(name => [name, []])) as unknown as Database['entities'];
  const clients = [
    ['Distribuidora del Valle', 'Distribución', 'Villa Nueva'], ['Logística del Pacífico', 'Logística', 'Escuintla'],
    ['Industrias del Centro', 'Industria', 'Mixco'], ['Farma Maya', 'Farmacéutica', 'Ciudad de Guatemala'],
    ['Editorial Horizonte', 'Editorial', 'Ciudad de Guatemala'], ['Alimentos Las Cumbres', 'Alimentos', 'Amatitlán'],
  ];
  entities.Cliente = clients.map(([nombre, sector, ubicacion], i) => seedRecord(`client-${i + 1}`, `CLI-${String(i + 1).padStart(3, '0')}`, { nombre, sector, ubicacion, estado: i === 5 ? 'Prospecto' : 'Activo' }));
  const models = [['Yale', 'ERP 050', 'Contrabalanceado eléctrico'], ['Crown', 'RR 5700', 'Reach'], ['Raymond', '7500', 'Reach'], ['Toyota', '8FGU25', 'Combustión'], ['Hyundai', '18BT-9', 'Contrabalanceado eléctrico']];
  const states = ['En renta', 'Disponible', 'En mantenimiento', 'En renta', 'En taller', 'Disponible', 'En renta', 'En tránsito'];
  let own = 0; let client = 0;
  entities.Equipo = Array.from({ length: 25 }, (_, i) => {
    const [marca, modelo, tipo] = models[i % models.length]; const isOwn = i < 18;
    const codigo = `${isOwn ? 'TCL' : 'TCE'}-${String(isOwn ? ++own : ++client).padStart(3, '0')}`;
    const estado = isOwn ? states[i % states.length] : ['Disponible', 'En mantenimiento', 'En taller'][i % 3];
    return seedRecord(`equipment-${i + 1}`, codigo, { marca, modelo, tipo, serie: `DEMO-${marca.toUpperCase()}-${1001 + i}`, propiedad: isOwn ? 'Propio' : 'De cliente', estado, cliente_id: !isOwn || estado === 'En renta' ? `client-${i % 5 + 1}` : '', horometro: 850 + i * 137 });
  });
  entities.Tecnico = ['Carlos Méndez', 'Ana López', 'Luis García'].map((nombre, i) => seedRecord(`tech-${i + 1}`, `TEC-0${i + 1}`, { nombre, especialidad: ['Eléctricos', 'Combustión', 'Mantenimiento preventivo'][i] }));
  entities.Usuario = demoUsers.map((user, i) => seedRecord(user.id, `USR-00${i + 1}`, { nombre: user.nombre, rol: user.rol, cliente_id: user.cliente_id ?? '', tecnico_id: user.tecnico_id ?? '' }));
  const catalogs: Record<string, string[]> = {
    'Marcas': ['Yale', 'Crown', 'Raymond', 'Toyota', 'Hyundai'],
    'Tipos de equipo': ['Contrabalanceado eléctrico', 'Combustión', 'Reach', 'Doble profundidad', 'Patín eléctrico', 'Apilador', 'Plataforma'],
    'Síntomas': ['No arranca', 'Ruido', 'Fuga de aceite', 'Sobrecalentamiento', 'Falla eléctrica', 'Falla hidráulica', 'Otro'],
    'Categorías de gasto': ['Alimentación', 'Hospedaje', 'Otros'],
    'Turnos': ['Diurno', 'Nocturno'],
    'Ítems de revisión': ['Frenos', 'Bocina', 'Fugas', 'Cadenas', 'Batería', 'Cinturón'],
    'Estados comerciales': ['Activo', 'Prospecto', 'Inactivo'],
    'Sectores / actividades': clientSectors,
  };
  let index = 0;
  entities.Catalogos = Object.entries(catalogs).flatMap(([categoria, names]) => names.map(nombre => { index++; return seedRecord(`catalog-${index}`, `CAT-${String(index).padStart(3, '0')}`, { categoria, nombre, activo: true }); }));
  entities.Bitacora = [seedRecord('log-seed', 'LOG-001', { entidad: 'Sistema', accion: 'Inicialización', detalle: 'Espacio de demostración creado con datos ficticios.' })];
  addEquipmentHistoryDemo(entities);
  return { schemaVersion: 1, revision: 0, entities };
}

/** One-time addition to the original demonstration, preserving all user changes. */
export function addEquipmentHistoryDemo(entities: Database['entities']): boolean {
  if (entities.Bitacora.some(row => row.id === 'log-equipment-history-v1')) return false;
  const dates = ['2026-06-01', '2026-06-15', '2026-07-01', '2026-07-10', '2026-07-31', '2026-08-15', '2026-08-31', '2026-09-15', '2026-09-25', '2026-10-03'];
  const offsets = [240, 210, 180, 168, 125, 105, 65, 35, 15, 0];
  const jobs = [
    { day: 3, tipo: 'Preventivo', motivo: 'Servicio periódico de inspección', diagnostico: 'Inspección general de frenos, cadenas y sistema hidráulico.', trabajo: 'Lubricación de cadenas, ajuste de frenos y revisión de niveles. Prueba funcional de elevación y traslado.', pieza: 'Lubricante para cadenas', cantidad: 1, unitario: 145, horas: 2, labor: 240 },
    { day: 5, tipo: 'Correctivo', motivo: 'Fuga en línea hidráulica', diagnostico: 'Desgaste en el sello de una conexión hidráulica; fuga durante la elevación.', trabajo: 'Cambio del sello, ajuste de la conexión y limpieza del área. Prueba de elevación sin fugas.', pieza: 'Sello hidráulico', cantidad: 2, unitario: 85, horas: 3.5, labor: 420 },
    { day: 8, tipo: 'Correctivo', motivo: 'Desajuste del freno de estacionamiento', diagnostico: 'Recorrido excesivo de la palanca del freno de estacionamiento.', trabajo: 'Ajuste del mecanismo, verificación del cable y prueba de retención.', pieza: '', cantidad: 0, unitario: 0, horas: 1.5, labor: 180 },
  ];
  let added = 0;
  for (let i = 0; i < 25; i++) {
    const equipment = entities.Equipo.find(row => row.id === `equipment-${i + 1}`);
    // Do not attach invented history to changed or imported equipment.
    if (!equipment || equipment.creado_por !== 'sistema-demo' || equipment.serie !== `DEMO-${String(equipment.marca).toUpperCase()}-${1001 + i}` || equipment.horometro !== 850 + i * 137) continue;
    if (['OrdenServicio', 'LecturaHorometro'].some(name => entities[name as 'OrdenServicio' | 'LecturaHorometro'].some(row => row.equipo_id === equipment.id))) continue;
    const tech = entities.Tecnico.find(row => row.id === `tech-${i % 3 + 1}`);
    if (!tech) continue;
    const owner = { equipo_id: equipment.id, cliente_id: equipment.cliente_id || '', tecnico_id: tech.id };
    const location = entities.Cliente.find(row => row.id === equipment.cliente_id)?.nombre ?? 'Patio EMSA';
    dates.forEach((date, j) => {
      const value = Number(equipment.horometro) - offsets[j];
      const jobIndex = jobs.findIndex(job => job.day === j);
      entities.LecturaHorometro.push(seedRecord(`reading-${i + 1}-${j}`, `HOR-${String(i * 10 + j + 1).padStart(3, '0')}`, {
        ...owner, fecha: `${date}T16:00:00.000Z`, valor: value, origen: jobIndex >= 0 ? 'Orden de servicio' : 'Registro manual',
        orden_id: jobIndex >= 0 ? `service-${i + 1}-${jobIndex}` : '', registrado_por: jobIndex >= 0 ? String(tech.nombre) : 'Operador de muestra', ubicacion: location,
        fecha_creacion: `${date}T16:00:00.000Z`, fecha_actualizacion: `${date}T16:00:00.000Z`,
      }));
    });
    jobs.forEach((job, j) => {
      const id = `service-${i + 1}-${j}`; const date = `${dates[job.day]}T16:00:00.000Z`;
      const metadata = { fecha_creacion: date, fecha_actualizacion: date };
      entities.OrdenServicio.push(seedRecord(id, `OT-${String(i * 3 + j + 1).padStart(3, '0')}`, {
        ...owner, ...metadata, fecha: date, tipo: job.tipo, motivo: job.motivo, diagnostico: job.diagnostico, trabajo: job.trabajo,
        estado: 'Pendiente de firma', horometro: Number(equipment.horometro) - offsets[job.day], ubicacion: location,
        costo_repuestos: job.cantidad * job.unitario, costo_mano_obra: job.labor,
      }));
      entities.OTHoras.push(seedRecord(`labor-${i + 1}-${j}`, `HRS-${String(i * 3 + j + 1).padStart(3, '0')}`, { ...owner, ...metadata, orden_id: id, horas: job.horas }));
      if (job.pieza) entities.OTRepuesto.push(seedRecord(`part-${i + 1}-${j}`, `REP-${String(i * 3 + j + 1).padStart(3, '0')}`, { ...owner, ...metadata, orden_id: id, descripcion: job.pieza, cantidad: job.cantidad, costo_unitario: job.unitario }));
    });
    added++;
  }
  if (!added) return false;
  entities.Bitacora.push(seedRecord('log-equipment-history-v1', 'LOG-DEMO-HISTORIAL', { entidad: 'Equipo', accion: 'Ampliación de muestra', detalle: `Se añadió historial ficticio a ${added} equipos originales de demostración; se conservaron los registros existentes.` }));
  return true;
}
