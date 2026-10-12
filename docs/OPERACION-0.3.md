# Portal EMSA · Entrega operativa 0.3

Gestión actual de altas, renovaciones, reactivación y recuperación administrativa: [Cuentas y recuperación](CUENTAS-Y-RECUPERACION.md). Respaldo de fotografías y evidencias: [Fotografías MySQL](FOTOGRAFIAS-MYSQL.md).

Las altas y actualizaciones de tickets, órdenes y lecturas se validan contra los datos actuales dentro de la transacción. Un cambio ajeno no rechaza el guardado por revisión global. Las actualizaciones siguen exigiendo la versión original del registro (`expected_updated_at`); un conflicto de la misma orden se informa sin reintentar ni sobrescribir. Las altas conservan `solicitud_id` para reintentos idempotentes. Catálogos, clientes, equipos, importaciones y restauraciones mantienen el control de revisión global. El bloqueo y la validación completa de la base siguen vigentes; este ajuste reduce conflictos innecesarios, no sustituye la evolución de almacenamiento del issue #20.

Fecha de revisión: 10 de octubre de 2026. Base: `8d58852`. Contratos, checklist diario, horas de técnicos y viáticos quedan fuera de esta entrega por alcance.

## Cambios por módulo

| Módulo | Resultado |
|---|---|
| Inicio y reportes | Indicadores vinculados a detalle; filtros cliente/equipo/fecha/origen; barras mensuales seleccionables y alertas de planes. Se eliminó el texto de revisión entre asistentes. |
| Solicitudes | Cliente crea solicitudes únicamente para su equipo. Coordinación/administración asigna, programa y vincula una OS. |
| Órdenes | Captura en cinco pasos: identificación, diagnóstico, trabajo, pruebas/cierre y evidencias. Incluye insumos y repuestos descriptivos, H1 en horas, H3 en millas y nombre del receptor. Impresión mediante el navegador a PDF. |
| Calendario | Año, mes y semana; filtros, navegación y detalle. Citas confirmadas separadas de vencimientos/proyecciones de planes. Fechas en Guatemala. |
| Planificador | Tablero por estado con arrastre y alternativa accesible por selector. El cierre redirige al reporte para revisar las pruebas. Históricos excluidos del trabajo pendiente. |
| Mantenimiento | Frecuencias por equipo: presets recomendados y valores personalizados. Se conserva base confirmada, motivo, versiones y datos originales. Mayor continúa por horas. |
| Cliente | Flota propia, ficha segura, historial visible, uso mensual, fotos, solicitudes, agenda e indicadores. Los reportes requieren publicación explícita desde administración/coordinación; los importados sólo desde administración. |
| Técnico | Sólo sus órdenes y recursos relacionados. Puede documentar ejecución y evidencias; no cambia asignación, cliente ni estado operativo del equipo. |
| Cuentas | Alta de técnico/cliente con contraseña aleatoria, vigencia de 1–365 días y revocación. Reintento de alta idempotente. No permite crear otro administrador desde esta pantalla. |
| Adjuntos | Antes, después y documento. Acceso privado por orden, validación binaria, carga idempotente y consulta puntual. Máximo 20 archivos por OS, 4 MiB almacenados por archivo; fotos de hasta 10 MB se optimizan en el navegador. |

## Reglas preservadas

- No convertir reportes importados en órdenes actuales ni modificar su contenido original. Sólo su visibilidad puede publicarse explícitamente.
- Un cierre exige diagnóstico, trabajo, pruebas y resultado. No declara operativo el equipo ni resuelve un hallazgo automáticamente.
- Programar requiere fecha y técnico. Las transiciones fuera del flujo se rechazan en servidor.
- H1/H3 ausentes no equivalen a cero. Se rechazan lecturas regresivas; se conserva una lectura numérica existente. Los cambios de contador y correcciones retroactivas requieren un flujo posterior con evidencia original.
- Conflictos de revisión y formularios obsoletos se rechazan; los reintentos de altas no duplican registros.
- Cada empresa ve sólo sus equipos y reportes publicados. Costos internos y configuraciones quedan excluidos.
- No se suman monedas ni se representan horas de servicio como horas de operación. Las barras de servicios cuentan órdenes; las de uso de equipo siguen indicando estimaciones.

## Persistencia y archivos

Las evidencias de órdenes están en `em_attachments`, separadas de `em_records` y del snapshot que sincronizan las pantallas. No dependen del directorio temporal de despliegue. Las fotos existentes de equipos siguen en su almacenamiento previo. Este almacenamiento acotado en MySQL permite operar sin credenciales nuevas de Drive y conservar permisos; no equivale a una solución de objetos para volúmenes ilimitados. La integración Drive/AppSheet y la migración a un repositorio de objetos quedan para una decisión posterior.

Migración aditiva: tablas `em_attachments`, `em_security_events`; columnas nullable `em_users.expires_at`, `creation_request` única. No elimina ni reescribe registros existentes ni cuentas. Las operaciones de negocio mantienen el bloqueo transaccional de revisión. La descarga de cada foto consulta sólo su OS y después el binario autorizado.

## Respaldo y recuperación

1. Descargar **Respaldo de registros** XLSX y **Descargar evidencias** JSONL desde Datos y respaldos. Guardarlos juntos. El XLSX contiene también logos, imágenes y placas de equipos.
2. El JSONL incluye identidad, orden, autor, fecha, bytes y SHA-256 por archivo; termina con un cierre que permite detectar una descarga interrumpida.
3. En recuperación, restaurar primero registros y después evidencias. La interfaz verifica cierre, conteo y huella de cada archivo; el servidor vuelve a comprobar formato, tamaño y huella.
4. La restauración de evidencias es incremental e idempotente; jamás sobrescribe un archivo diferente con la misma identidad. Si una carga se interrumpe, se puede repetir. No elimina otros archivos.
5. Cuentas, hashes, sesiones y configuración requieren además el respaldo completo del alojamiento/MySQL. El respaldo operativo descargable no los exporta.

Antes de esta entrega se guardó un respaldo privado de producción, revisión 60, 477 registros, y se verificó restauración aislada conservando registros y bitácora. El archivo, las credenciales y las capturas privadas permanecen fuera de Git. También se probó recuperación binaria en una base MySQL/MariaDB temporal.

## Pruebas y auditoría

Pruebas locales: TypeScript y compilación; 166 pruebas de dominio/interfaz, 40 HTTP/seguridad y 23 de integración con MariaDB 11.8.6 real en loopback. CI ejecuta además integración con MySQL 8 y Node 24. Los tests crean bases sintéticas nuevas y eliminan sólo esas bases al finalizar.

Casos comprobados: permisos cruzados cliente A/B y técnicos; descarga ajena rechazada; revocación y vencimiento; reintento de cuenta/orden/archivo; edición concurrente; cierre atómico y lectura regresiva sin efectos parciales; restauración de registros/auditoría y bytes; corrupción y descarga incompleta; datos históricos sin fecha; campos de contador opcionales vacíos.

Recorrido visual autenticado con datos sintéticos LAMFER — PRUEBA / DISTELSA — PRUEBA: administración, técnico móvil y clientes; calendario anual/mensual/semanal; cambio de estado del kanban; edición del reporte y guardado sin horómetro. Las capturas y los accesos de prueba se entregan por separado, fuera del repositorio.

Hallazgos corregidos en la auditoría: fechas históricas vacías que rompían el dashboard; carga de la base completa al abrir cada foto; cuerpos grandes procesados antes de verificar el rol; falta de recuperación de las nuevas evidencias; contador vacío rechazado; enlace de técnico hacia ficha interna no autorizada; riesgo de perder contraseña ante un reintento de alta.

## Publicación y reversión

Publicar mediante PR hacia main después de checks verdes. Hostinger sigue main mediante su integración existente. Verificar estado de despliegue, `/api/health` con `release: 0.3.0`, sesión, consultas autenticadas y conservación de registros.

Para una reversión de código, volver al despliegue anterior conservando tablas y columnas nuevas; no ejecutar migraciones destructivas. Las nuevas órdenes requieren esta versión para editarse. Si hay que recuperar datos, usar los respaldos comprobados en aislamiento antes de restaurarlos en producción. No restaurar los datos anteriores sólo por revertir la interfaz.

Las cuentas de prueba vencen. Administración puede revocarlas desde Roles y accesos; esto cierra sus sesiones sin borrar autoría ni reportes. La cuenta técnica real de prueba se crea sin asignar equipos reales automáticamente. Los clientes sintéticos para QA permanecen en el entorno aislado.

## Límites y siguientes entregas

- Contratos, checklist, QR operativo, horas, viáticos y costeo estructurado: reservados por alcance.
- Firma digital trazable, inventario/consumo estructurado de repuestos, SLA y notificaciones automáticas: no implementados en esta entrega; el nombre del receptor no se presenta como firma.
- Correcciones retroactivas y reemplazo de contador con segmentos de uso: pendientes de diseñar; no se inventan ni sobrescriben lecturas.
- AppSheet se revisó como referencia de captura; no se modificó su aplicación ni se enlazó Drive.
- Pruebas móviles realizadas con viewport en navegador; no representan pruebas en hardware de todos los modelos de teléfono.

### Carga e indicadores de conexión

Inicio, flota y administración se descargan al abrir su pantalla. Excel ya tenía carga diferida: se conserva y no se modifica su API. Las reglas compartidas de administración permanecen globales. El indicador muestra el resultado de la última sincronización (gris al comprobar, rojo al fallar, verde al confirmar); no garantiza disponibilidad futura. La ruta de muestra del operador solo existe en modo local. Los nombres del respaldo Excel usan la fecha de Guatemala.

### Bitácora y eventos paginados

La sincronización conserva una colección Bitacora vacía por compatibilidad. El historial real se consulta en /api/audit-log, solo para administración, con cursores por fecha e identificador y filtros por equipo, hallazgo, entidad, acción y fechas de Guatemala. Datos y respaldos permite cargar más; el historial específico se consulta al expandirlo. El índice em_audit_index se rellena en la migración 5 y se actualiza en la misma transacción que los registros. Los respaldos conservan toda la bitácora. La restauración sigue preservando la bitácora vigente.

Roles y accesos incluye /api/admin/security-events, paginado e indexado; nunca devuelve hashes ni contraseñas. Esta mejora reduce las respuestas de sincronización, pero la validación de escrituras todavía lee el conjunto operativo (#20). Reversión: revertir el código; conservar los índices y tablas, que son auxiliares y no alteran los registros originales.

### Solicitudes en el calendario

Las solicitudes operativas con fecha y sin orden aparecen en las vistas anual, mensual y semanal. Las abiertas sin fecha aparecen en «Por programar», ordenadas por prioridad y antigüedad. Las resueltas y canceladas requieren el filtro de estado. La fecha de creación nunca se interpreta como visita.

Cuando existe una orden vinculada, solo esa orden genera la cita y conserva su fecha. La relación se comprueba antes de filtrar fechas y estados, incluso si la orden es privada, borrador o cancelada. Un indicador de solo lectura evita duplicados sin revelar datos de órdenes ajenas. El ticket conserva sus datos originales; en su consulta se distingue la programación de la orden.

Administración y coordinación pueden revisar y programar solicitudes. El cliente consulta las de su empresa y las órdenes compartidas. El técnico consulta únicamente tickets asignados a su responsable, sin poder editarlos; también puede consultar el equipo correspondiente. Las restricciones se aplican en servidor, consultas paginadas y archivos.

Validación: 270 pruebas de aplicación, 47 de servidor y 79 de integración MySQL/MariaDB; tipos y compilación. Recorridos autenticados aislados de administrador, coordinador, cliente y técnico; programación persistida, deduplicación, permisos cruzados y móvil de 390 px. La suite local completa pasó con dos trabajadores; la ejecución paralela inicial agotó el tiempo de tres pruebas existentes de validación incremental. CI debe pasar antes de fusionar.

### Cierre de solicitudes desde órdenes

Al completar una orden operativa se resuelven sus tickets abiertos solo si todas sus órdenes vinculadas también están completadas. Se reconocen ambos enlaces históricos (ticket_id y orden_id); no se relacionan solicitudes por compartir equipo. Un borrador, orden pendiente, cancelada, histórica o vínculo contradictorio conserva la revisión manual. No se reescriben solicitudes ya resueltas/canceladas ni se procesan cierres antiguos en bloque.

El cambio de estado del ticket, su autor y fecha, la lectura opcional de cierre, la orden y sus entradas de bitácora se confirman en la misma transacción. La bitácora identifica ticket y orden que provoca el cierre. Un técnico no obtiene permiso para editar tickets: esta transición es una consecuencia de completar su orden autorizada. Si fallan validación, lectura, versión o persistencia, no se guarda ningún cambio parcial. Dos cierres simultáneos se reevalúan sobre la revisión vigente y generan una sola resolución. Estado del equipo, hallazgos y visibilidad del reporte conservan su gestión independiente.

Evaluación del reporte de flujos recibido el 12/10/2026:

- FR-01: la ficha de cliente ya reúne Equipos, Contactos y Sedes con altas vinculadas; no se añade otro asistente.
- FR-02: ya hay campos numéricos, unidades y selector de voltaje. Se descarta extraer números ignorando sufijos: aceptar kg como lb o metros como pulgadas corrompería las medidas.
- FR-03: se incorpora la resolución transaccional anterior. La creación de orden desde ticket ya precarga equipo, cliente, sede, descripción, prioridad, fecha y responsable.
- FR-04: el reporte ya tiene cinco pasos y permite guardar avances antes del cierre; conserva el borrador ante errores. El cierre exige cuatro textos, no seis; horómetro, causa confirmada y receptor siguen opcionales.
- FR-05: el costeo e inventario estructurados requieren su etapa propia. No se deducen consumos ni importes del texto libre y no se inventan costos.
- FR-06: las sedes y condiciones de acceso ya se gestionan en la ficha; la orden admite seleccionar la sede. Se conserva la posibilidad de registrar solicitudes urgentes con información incompleta.

Pruebas del cierre: 280 pruebas de aplicación, 47 de servidor y 81 de integración con base de datos; lint, tipado y compilación correctos. Se comprobó el cierre autenticado por técnico desde la interfaz sin inventar horómetro, conservación del historial, aislamiento del cliente, concurrencia entre dos órdenes y reversión ante fallo de auditoría.
