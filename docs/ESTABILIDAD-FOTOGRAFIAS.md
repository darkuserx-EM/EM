# Revisión de estabilidad · 09/10/2026

Actualización: la separación de fotografías, miniaturas, caché con autorización y recuperación completa se describe en [Fotografías MySQL](FOTOGRAFIAS-MYSQL.md). Las observaciones siguientes conservan el diagnóstico y las decisiones del 09/10; el almacenamiento privado actual no depende de Drive.

La propuesta recibida detecta correctamente el crecimiento de las fotografías base64 dentro de `em_records`. Sus mediciones sintéticas no establecen un número universal de equipos soportados: dependen del tamaño de cada imagen, del motor JavaScript y de la memoria disponible. No se ha ejecutado esa prueba de saturación contra producción.

## Cambios de este bloque

- La ruta de fotografías consulta únicamente el equipo solicitado mediante su clave compuesta. Conserva la comprobación de sesión, visibilidad y huella. La reasignación a otro cliente y la retirada de una imagen se respetan en la siguiente petición. Se mantiene `no-store`: conservar una imagen un día en caché podría permitir mostrarla sin volver a comprobar los permisos.
- El guardado usa referencias compactas de las fotografías existentes mientras trabaja el dominio. Antes de persistir, las resuelve contra la instantánea bloqueada del mismo equipo/campo. Así se evita concatenar todas las fotografías existentes en las copias JSON intermedias; se conservan autoría, validación, control de revisión y transacciones. No es una migración del almacenamiento.
- La caché mide bytes UTF-8 por registro, incluyendo la estructura JSON, y deja de medir al exceder 32 MiB. Si falla la medición se descarta la caché; una escritura ya confirmada no falla por esa causa. Se mantienen la agrupación de lecturas concurrentes y la protección frente a instantáneas antiguas.
- Las nuevas imágenes se optimizan en el navegador: referencia hasta 1600 px, vistas hasta 2000 px y placa hasta 2400 px por el lado mayor. Se conserva la proporción y no se amplían imágenes pequeñas. La placa recibe mayor calidad de codificación; el objetivo máximo es 1,500,000 caracteres por imagen. Si un original pequeño pesa menos que la versión recodificada se conserva. El servidor sigue aceptando las fotografías antiguas con el límite previo.
- La limpieza de sesiones y límites vencidos procesa hasta 20 lotes de 500 filas por tabla. Se detiene al agotar los vencidos, conserva registros activos y no toma el bloqueo global de datos de la aplicación.

## Verificación

Las pruebas comprueban permisos y reasignación de imágenes, lectura puntual sin cargar una instantánea, conservación de fotos originales durante la edición, rechazo de referencias cruzadas, seis fotografías en un guardado, tamaño UTF-8, fallo de caché y trabajo acotado de limpieza. Las pruebas de navegador verifican el peso y la legibilidad de una placa real y una imagen de referencia, sin guardarlas en producción. La integración con MySQL verifica también una cola de más de 1,200 límites vencidos y la lectura aislada de un equipo incluso si otra fila contiene JSON inválido.

En la comprobación local del 09/10, la placa de prueba pasó de 1,219,206 a 186,644 bytes (84.7% menos) y la referencia de 86,632 a 11,782 bytes (86.4% menos). Son dos muestras, no una reducción garantizada para todas las imágenes. Se mantuvieron legibles modelo y serie en la placa comparada. Las capturas y los respaldos completos se conservan fuera del repositorio público.

## Decisiones sobre lo pendiente

| Sugerencia | Decisión y motivo |
| --- | --- |
| Fotografías en `em_media` | Siguiente cambio de arquitectura, prioritario antes de cargar fotografías en volumen. Requiere migración repetible, control de acceso, referencias íntegras y recuperación ensayada. Este bloque reduce copias y lecturas; las instantáneas y la validación completa siguen creciendo con los datos. |
| Excel con referencias y fotos solo en copias del proveedor | No adoptar así. Una referencia no recupera el archivo si se pierde la base. Preparar un respaldo independiente que incluya imágenes, metadatos y restauración probada. Las copias del proveedor son complementarias y debe comprobarse su cobertura y retención. |
| Aumentar límites de memoria, caché o restauración | No. Desplaza el problema. La restauración HTTP sigue limitada a 32 MiB y debe rediseñarse con el respaldo de medios, sin una petición JSON gigante. |
| Bitácora propia y validación incremental | Seguimiento de arquitectura separado del fallo ya corregido de 20,000 filas. Conservar unicidad, relaciones, autoría, exportación y restauración antes de retirar validación completa. |
| Confirmar proxy (#4) | Sigue pendiente la comparación desde dos redes y la configuración del alojamiento. Mantener el diagnóstico deshabilitado fuera de esa prueba. No inferir saltos confiables por una IP privada. |
| Motor/versión y `max_allowed_packet` reales | Obtener por consulta de solo lectura en el alojamiento; no suponer MariaDB ni un límite de paquete. Después ajustar o ampliar la matriz de integración. MySQL 8 sigue siendo el motor de ensayo, no una afirmación sobre Hostinger. |
| Aviso agregado de ataques repartidos | Útil en un bloque de observabilidad: requiere retención acotada, identificadores no reversibles y agrupación para no inundar el log. No reintroducir un bloqueo global de cuenta. |
| Aprobación obligatoria de otra persona | Conservar cero mientras haya una sola cuenta revisora; mantener PR y comprobaciones obligatorias. |
| Fijar acciones por SHA y Dependabot | Mejora de suministro válida, fuera de este bloque de carga y memoria. Hacerla conjuntamente para no dejar revisiones fijadas sin mantenimiento. |

Seguimiento: [medios y respaldo completo #19](https://github.com/darkuserx-EM/EM/issues/19), [bitácora y validación incremental #20](https://github.com/darkuserx-EM/EM/issues/20) y [proxy #4](https://github.com/darkuserx-EM/EM/issues/4). El fallo original de #1 se puede cerrar al trasladar sus tareas de arquitectura a #20.

Consulta privada previa a la migración de medios:

```sql
SELECT entity, COUNT(*) AS filas, SUM(OCTET_LENGTH(payload)) AS bytes
FROM em_records GROUP BY entity ORDER BY bytes DESC;
SELECT VERSION();
SHOW VARIABLES LIKE 'max_allowed_packet';
```

No copiar credenciales, registros ni respaldos a issues, acciones de GitHub o archivos públicos. Confirmar también cuota, retención y recuperación de copias del plan. Estos cambios no requieren contratar otro proveedor.

## Revisión de auditoría v0.2 y almacenamiento externo

La auditoría adicional revisó el commit `345d5fd`; el contraste se realizó sobre `a17a429` y el trabajo local posterior de planificación. Sus pruebas usaron una sustitución temporal de SheetJS y no ejecutaron MySQL. No reproducir esa sustitución ni atribuir sus alertas a la dependencia real. Los porcentajes de contraste del informe son mediciones de su demo; esta revisión no los reproduce como resultados propios.

### Decisiones de arquitectura

| Hallazgos | Decisión |
| --- | --- |
| A1–A3, B5, B9: almacenamiento y coste de escritura | Prioridad alta antes de incorporar fotografías en volumen. `em_records` ya contiene una fila por entidad/id, no un documento SQL único. `saveDatabase` escribe solo filas modificadas, pero la lectura, validación y comparación siguen procesando el conjunto. Separar medios primero y medir tiempo/memoria; después migrar entidades e índices de forma gradual. No aumentar el pool o los límites sin medir. |
| A4–A5: instantáneas y conflictos | Paginar bitácora, introducir consultas por recurso y versiones por registro. La consulta periódica sin cambios ya devuelve 204; no equivale a descargar todo cada 15 segundos. Tras una modificación sí se vuelve a recibir la vista filtrada completa. |
| A6–A9: dominio, identidades y migraciones | Añadir migraciones numeradas antes de transformar tablas. Unificar identidad y autoría de bitácora con cuentas reales. Desacoplar reglas de negocio del almacenamiento local al introducir repositorios SQL. Cambiar todo el servidor a TypeScript no es urgente. |
| B1–B3: proxy, usuarios y datos visibles | Verificar proxy antes de ampliar usuarios. Implementar administración de cuentas y lista explícita de campos visibles por rol. El ID interno del cliente y el motivo operativo fueron solicitados como información visible: no retirarlos indiscriminadamente. Separar notas internas de observaciones para el cliente. |
| B4, B6–B8: sesiones y operación | Añadir inactividad con aviso para no perder formularios; el sondeo automático no debe renovar actividad humana. Medir latencia/errores sin registrar cuerpos, credenciales o imágenes. Revisar retiro del token de instalación. Mantener dependencia SheetJS e integridad; preparar distribución alternativa si se repite el problema de disponibilidad del CDN. |
| F1–F3: legibilidad y datos del navegador | Formato y análisis estático en un PR mecánico independiente. Tokens visuales graduales. Evaluar caché por recurso después de separar endpoints; incorporar otra librería no corrige por sí sola el coste de las instantáneas. |
| F4–F6: pruebas y carga inicial | Añadir pruebas de navegador de flujos críticos y medición de carga; mantener las pruebas del dominio y MySQL. Dividir páginas pesadas cuando los tiempos lo justifiquen. No hay urgencia en retirar la clave de montaje por actor. |
| U1–U6: navegación e información operativa | Reducir módulos sin funcionalidad, avisos de cero y banners repetidos. Priorizar pendientes reales, búsqueda y equipos en móvil. Reubicar estados junto al equipo. Integrar por pantalla con comparación visual, sin reemplazar toda la interfaz en un cambio. |
| U7–U9 y UI1–UI6 | Proteger formularios con cambios, mejorar tamaños y contraste, objetivos táctiles y foco. El nuevo formulario de planificación incorpora estas medidas; el resto requiere un bloque propio. Los estados ya tienen texto, aunque pequeño: no dependen exclusivamente del color. Un cambio global de tipografía necesita pruebas visuales. Modo oscuro no es prioritario. |

### Decisión tras revisar AppSheet con Google Drive

La aplicación existente usa Google Sheets y referencias de archivo en las columnas `Foto Antes` y `Foto Despues`. Se comprobó una correspondencia entre un ID de reporte, su ruta relativa y un archivo de Drive. Los ejemplos, identificadores de cuenta y capturas se mantienen fuera del repositorio público. AppSheet conserva activada la firma de URL; no desactivarla para integrar el portal.

**Primera opción a ensayar: Drive como origen privado de fotografías y Hostinger para la aplicación.** Aprovecha el almacenamiento existente y permite consultar las fotos históricas sin moverlas ni duplicarlas. Es una decisión de diseño; el portal todavía no tiene conexión permanente con Drive y no se han migrado medios.

- Registrar en una tabla de medios: ID estable del archivo de Drive, tipo, tamaño, huella calculada una vez, dimensiones, equipo/reporte, categoría (antes/después, placa o vista), orden, autor y fecha. Conservar ID y ruta de origen de AppSheet para importaciones repetibles. El nombre de archivo no es una clave única de Drive.
- Autorizar cada consulta según sesión y cliente en el servidor. Credenciales de Google solo en servidor. No convertir carpetas en públicas ni utilizar enlaces de la vista previa de AppSheet como enlaces permanentes.
- Servir miniaturas y versiones de consulta al abrir el expediente; original disponible bajo demanda. Mantener controles de acceso al usar caché y al reasignar equipos. Acotar memoria, concurrencia y tamaño por archivo, y manejar cuotas/errores de Drive sin bloquear el guardado de otros datos.
- Para nuevas fotos, carga separada del formulario (por archivo, con reintentos e identificador de operación). El equipo/reporte almacena referencias, no base64. Usar una colección de evidencias por reporte para permitir varias fotos antes y después, sin multiplicar columnas fijas.
- Durante la convivencia, AppSheet es el origen de sus reportes históricos. Empezar con lectura/importación unidireccional e idempotente; no activar escritura bidireccional ni sobrescribir correcciones del portal sin definir quién es dueño de cada campo. No usar el número de fila de Sheets como identidad del reporte.
- La autorización de este chat a Drive no autoriza automáticamente al servidor del portal. Configurar una conexión permanente con acceso mínimo a los archivos necesarios. Si las nuevas cargas usan una cuenta de servicio, verificar propiedad y cuota: no suponer que hereda el espacio personal del usuario. Para My Drive, evaluar OAuth de la cuenta propietaria y su revocación/renovación.
- Mantener respaldo independiente que incluya archivos y metadatos, política de retención y recuperación ensayada. Drive como almacenamiento principal no sustituye un respaldo. Nunca borrar originales al migrar sin copia y verificación.

Hostinger puede ser otro proveedor de archivos, pero antes hay que demostrar que el directorio privado persiste tras reinicio y despliegue, que tiene permisos apropiados y que entra en respaldos recuperables. El espacio libre del plan no prueba esa persistencia. Google Cloud Storage es una alternativa futura con facturación separada; no usa automáticamente la cuota de Google One/Drive.

### Prueba de aceptación del siguiente bloque de medios

1. Vincular un reporte de muestra a sus imágenes antes/después mediante ID de Drive, sin mover originales ni alterar AppSheet.
2. Comprobar acceso autorizado y rechazo entre clientes, usuario sin sesión, archivo retirado y equipo reasignado.
3. Medir carga inicial y apertura de imágenes con miniaturas, concurrencia, errores y cuota. Sin cargar todos los originales en una instantánea.
4. Guardar y consultar medios tras reinicio/despliegue; probar duplicados, cargas interrumpidas y revocación de autorización de Google.
5. Restaurar un respaldo en un entorno aislado y comparar referencias y huellas. Migrar gradualmente las imágenes actuales solo después de estas pruebas.

Fuentes oficiales consultadas: [referencias de archivo y firma de URL en AppSheet](https://support.google.com/appsheet/answer/10107317?hl=en), [descarga autorizada mediante Drive API](https://developers.google.com/workspace/drive/api/guides/manage-downloads), [límites de Drive API](https://developers.google.com/workspace/drive/api/guides/limits), [almacenamiento de Google One](https://support.google.com/googleone/answer/6374270?hl=en) y [facturación de Cloud Storage](https://cloud.google.com/storage/pricing).

## Publicación y reversión

Conservar un respaldo privado antes de publicar, exigir las comprobaciones de la rama protegida y comparar todos los registros después. No se transforma ninguna fotografía existente ni se modifica el esquema. Ante una regresión, revertir el código mediante PR y publicar la revisión anterior; no restaurar datos antiguos para revertir este cambio.
