# Issue 20: historial e integridad por etapas

## Etapa 1: bitácora independiente

`em_audit_log` contiene el payload original, con índices por fecha/id, entidad,
equipo y hallazgo. La migración 9 mueve hasta 200 movimientos por transacción,
bajo el mismo bloqueo de las escrituras. Compara cada payload byte a byte antes
de retirar su ubicación anterior. Una identidad con contenido diferente aborta
el lote; los lotes anteriores se conservan y el arranque siguiente puede reanudar.
El servidor no escucha hasta terminar la migración. `em_audit_index` se conserva
como índice legado, pero ninguna consulta nueva depende de él.

Los guardados y la sincronización normales excluyen la bitácora. El contador
`em_audit_state` mantiene la secuencia LOG sin cargar los movimientos. Una
escritura y sus nuevos eventos se confirman en la misma transacción. El historial
es acumulativo: guardar o restaurar registros no puede borrar ni modificar un
movimiento que ya existe.

La consulta administrativa mantiene páginas de 1–200 filas con cursor por
fecha/id, filtros y autorización del servidor. El formato de los respaldos no
cambia: Bitacora sigue siendo una colección de registros, aunque se almacene en
otra tabla. El respaldo completo la recorre en lotes de 200. Restaurar sobre una
base viva conserva su auditoría; una base vacía recupera la del respaldo y añade
el movimiento de restauración con su fecha de exportación.

### Publicación y recuperación

Antes de publicar: respaldo completo privado con checksum válido, pruebas de
MySQL/MariaDB, CI y compilación correctos. El despliegue debe sustituir el proceso
anterior: no ejecutar en paralelo servidores anteriores a esta migración sobre
la misma base. Las versiones antiguas no conocen la nueva ubicación del historial.

Después: comprobar salud, versión publicada y comparar todos los registros,
movimientos y binarios del respaldo previo con uno nuevo. Recorrer también las
páginas del historial y compararlas con el respaldo, sin duplicados.

Para volver a un servidor anterior es necesario detener las escrituras,
respaldar ambas tablas y copiar `em_audit_log.id,payload` a `em_records` con
`entity='Bitacora'`. Comparar todos los payloads antes de arrancar la versión
anterior; cualquier identidad distinta debe detener la reversión. No borrar la
tabla nueva ni restaurar una base vieja como forma de revertir código.

### Pruebas

`server/audit-storage.integration.test.mjs` usa una base efímera de loopback con
25,000 movimientos sintéticos: interrupción/reanudación, comparación de hashes,
rechazo de identidades distintas, índice de equipo sin filesort, guardado sin
leer la bitácora, respaldo completo y conservación de auditoría al restaurar.
Las pruebas de medios ejercitan recuperación en una base realmente vacía,
incluida la tabla nueva. Las pruebas existentes cubren filtros, roles, códigos,
concurrencia de operaciones y autoría.

## Etapa 2: validación incremental y base por revisión

Las altas, ediciones y bajas normales reutilizan una base validada únicamente
si coincide con la revisión leída bajo el bloqueo SQL. Un arranque en frío o una
escritura de otro proceso exige leer y validar de nuevo la base completa. Las
importaciones y restauraciones siempre mantienen la validación completa. No se
acepta una marca de validación del navegador.

`IncrementalValidation` compara identidades y contenido, comprueba unicidad en
todo el conjunto y vuelve a validar las filas cambiadas, sus dependientes y el
contexto relacionado. Reutiliza el mismo validador de campos, autoría y enlaces;
no hay una segunda implementación simplificada de las reglas de negocio. Al
añadir una relación al dominio se debe ampliar su grafo de dependencias y las
pruebas de equivalencia. Los valores que JSON omitiría y los números no finitos
no pueden confundirse con contenido ya validado.

La publicación en caché espera la confirmación del commit. Si MySQL entrega el
bloqueo al siguiente escritor antes de responder al proceso anterior, éste
espera la publicación pendiente sin tomar otra conexión del pool. Un commit
fallido no publica datos. La caché conserva su límite de 32 MiB; si no cabe,
se vuelve al recorrido completo, sin omitir validaciones.

Las pruebas comparan ambos validadores ante cambios de campos y relaciones,
bajas y duplicados; con 5,000 catálogos, una edición aislada valida una sola fila.
La prueba de integración ejecuta cinco altas simultáneas con cinco conexiones:
no repite la lectura completa de registros con la base caliente, mantiene códigos
distintos y detecta cambios de otro proceso. Una base externa inválida bloquea
la escritura. Se conservan las pruebas de permisos, autoría, conflictos sobre la
misma fila y monotonicidad del horómetro.

### Límites conservados

El bloqueo SQL global sigue protegiendo unicidad y relaciones. Comparar/indexar
el conjunto, generar la respuesta y calcular las diferencias sigue siendo O(N);
esto no convierte el sistema en una base relacional ni elimina la serialización
de escrituras. El índice de validación ocupa memoria adicional a la instantánea
y se libera cuando deja de usarse esa base. No se aumenta el pool del alojamiento.
Toda escritura externa debe incrementar `em_meta.revision` en su transacción;
editar directamente payloads sin revisar esta versión no es un flujo soportado.

La paginación de entidades operativas y la sustitución del bloqueo global siguen
requiriendo otra etapa con índices/controles transaccionales equivalentes. #20
permanece abierto mientras esos pendientes declarados no estén resueltos.

## Auditoría comparativa recibida

El documento compara con `814833a`, anterior a las correcciones publicadas:
fotografías separadas en #59, concurrencia por registro operativo en #61,
historial paginado en #63 e índices/lotes por bytes en #67–68. No se duplican
índices de adjuntos ni se crean índices target/action usados solo por pruebas.
No se aumenta el pool de cinco conexiones sin medir la carga y el límite real
del alojamiento. Cambiar el nombre de `/api/mutate` o añadir un ejecutor `tsx`
no reduce por sí mismo el trabajo de SQL ni sustituye pruebas de integridad.
