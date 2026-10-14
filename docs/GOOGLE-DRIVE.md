# Fotografías y videos privados en Google Drive

## Videos de solicitudes y reportes

Se admiten MP4 no fragmentados de hasta **25 MiB y 60 segundos**, con una pista de video H.264 y audio AAC opcional. No se convierten automáticamente MOV, HEVC ni WebM; exportar a MP4 compatible antes de cargar. Los equipos mantienen sus fotografías y límites existentes.

El navegador envía partes de 1 MiB al servidor autenticado; el servidor las transmite a la sesión reanudable de Drive. La sesión y el ID reservado quedan en MySQL, sin bytes de video. Cada operación comprueba sesión, CSRF, rol y alcance del registro. La URI de carga y credenciales de Google nunca salen al navegador. El reintento consulta el progreso confirmado por Google; una respuesta perdida no duplica bloques. Una interrupción o reinicio conserva el progreso durante 24 horas; después se reinicia la carga. Las sesiones temporales vencidas se retiran, sin borrar archivos ni historial.

El cierre verifica SHA-256 y analiza el contenedor, códecs, duración y límites de muestras con MP4Box.js en un worker con tiempo/memoria acotados. Se permiten dos verificaciones simultáneas por proceso; las demás pueden reintentarse. Solo después se enlaza el archivo y se registra el evento de seguridad en la misma transacción. Un arrendamiento por carga impide escrituras simultáneas, sin mantener bloqueos operativos durante solicitudes a Google.

Clientes, coordinación y administración agregan evidencia a solicitudes abiertas; administración y el técnico asignado agregan Antes/Después a órdenes abiertas. Se mantienen los límites de **10 adjuntos por solicitud y 20 por orden**, contando fotos y videos. Los cuatro perfiles consultan según los permisos actuales. La orden muestra el video original de su solicitud, sin copiarlo. El reproductor es privado, no inicia automáticamente ni descarga videos antes de reproducir; admite rangos autenticados para avanzar.

Los respaldos completo y separado incluyen los bytes originales, metadatos y huellas de videos. Siguen leyendo archivos anteriores. Cada video se procesa individualmente; el tamaño máximo de una línea JSONL es 36 MiB, sin aumentar los límites de fotos/PDF. La recuperación de videos requiere Drive conectado y vuelve a validar el archivo, conservando IDs, autor, fecha, vínculo e historial. Si Drive falla, no se reemplazan registros. Conservar además la copia del alojamiento para cuentas/configuración. Las fotos/PDF de respaldos anteriores mantienen su recuperación local.

## Carpetas automáticas (etapa posterior a la activación)

La conexión está activa en producción. Las imágenes antiguas de prueba se retiraron con autorización del titular, respaldo completo y ensayo de recuperación; no se retiraron registros, historial ni logotipos de clientes.

El organizador crea `PORTAL_EM/Equipos`, `Solicitudes` y `Reportes`. Equipos usa `código_ID/Fotos` y `Miniaturas`; solicitudes y reportes agregan año de carga en Guatemala, `código_ID`, y `Fotos`, `Videos` o `Documentos` según MIME. Solo se crean subcarpetas necesarias. El ID corto evita confundir códigos históricos repetidos.

Las cargas nuevas se confirman primero y se clasifican después, fuera de transacciones operativas. En producción se dispara tras guardar un registro o evidencia y también durante el mantenimiento periódico (arranque y cada 15 minutos), en lotes de hasta 20 archivos. Una interrupción deja la misma referencia accesible y el siguiente ciclo reintenta. Los recibos sin registro guardado no se clasifican ni borran.

`em_drive_folders` reserva una única identidad por ruta; `em_drive_blobs.folder_id` registra la clasificación confirmada. Se mueve el archivo conservando su ID, contenido y checksum; no cambia fechas/autores de evidencia, permisos operativos, bitácora ni respaldo portable. El contenido reutilizado conserva su primer origen registrado: la orden enlazada no crea una copia del archivo del ticket. No reclasificar manualmente ni compartir estas carpetas. Antes de crear o mover, se valida que todos los padres pertenezcan a la carpeta privada del propietario; los reintentos de carga aceptan los originales ya clasificados.

El organizador también atiende archivos anteriores de Drive que ya están vinculados a registros. No convierte ni elimina los binarios locales, no toca AppSheet y no purga archivos históricos. Si Google falla, la clasificación queda pendiente, se registra un error seguro y el registro sigue guardado. Desactivar nuevas cargas a Drive detiene el organizador; los ID existentes continúan sirviendo para lectura.

## Alcance y activación

Proveedor optativo para archivos nuevos. `FILE_STORAGE=mysql` sigue siendo el valor predeterminado. No borra ni migra archivos existentes, no cambia registros ni permisos operativos. Activar `google-drive` únicamente después de completar la conexión del propietario, probar una carga real, descargar y verificar un respaldo completo y confirmar la configuración del alojamiento.

Fotografías JPEG, PNG y WebP, y documentos PDF de órdenes, conservan el límite de 4 MiB por archivo almacenado (equipos conservan su límite menor). Las imágenes siguen optimizándose según el formulario; no se promete conservar el original de cámara. Videos tienen la carga y límites propios descritos arriba; requieren `FILE_STORAGE=google-drive`.

## Cuenta propietaria y permisos

Para Google One personal se utiliza OAuth de la cuenta propietaria. No se reutiliza la autorización del conector de Codex ni una cuenta de servicio. Crear un proyecto de Google Cloud sin activar facturación, habilitar Drive API y Google Picker API y registrar una aplicación web con solo `https://www.googleapis.com/auth/drive.file`.

Crear una carpeta **PORTAL_EM**, privada y propiedad de la cuenta elegida. Si se creó con otra aplicación, seleccionarla expresamente en Google Picker: conocer su ID no concede acceso a la nueva aplicación. No solicitar el permiso general `drive`. No compartir la carpeta con clientes o técnicos, ni habilitar enlaces públicos. El servidor comprueba propiedad, nombre y ausencia de permisos compartidos antes de cada carga.

Los clientes y técnicos siguen usando las URL autenticadas del portal. El servidor comprueba empresa, asignación y vínculo de la solicitud/orden antes de descargar los bytes. No se entregan tokens ni enlaces de Drive. La orden consulta la evidencia del ticket mediante sus mismos identificadores; no copia las fotografías.

## Conexión inicial en el equipo del administrador

1. Configurar el consentimiento de Google y aceptar sus acuerdos solo con autorización del titular. Durante las pruebas agregar únicamente al propietario como usuario de prueba. Antes de activar producción, revisar el estado de publicación OAuth: un permiso de una aplicación externa en modo Testing puede caducar a los siete días. No publicar una conexión de prueba como permanente.
2. Crear un cliente OAuth web con origen `http://127.0.0.1:33124` y retorno `http://127.0.0.1:33124/callback`. Crear una clave para Google Picker, restringida a esa API y a los sitios `http://127.0.0.1:33124/*` y `https://docs.google.com/*`: Google requiere este último porque aloja el selector en un iframe. El cliente secreto no va en JavaScript ni en Git. Obtener el número real del proyecto para Picker.
3. Guardar en un archivo privado ignorado las variables `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_PICKER_API_KEY`, `GOOGLE_CLOUD_PROJECT_NUMBER`, `GOOGLE_DRIVE_FOLDER_ID` y `GOOGLE_DRIVE_OWNER_EMAIL`. Mantener ese archivo con permisos exclusivos del operador.
4. Ejecutar `node --env-file=private/google-drive-client.env scripts/connect-google-drive.mjs`. El asistente escucha solo en `127.0.0.1:33124`, comprueba Host, cookie, origen, CSRF, estado OAuth de un solo uso y PKCE; caduca a los 30 minutos. Autorizar con la cuenta propietaria y seleccionar **PORTAL_EM**. Verifica los permisos efectivos y el propietario antes de guardar. Conserva `Referrer-Policy: strict-origin-when-cross-origin`: permite que Google Picker valide la clave restringida sin enviar rutas ni códigos en el referente externo. `no-referrer` impide esa comprobación y puede convertir el origen del formulario en `null`, que el asistente debe seguir rechazando.
5. El resultado se guarda una sola vez en `private/google-drive-connection/authorized.env`, ignorado por Git. El directorio se restringe al operador en Windows y se crea con modo 0700 en sistemas POSIX; el archivo con modo 0600. No pegarlo en chats, capturas, incidencias ni PRs. Guardarlo en el gestor seguro y trasladar sus variables al servidor mediante la configuración privada del alojamiento. El asistente nunca publica ni modifica automáticamente producción.
6. Probar la conexión del **portal** con archivos sintéticos: equipo y miniatura, solicitud, evidencia de la orden vinculada y adjunto propio de orden. Comprobar descarga, reintento sin copias, perfiles y respaldo/restauración. Una carga hecha con otro conector de Drive no prueba esta conexión.

## Persistencia y concurrencia

`em_drive_blobs` almacena hash SHA-256, ID remoto, MIME, tamaño y confirmación. Las tablas `em_media`, `em_media_uploads` y `em_attachments` conservan sus metadatos, autores, fechas e identidades. Las nuevas columnas nullable `storage_key` y `thumbnail_key` distinguen explícitamente los archivos externos. Su contenido binario local queda vacío; los archivos antiguos permanecen íntegros.

Se reserva y persiste el ID remoto antes de subir. Una respuesta perdida o un reintento vuelve al mismo ID, y el hash evita duplicar contenido idéntico incluso entre equipo y orden. Se comprueba el checksum de Google antes de enlazar el archivo y al descargar. Las llamadas a Google se realizan fuera del bloqueo de escritura; después se vuelven a comprobar permisos, límites y estado dentro de la transacción SQL.

Una carga fallida no confirma un adjunto. Una carga remota que termine antes de un rollback puede quedar sin referencia: se conserva para el reintento. No hay borrado automático de huérfanos, archivos retirados o historial en esta etapa. Los errores de Drive devuelven 503 con referencia segura; no muestran claves ni respuestas privadas de Google.

## Respaldo y reversión

El respaldo completo y el respaldo de adjuntos descargan los bytes privados y comprueban integridad. El formato portable JSONL no cambia. Un archivo inaccesible impide emitir un cierre válido; nunca presentar una lista de referencias como respaldo completo. Las miniaturas se regeneran al restaurar.

La restauración recupera los bytes en MySQL, incluso cuando Drive está desconectado, conservando identidad, fecha, autor, vínculos e historial. Esto puede volver a ocupar espacio en la base y debe contemplarse en la recuperación. Importaciones antiguas con imágenes incrustadas y restauraciones conservan el comportamiento local por compatibilidad; no son la ruta ordinaria para nuevas fotografías.

Para detener nuevas cargas a Drive, cambiar a `FILE_STORAGE=mysql` **conservando las credenciales** mientras existan referencias externas: se siguen leyendo desde Drive. Retirar las credenciales sin recuperar los bytes provoca un aviso de almacenamiento desconectado, nunca una respuesta vacía que parezca una imagen válida. Un respaldo SQL por sí solo no contiene los archivos externos.

## Limpieza de datos de prueba

La autorización del titular para retirar imágenes de prueba no elimina registros de equipos, solicitudes, órdenes, PDF ni bitácoras. Antes de cualquier limpieza: inventario de referencias, respaldo completo con checksum y restauración comprobada en una base aislada. Después, retirar exclusivamente las imágenes autorizadas y registrar el alcance. No ejecutar un borrado general de `em_attachments` ni purgar carpetas de AppSheet. Esta implementación no ejecuta esa limpieza automáticamente.

## Evidencia de pruebas

- Pruebas del proveedor: permisos privados, checksum, límites, revocación, renovación concurrente, reintentos y rechazo de destinos de carga ajenos a Google.
- Asistente local: bloqueo de Host y origen ajenos, CSRF, PKCE, replay, alcance mínimo y selección exacta de carpeta; el refresh token nunca llega al navegador.
- MySQL real con transporte Drive simulado: perfiles administrador/coordinador/cliente/técnico, clientes ajenos y técnicos no asignados; fotos de equipo y miniaturas; ticket y orden sin copias; caída de Drive; respaldos completos, recuperación local e historial preservado.
- Validación manual del 13/10/2026: autorización OAuth limitada y selección de la carpeta privada completadas. Se ejecutaron los dos escenarios de integración de fotografías contra una base MariaDB sintética local y el proveedor **real** de Google Drive: 20 pruebas aprobadas (incluidos los dos escenarios principales), sin omisiones. Cubrieron fotografías de equipo y miniatura, ticket, orden vinculada sin copias, cuatro perfiles, rechazos de acceso ajeno, respaldo/restauración y fallos inducidos. Los fixtures locales sustituyeron únicamente el transporte simulado por el proveedor real; la interrupción de Drive y el fallo de auditoría se inyectaron deliberadamente. No se usaron registros de producción.
- Tras corregir el asistente: lint, tipado, 288 pruebas de aplicación, 56 de servidor y compilación aprobados. Estos resultados no acreditan un despliegue.
- Las páginas informativas, de privacidad y condiciones aprobadas por el titular se publicaron mediante el PR #94. La entrada es `/conexion-drive/index.html` (el servidor no sirve índices de directorio). Se comprobó su acceso público y el estado saludable del portal. Google confirmó OAuth **En producción** y se renovó la autorización limitada fuera de Testing; una carga sintética adicional confirmó carpeta privada, reintento con el mismo ID y descarga idéntica.
- Pendiente para activar: configurar el alojamiento y comprobar el uso de Drive en producción. La limpieza de fotografías de prueba sigue pendiente del respaldo de producción y su recuperación comprobada; no se han eliminado imágenes existentes. El estado OAuth de Google no significa que el proveedor esté activo en el portal.

Documentación oficial: [permisos de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [OAuth para servidor](https://developers.google.com/identity/protocols/oauth2/web-server), [Google Picker](https://developers.google.com/workspace/drive/picker/guides/overview).
