# Revisión de estabilidad · 09/10/2026

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

## Publicación y reversión

Conservar un respaldo privado antes de publicar, exigir las comprobaciones de la rama protegida y comparar todos los registros después. No se transforma ninguna fotografía existente ni se modifica el esquema. Ante una regresión, revertir el código mediante PR y publicar la revisión anterior; no restaurar datos antiguos para revertir este cambio.
