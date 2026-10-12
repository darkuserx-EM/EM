# Revisión de la auditoría SQL sobre 09ee6e8

Se contrastó el documento recibido con código, pruebas y respaldos privados.
La auditoría describe la etapa 2 de #20; #75 y #76 completan después la paginación
operativa y la validación optimista. No se trasladan sus estimaciones a promesas
de capacidad del alojamiento.

## Decisiones

| Propuesta | Evaluación y acción |
| --- | --- |
| R1: limpiar imágenes temporales | Ya existe `cleanupMediaUploads`, llamada al arrancar y cada 15 minutos desde `startMaintenance`. Usa el índice de vencimiento y lotes de 500, hasta 20 pasadas. Se agregó una prueba de integración del programador real: elimina vencidas al arrancar y en otro ciclo, conserva las vigentes y compara los binarios originales. No se añade un segundo purgador. |
| R2: eliminar `em_audit_index` | No se consulta en los flujos actuales, pero eliminarla no aporta una mejora medida a las consultas. Se conserva para compatibilidad y recuperación de versiones anteriores; antes de retirarla hay que descartar consumidores externos y acordar el horizonte de reversión. La migración 10 propuesta ya corresponde al índice operativo. No se ejecuta DROP preventivo. |
| R3: tabla nueva de lecturas | #75 ya filtra por equipo/fecha y pagina en SQL mediante `em_operation_index`, manteniendo el payload original. El esquema ilustrativo omite autoría de actualización, lecturas H2/H3, procedencia, estimaciones y enlaces; además referencia `em_equipos`, que no existe. No se aplica una migración que pierda esos campos ni redondee números a DECIMAL(10,2). Una extracción futura debe preservar todo el contrato y demostrar una reducción del trabajo de validación, no solo cambiar el nombre de la tabla. |
| R4: versión SQL por registro | #76 retira el bloqueo durante cálculo/validación y revalida sobre una revisión nueva cuando otra operación gana. Conserva un control condicional de revisión al confirmar, porque la unicidad, los permisos y los horómetros dependen de varias filas. Añadir solo una columna version no protege esas dependencias. La confirmación aún se serializa brevemente; no se afirma paralelismo independiente entre todas las escrituras. |

## Precisiones del informe recibido

- El respaldo contiene 518 registros **incluyendo** 92 movimientos: son 426
  registros de dominio más la auditoría, 7 imágenes y 4 adjuntos. Los originales
  se compararon antes/después de cada etapa y se mantienen iguales.
- Validación incremental y caché evitan lecturas completas repetidas, pero
  construir/comparar diferencias y preparar ciertas respuestas todavía recorre
  datos. No es O(1) amortizado de extremo a extremo.
- Los rangos de 12–35 ms y 150–400 ms no incluyen una medición reproducible del
  alojamiento en el documento. No se publican como resultados comprobados.
- 480×360 corresponde a miniaturas; no describe todos los originales guardados.
- La paginación de listas operativas usa offset y revisión consistente; no debe
  confundirse con los cursores keyset usados en la bitácora.
- Los datos y pruebas actuales no permiten garantizar capacidad para un número
  futuro de técnicos. No se aumenta el pool ni el límite de memoria por estimación.

## Corrección adicional de fiabilidad de CI

La ejecución original del PR #73 falló en la prueba de reutilización TOTP:
esperaba 401 y recibió 200. La prueba volvía a generar el código en cada petición;
al cruzar un intervalo de 30 segundos estaba enviando un código nuevo válido.
Ahora conserva el código que realmente aceptó el servidor y reenvía ese mismo
valor. No se modifica la autenticación ni se desactiva la comprobación.

Este cambio va separado de #73. La ejecución fallida original no cumple la
excepción de tiempo de espera de Excel y no autoriza su fusión. Se mantiene el
requisito de CI verde para cualquier integración posterior.
