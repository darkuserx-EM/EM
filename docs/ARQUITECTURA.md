# Arquitectura y decisiones · Portal EM

## Separación de responsabilidades

Las vistas consumen repositorios asíncronos. El adaptador local es el único responsable del almacenamiento de datos; las pantallas no escriben entidades directamente en localStorage. Zustand conserva la sesión ficticia y los avisos. El adaptador escribe un estado validado completo antes de notificar los cambios, de modo que un error de cuota no se presenta como un guardado exitoso.

`Repository` expone `getAll`, `getById`, `create`, `update`, `remove`, `import` y `export`. Administración puede crear y editar Catálogos, Cliente, Contacto, Sede y Equipo. Catálogos y Cliente admiten importación; remove (desactivación) solo está habilitado para Catálogos. En clientes y equipos se conserva el registro y se cambia su estado. Las entidades futuras están reservadas, con metadatos comunes. Sus campos de negocio completos se definirán al construir cada módulo; no constituyen un esquema MySQL definitivo.

La captura web usa RecordForm y RecordsPage. Clientes se presenta como directorio con ficha lateral mediante ClientDirectory y ClientInspector: búsqueda, filtro de estado y secciones Resumen, Equipos, Contactos y Sedes. La selección explícita se mantiene en el parámetro cliente de la URL; al filtrar se muestra un cliente de los resultados o el estado vacío. En móvil, la ficha se coloca debajo de la lista. Los campos son columnas declaradas en el modelo; cleanFields excluye identificadores y campos ajenos. Las relaciones se validan al guardar todo el estado: contacto/sede deben tener cliente existente; una sede asignada a equipo debe pertenecer al cliente seleccionado. Cambiar el cliente en el formulario limpia la sede. Los correlativos de equipos propios y de cliente se calculan por prefijo TCL/TCE. Alta de equipo, lectura inicial y auditoría se escriben en una sola confirmación. Los nuevos equipos no reciben reparaciones ficticias.

La ficha de cliente permite varios contactos y varias sedes. La sede conserva la dirección y una referencia de ubicación / Plus Code como texto, sin geocodificación. Los datos de Distelsa proporcionados como idea se usan en placeholders; no se registraron como un cliente real ni se enviaron a un servicio externo.

`LocalDataSource` también ofrece respaldo/restauración administrativos. El formato tiene `schemaVersion` y `revision`. Las versiones desconocidas o los estados dañados se rechazan sin sobreescribirlos. No se reinicializan los datos existentes.

La ampliación del expediente añade una sola vez 3 servicios y 10 lecturas por equipo original de muestra. Utiliza OrdenServicio, LecturaHorometro, OTRepuesto y OTHoras, ya presentes en el esquema 1. Se identifica por una entrada estable en Bitacora, preserva los catálogos y aumenta la revisión al persistir. No añade muestras a equipos con serie u horómetro modificados ni con historia previa. La misma actualización se aplica a respaldos anteriores al restaurarlos. Los nuevos respaldos incluyen el historial. Un fallo de escritura conserva el almacenamiento anterior.

Para conectar MySQL, se implementará un proveedor HTTP que cumpla estas interfaces. Node será responsable de autenticación, autorización por empresa/usuario, validaciones, transacciones, correlativos, auditoría y adjuntos. Las credenciales MySQL nunca irán en el código del navegador ni en variables VITE_.

## Permisos

La primera etapa incluye guardas de navegación y filtrado de muestras según rol. Son simulaciones y no reemplazan controles del servidor. Los catálogos y respaldos solo se modifican desde administración. La vista previa, importación y exportación comprueban Administración en la operación, además de ocultar botones para otros roles. El repositorio elimina campos costo_ para perfiles no administradores al consultar. Coordinación consulta el expediente sin importes y sin exportación; los permisos finales de costos se revisarán en etapa 8. Técnicos no acceden al inventario completo. El cliente recibe solamente registros de su empresa en las consultas locales.

El expediente consulta los repositorios y agrupa por equipo y orden. Los filtros de fecha se evalúan en Guatemala. El uso es la diferencia entre la primera y última lectura seleccionada, sin repartirlo entre días sin medición. Una única lectura, ausencia de lecturas o un descenso intermedio del horómetro produce un valor no calculable. Cada fila muestra el intervalo desde la lectura anterior, aunque esta quede fuera del filtro; ese intervalo inicial no se suma al total del período. La gráfica usa fechas proporcionales. Las horas de técnico se presentan por separado.

## Excel

SheetJS CE 0.20.3 se instala desde su distribución oficial. Catálogos utiliza nombres de encabezado estables. Las fechas de auditoría se conservan como ISO en el respaldo y se muestran dd/mm/aaaa, hora 24 h en America/Guatemala. Las cantidades monetarias se formatearán como Q 1,234.50.

Importación: máximo 8 MB y 2000 filas; validación completa de filas, tipos, listas, duplicados y existencia de IDs. Importar se confirma explícitamente, todo o nada. Exportar respeta filtros. El respaldo incluye una hoja por entidad y metadatos de versión. Su restauración valida entidades, autoría, identificadores, fechas y referencias de equipos a clientes. Los adjuntos quedan fuera porque aún no existen en esta etapa.

ClientImportDialog usa parseClientWorkbook para las hojas Cliente, Contacto y Sede. planClientImport comparte la validación entre vista previa y confirmación; no modifica los datos originales. LocalDataSource.importClients valida el rol y la revisión, genera códigos y metadatos, vincula contactos/sedes por referencia_cliente o cliente_id, y confirma las tres entidades con una entrada de bitácora en una sola escritura. Los IDs existentes permiten actualizar; las columnas opcionales ausentes conservan los datos actuales y las celdas vacías de columnas presentes los borran. Se ignoran filas vacías y se rechazan fórmulas, errores de Excel y encabezados desconocidos. Un error de fila, revisión o almacenamiento conserva el lote anterior completo.

## Decisiones pendientes por etapa

- Etapa 2: prioridades de cobertura contractual y tratamiento de adendas.
- Etapa 4: alcance del SLA, horarios, pausas y valores por prioridad.
- Etapa 5: tarifa de mano de obra, cobertura parcial, correcciones de una OT firmada.
- Etapa 6: base del PM en horas/fecha del último mantenimiento; anticipos, atrasos y cambios de horómetro. No mover el umbral con cada lectura.
- Etapa 7: umbral de salto anormal, ítems críticos por tipo y política de equipo sin revisión.
- Etapa 8: tope total diario, reparto de viáticos entre OT y permisos del coordinador para costos.
- Antes de operación real: escoger proveedor de datos definitivo y adelantar autenticación/servidor si la empresa quiere usar el portal antes del prototipo completo.

## Próximas etapas

1. Base y diseño (esta entrega).
2. Clientes y contratos.
3. Flota completa.
4. Tickets.
5. Órdenes, firma y PDF.
6. Preventivos y calendario.
7. Checklist, QR y horómetros.
8. Horas, viáticos, costos y reportes.
9. Portal del cliente.
10. Dashboard e integración final para publicación de prueba.

Cada entrega se revisa y ajusta antes de continuar. El dashboard operativo se construye al final; el inicio actual es una presentación con datos de muestra.
