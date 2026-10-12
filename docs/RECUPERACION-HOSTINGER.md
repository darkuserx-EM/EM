# Fotografías: capacidad, conservación y recuperación

## Verificación del 12/10/2026

El almacenamiento sigue en MySQL, con originales privados en `em_media` y evidencias en `em_attachments`. Las fotografías ya no forman parte del registro operativo de cada equipo. No se cambia de proveedor ni se eliminan archivos para cerrar el issue #19.

Las lecturas privadas del panel y de la base confirmaron:

| Dato | Resultado |
| --- | --- |
| Motor | MariaDB 11.8.9 |
| Caracteres y cotejamiento de la base | `utf8mb4` / `utf8mb4_unicode_ci` |
| `max_allowed_packet` | 1,073,741,824 bytes; no modifica el límite de carga del portal |
| Uso mostrado en hPanel | 24 MB; la suma de datos e índices en phpMyAdmin es una medida distinta |
| Fotografías originales | 7 archivos, 2,346,850 bytes |
| Evidencias adjuntas | 4 archivos, 1,405,135 bytes |
| Historial operativo | 92 entradas |
| Última copia del proveedor ensayada | 11/10/2026 21:32, Guatemala; finalizada el 12/10 a las 03:32:58 UTC |

Para el plan Business existente, el **límite publicado aplicable es 3 GB por base**. Esta cifra procede de la documentación del proveedor para ese plan; hPanel mostró el uso, no un límite personalizado. No se confunde con los 200 GB de disco compartido. Antes de una importación masiva, volver a consultar el plan y el tamaño de la base: el espacio ocupado incluye originales retirados, índices y datos de recuperación. Hostinger puede suspender las escrituras cuando se supera el límite. No se aumenta el tamaño de petición ni se purgan evidencias para compensarlo.

Fuentes oficiales consultadas el 12/10/2026: [límites de los planes](https://www.hostinger.com/support/6976044-parameters-and-limits-of-hosting-plans-in-hostinger/), [versiones anteriores de Business](https://www.hostinger.com/support/10717644-new-web-and-cloud-hosting-limits-at-hostinger/) y [efecto de superar la cuota](https://www.hostinger.com/support/5534251-what-to-do-if-the-database-size-limit-has-been-reached-in-hostinger/).

## Política de conservación

Según la instrucción de conservar archivos e historial, las fotografías retiradas o sustituidas se conservan **sin vencimiento automático**. Se incluyen en el respaldo completo; la aplicación sirve únicamente la referencia activa después de autorizar al usuario. Se conservan también los originales de la migración y las evidencias de órdenes. Solo caducan recibos temporales, sesiones y controles temporales de seguridad, según sus reglas existentes.

Una futura purga requiere una decisión expresa de retención, una copia recuperable y verificación de referencias; no forma parte de esta entrega. La política de los originales no debe confundirse con la retención de instantáneas de Hostinger. La [documentación de copias del proveedor](https://www.hostinger.com/support/5981435-how-to-download-backups-at-hostinger/) publica siete días para diarias y seis semanas para semanales. El selector del panel mostró fechas adicionales, pero no se toman como garantía contractual de retención.

Conservar además el respaldo completo del portal fuera del alojamiento. En este ensayo se conservaron copias privadas locales del SQL descargado y del archivo completo verificado, fuera de Git. No se ha configurado una copia externa programada ni contratado otro almacenamiento. Una clave TOTP futura debe guardarse por separado del SQL en un gestor seguro, como indica CUENTAS-Y-RECUPERACION.md.

## Procedimiento de recuperación ensayado

1. En hPanel, abrir **Archivos → Copias de seguridad → Base de datos**, seleccionar la base que usa el portal y la fecha. Usar **Descargar**, sin restaurar sobre la base activa. Conservar el archivo original y calcular SHA-256 antes de probarlo.
2. Preparar una base **vacía y aislada**, sin conexión desde el portal real, con el mismo juego de caracteres y cotejamiento. En este ensayo: MariaDB 11.8.6, solo `127.0.0.1`, `utf8mb4_unicode_ci`, usuario temporal con permisos únicamente sobre la base de ensayo. Revisar que el volcado no cambie de base ni contenga objetos o instrucciones ajenos a la recuperación.
3. Descomprimir sin convertir el SQL a texto y enviarlo como bytes al cliente nativo de MariaDB, con `--binary-mode=1` y `--default-character-set=utf8mb4`. **No usar `Get-Content`, una conversión UTF-8 ni otro intermediario de texto para importar un volcado con BLOB**: el volcado del proveedor contiene bytes binarios escapados y esa conversión puede alterarlos. No poner contraseñas en argumentos, comandos guardados o registros compartidos.
4. Comprobar la importación y conservar una referencia de sus filas antes de migrar. Ejecutar las migraciones de la versión actual y la separación de imágenes en esta base aislada. Comparar las entidades completas (rehidratando fotografías para comparar con el formato antiguo), cuentas, eventos y bytes de los adjuntos. Verificar las huellas de cada imagen y repetir la migración: debe ser una operación sin cambios.
5. Generar un respaldo completo desde la base recuperada; exigir el cierre con conteos y SHA-256 correcto. Comparar las referencias, metadatos y originales con un respaldo conocido. La igualdad no debe basarse solo en cantidades.
6. Cerrar las conexiones y retirar únicamente la base y el usuario temporales creados para el ensayo. Conservar las copias privadas y el informe de resultados. Restaurar una base productiva es una operación distinta: requiere detener escrituras, conservar el estado vigente y decidir el punto de recuperación; no se ejecutó aquí.

Dos intentos locales detectaron errores del procedimiento y se descartaron: un cotejamiento predeterminado distinto impedía crear una clave foránea, y convertir el volcado a texto alteraba los binarios. Usar el cotejamiento original y el cliente en modo binario resolvió ambos. No hubo escrituras ni restauraciones en la base productiva.

## Resultado

La copia descargada tenía siete tablas y revisión 88, anterior a la separación de imágenes. Se recuperaron y actualizaron **518 registros, cinco cuentas y cinco eventos de seguridad**; la migración separó siete imágenes de cuatro equipos. Se conservaron todos los campos previos de cuentas y eventos y los bytes de los cuatro adjuntos.

El respaldo completo recuperado contiene **518 registros (incluidas 92 entradas de historial), siete fotografías y cuatro adjuntos**. Las **529 entradas de datos y archivos** coinciden exactamente con el respaldo productivo de referencia obtenido después del PR #81. Las huellas son válidas, no quedan referencias faltantes y repetir la migración no produce cambios. La evidencia completa y las copias con información real permanecen privadas.

Este resultado prueba la descarga y recuperación aislada de una copia real de Hostinger, además de los ensayos anteriores del respaldo de la aplicación. No afirma que se haya reemplazado producción ni promete un tiempo de recuperación o pérdida máxima de datos no acordados.
