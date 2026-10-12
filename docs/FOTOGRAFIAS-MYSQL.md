# Fotografías separadas y recuperación

## Alcance

Las seis imágenes de Equipo se guardan en `em_media`. El registro operativo contiene únicamente `media:<sha256>`. La huella de referencia sigue siendo SHA-256 de la data URL original; se conserva además SHA-256 de los bytes para verificar integridad.

Se conserva el alojamiento MySQL existente. No se suben fotos a enlaces públicos ni a Google Drive. `sharp` decodifica las nuevas imágenes y genera miniaturas de hasta 480 × 360; `@noble/hashes` verifica el respaldo por partes en el navegador, sin cargar todos los binarios a la vez. Las dependencias tienen versión exacta e integridad en el lockfile.

## Migración y permisos

- La estructura añade `em_media`, recibos temporales `em_media_uploads` y una copia privada de los registros originales en `em_media_migration`.
- La migración toma un equipo por transacción, valida los bytes escritos y después reemplaza sus data URL. Al terminar marca `schema_version >= 3`. Una interrupción se reanuda; repetir no cambia la revisión si no hay imágenes pendientes.
- Se mantienen lecturas compatibles mientras avanza la migración. Los nuevos guardados almacenan referencias y las nuevas fotos se suben individualmente, después de comprobar sesión, rol y CSRF.
- Un recibo pertenece a un administrador, campo y equipo. Conocer una huella no permite reutilizar una fotografía ajena.
- La descarga consulta el equipo y, para técnicos, sus órdenes asignadas, sin leer toda la base. Las miniaturas no leen el BLOB original salvo que no exista miniatura.
- `Cache-Control: private, no-cache` y ETag permiten una respuesta 304, pero cada petición vuelve a autorizar. No se usa una caché inmutable de un año para evidencia privada. Revocar una cuenta o reasignar un equipo impide nuevas descargas, incluso con ETag.
- Retirar o reemplazar una imagen conserva el original para recuperación. El portal solo sirve la referencia activa. No hay borrado automático de evidencia; solo caducan recibos temporales de carga.

## Exportación y respaldos

Exportar equipos o historial genera datos sin fotos; la interfaz lo indica. El respaldo Excel existente conserva imágenes para compatibilidad, con un límite de materialización de 24 MiB de imágenes. Para flotas con fotos debe usarse **Datos y respaldos → Respaldo completo**.

El respaldo completo JSONL transmite registros, fotos actuales y retiradas y adjuntos de órdenes de uno en uno. Incluye conteos y huella final. Una descarga incompleta o un binario corrupto no se acepta. Las cuentas, sesiones, eventos de seguridad y configuración siguen necesitando la copia completa de MySQL del alojamiento.

Para recuperar:

1. Conservar la copia completa del estado actual.
2. Seleccionar el archivo y comprobar conteos e integridad antes de confirmar.
3. El portal prepara fotos y evidencias; solo después reemplaza los registros en una transacción. Un fallo anterior conserva los registros vigentes; los archivos preparados no se duplican al reintentar.
4. La bitácora vigente se conserva. En una base operativa vacía, con solo catálogos iniciales y sin bitácora, se recupera también el historial del archivo.
5. Comparar entidades, referencias, tamaño y huellas de todos los binarios. Los respaldos Excel antiguos con imágenes siguen siendo compatibles.

La recuperación web de registros tiene un límite de 24 MiB, independiente de los binarios transmitidos por separado. Para registros mayores se usa recuperación MySQL en un entorno aislado.

## Verificación y reversión

`node scripts/equipment-media-storage.mjs status` muestra solo versión, cantidades y tamaños; usa las variables `DB_*` del servidor.

Antes de publicar, conservar respaldo privado y ensayar migración y recuperación aisladas. Las pruebas de integración cubren interrupción, repetición, autorización cliente/técnico, ETag, recibos, exportación sin bytes, guardados sin leer binarios, archivos corruptos y recuperación con catálogos iniciales.

El ensayo aislado del 11/10/2026 comparó todas las entidades y los bytes de imágenes y evidencias del respaldo privado: migración, repetición, recuperación y reversión correctas. Se verificaron también 208 pruebas de aplicación, 40 de servidor y 33 de integración MariaDB; la integración MySQL se repite en CI. No se incluyen datos privados en el repositorio.

El 12/10/2026 se verificaron MariaDB 11.8.9, `max_allowed_packet=1073741824`, el uso mostrado de 24 MB y el límite publicado de 3 GB por base para Business. Se descargó una copia real de Hostinger, se restauró en aislamiento y se compararon registros y archivos con el respaldo productivo: 529 entradas idénticas. Las fotos retiradas se conservan sin vencimiento automático. Ver [capacidad, retención y procedimiento probado](RECUPERACION-HOSTINGER.md), incluidas sus limitaciones y la necesidad de importar el SQL sin transformar bytes binarios.

Para volver a un código anterior que espera imágenes embebidas: detener la aplicación, comprobar una copia completa y ejecutar `node scripts/equipment-media-storage.mjs rollback --confirm-stopped --confirm-backup`. Reincorpora únicamente las fotos activas actuales, equipo por equipo, sin restaurar datos antiguos ni borrar tablas. Solo después publicar e iniciar la versión anterior. Reiniciar esta versión volvería a separar las fotos. Nunca restaurar toda la base antigua solo para revertir código.

Desde la revisión SQL, los adjuntos del respaldo se consultan en lotes con máximo 8 MiB de binarios y 50 filas; se siguen transmitiendo líneas individuales. Registros y fotografías conservan su recorrido anterior. Ver AUDITORIA-SQL-2026-10-11.md.
