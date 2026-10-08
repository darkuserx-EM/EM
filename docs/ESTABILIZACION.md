# Estabilización de la base · 08/10/2026

Primer bloque de los issues #1, #2, #3 y preparación de #4. También distingue errores esperados e inesperados (#7) e incorpora comprobaciones automáticas de GitHub (parte de #11).

## Validación e historial

La validación completa usa conjuntos de claves para códigos, series, referencias y nombres de catálogo. Conserva las reglas de normalización, los mensajes, las relaciones y la comprobación de autoría. El servidor ya no aplica el límite local de 20,000 filas por entidad. El almacenamiento del navegador conserva ese límite explícito. No se eliminan ni archivan movimientos.

El servidor sigue usando registros JSON en MySQL y cargando instantáneas completas. Quitar el límite no significa capacidad ilimitada: siguen pendientes tablas e índices por módulo, paginación de bitácora, separación de imágenes, importaciones por lotes y pruebas de carga.

## Sincronización

`GET /api/database` devuelve `syncToken` y el perfil de acceso actual. La siguiente consulta envía `?since=<syncToken>`. Solo devuelve 204 cuando coinciden revisión y usuario/permisos/asignación; la sesión se comprueba antes incluso de una respuesta vacía. Un cambio de rol o cliente fuerza nueva respuesta y actualiza el perfil de la interfaz, aunque no cambien los registros.

Cada consulta comprueba la revisión en MySQL. Una instantánea validada se comparte entre solicitudes concurrentes del mismo proceso, con filtrado independiente por usuario. Solo se conserva en caché si su JSON ocupa como máximo 32 MiB. Se actualiza tras confirmar una transacción; una lectura antigua pendiente no reemplaza esa copia. Un fallo de MySQL no se disfraza devolviendo una copia antigua. Toda escritura externa debe incrementar `em_meta.revision` dentro de la misma transacción que modifica los registros.

Las pestañas ocultas siguen pausadas. Las respuestas pendientes tras cerrar sesión se descartan; una respuesta antigua no reemplaza permisos más recientes. La compatibilidad con navegadores que aún no envían `since` se conserva.

## Diagnóstico seguro

Los fallos inesperados responden 500 con referencia. El chequeo de salud conserva 503 cuando MySQL no responde. Los registros JSON incluyen referencia, fecha, evento, método, patrón de ruta, tipo/código del error y ubicaciones de código sin rutas de usuario. No incluyen el mensaje original, consultas SQL, parámetros URL, cuerpos, cookies, contraseñas, correos ni contenido de filas. No se añade un manejador que oculte fallos fatales y mantenga un proceso posiblemente inconsistente.

Las validaciones esperadas se distinguen mediante `ValidationError`; los fallos de programación del dominio llegan al registro del servidor.

## Proxy: comprobación pendiente en Hostinger

`TRUST_PROXY` conserva por defecto `1`. Acepta de 0 a 5 saltos o una lista explícita de IP/subredes, incluyendo los alias de Express. Rechaza `true`, valores vacíos y rutas universales `/0`.

`ENABLE_NETWORK_DIAGNOSTICS=true` habilita temporalmente `GET /api/diagnostico/red`, solo con sesión de Administrador, respuesta sin caché y sin registro de direcciones IP. Por defecto la ruta está deshabilitada.

Procedimiento: activar temporalmente, comprobar desde dos redes independientes, contrastar la dirección del socket y la cadena reenviada con la configuración confirmada del proveedor, verificar que cabeceras añadidas por el cliente no sustituyen la dirección efectiva, documentar el resultado y desactivar el diagnóstico.

Una dirección privada NO demuestra que toda la subred sea confiable. La ausencia de `X-Forwarded-For` NO demuestra que no exista proxy. No modificar los saltos ni confiar en subredes completas únicamente por esos indicios. #4 permanece pendiente hasta completar la comprobación del alojamiento.

## Publicación y recuperación

La revisión incorpora GitHub Actions con Node 24 y pnpm fijado, instalación con lockfile, pruebas y compilación en cada PR y push a main. La protección de main y las pruebas contra MySQL real siguen pendientes; el workflow no publica por sí mismo.

No hay migración de tablas ni transformación de registros. Antes de publicar, conservar un respaldo privado completo; comparar la información antes/después. Si la aplicación falla, volver a la versión anterior del código. No restaurar una copia antigua de los datos para revertir este cambio de código.

El issue #6 (preservar auditoría durante una restauración), el cambio de contraseñas/sesiones y la recuperación integral de MySQL siguen siendo trabajo prioritario del bloque siguiente.

## Medición local

Con Node 24.19.0, datos sintéticos y el validador compilado: 1,000 movimientos en 27 ms, 25,000 en 166 ms y 100,000 en 360 ms (una ejecución local del 08/10/2026). Estos valores miden solo validación, con calentamiento progresivo del proceso; no son una prueba de carga de Hostinger ni un compromiso de tiempo de respuesta. Las pruebas funcionales comprueban también guardar y restaurar más de 20,000 movimientos y conservar el límite del navegador.
