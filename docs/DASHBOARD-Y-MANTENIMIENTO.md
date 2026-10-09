# Resumen del equipo y planificación de mantenimiento

Acuerdo de alcance del 9 de octubre de 2026. Se incorpora la propuesta visual por etapas, conservando el expediente y los datos existentes.

## Etapa 1: resumen administrativo implementado

La ficha abre en **Resumen** para administración. Las pestañas Reparaciones y servicios, Uso y horómetro y Fotografías y placa siguen disponibles. Los demás roles conservan su vista anterior.

- Indicadores del período seleccionado: servicios, uso entre lecturas y cantidad de lecturas.
- Gráfica interactiva: puntos seleccionables con teclado, listado alternativo y acceso al reporte de origen. Las lecturas estimadas mantienen su identificación, valor original y explicación. Una disminución del contador interrumpe la línea.
- Servicios por tipo, últimos preventivos y mayores reportados como completados dentro del período y cinco servicios recientes con acceso al reporte completo.
- Los estados históricos pendientes se describen como reportes por revisar; no se convierten en averías abiertas ni cambian el estado operativo actual.
- Sin predicciones, alertas automáticas de vencimiento ni escrituras de datos. Se reutilizan los datos ya disponibles en la ficha, sin agregar consultas o intervalos de sincronización.

## Etapa 2: seguimiento de hallazgos implementado

Administración cuenta con la pestaña **Hallazgos y notas**, y un acceso destacado desde Resumen. Incluye todos los reportes con recomendaciones del equipo, sin depender del filtro de fechas del historial.

- Las recomendaciones se leen del reporte original; no se crean hallazgos automáticamente ni se decide que siguen abiertos. Se puede revisar el reporte y crear uno o varios seguimientos, cada uno con descripción propia.
- Cada seguimiento guarda componente, prioridad, responsable, estado, fecha programada y reporte de origen. Estados: Por confirmar, Abierto, Cotizado, Aprobado, Programado, Resuelto y Descartado.
- Activar un seguimiento exige prioridad definida. Programado exige responsable y fecha. Resuelto exige explicación y una orden del mismo equipo reportada como completada, de fecha no anterior al origen. Descartado exige motivo. Las transiciones se registran con nota del cambio; se permite corregir/reabrir con trazabilidad.
- El equipo y el reporte de origen quedan fijos después de crear el seguimiento. Se bloquean duplicados con el mismo equipo, origen y descripción. Los cambios de autoría y cierre los genera el servidor.
- La bitácora permite consultar quién cambió el seguimiento y cuándo. No se elimina el hallazgo: se resuelve o descarta. Esto no modifica automáticamente el estado operativo, el aviso de mantenimiento, los servicios ni los horómetros.
- La interfaz y los datos de esta etapa son exclusivos de administración. La selección y publicación de hallazgos para el cliente se diseñará junto con su vista en la etapa 4.

### Persistencia y respaldos

La colección Hallazgo usa el almacenamiento existente de registros MySQL, sin tablas nuevas ni reclasificación de datos antiguos. Los JSON locales anteriores se abren con la colección vacía. Los respaldos nuevos incluyen la hoja Hallazgo y una marca en metadatos para detectar si falta. Los respaldos antiguos, previos a esta colección, se leen con Hallazgo vacío; restaurarlos reemplaza los datos operativos como cualquier restauración y conserva la bitácora. Se descarga primero una copia completa del estado actual.

No volver a una versión anterior para operar nuevos seguimientos sin conservar un respaldo actualizado: el código antiguo no conoce esta colección.

### Validación

Pruebas de dominio: estados, fechas, relaciones entre equipo y orden, prioridad, responsable, duplicados, autoría, conservación de datos, permisos y respaldos anteriores/nuevos. Pruebas HTTP: persistencia, conflictos 409, rechazo de datos cruzados y ocultación ante roles no administrativos. Integración MySQL: altas, dos cambios simultáneos, rollback ante cierre inválido, evidencia de descarte y restauración.

## Etapa 3: planificación solicitada (aún no activa)

El usuario solicitó dejar este planteamiento anotado para revisarlo después de actualizar la información de los equipos.

| Configuración | Opciones previstas |
| --- | --- |
| Criterio del mantenimiento periódico | Selector **Por horas** / **Por días** |
| Plan por horas | **250 h** |
| Plan por días | **30, 60 o 90 días** |
| Mantenimiento mayor | Ciclo separado de **2,000 h**, como recomendación operativa solicitada |

Estas opciones deben confirmarse contra el manual y las condiciones de cada equipo al configurar su plan. La recomendación de 2,000 h no se aplica retroactivamente a servicios antiguos ni se presenta como exigencia universal del fabricante.

### Datos necesarios antes de calcular vencimientos

- Equipo, tipo de mantenimiento (periódico/mayor), criterio, intervalo y fecha de vigencia del plan. Guardar versiones para conservar las reglas anteriores.
- Fecha y horómetro del último mantenimiento correspondiente, ligados a una orden completada y revisada. Separar lectura registrada, estimada y validada; conservar evidencia de la corrección.
- Si no existe ese historial, una base inicial expresamente confirmada, con fecha, lectura, responsable y motivo. No usar silenciosamente cero ni un múltiplo del horómetro total.
- Historial de cambios o reinicios del contador. Las lecturas deben ser comparables antes de calcular horas restantes.
- Anticipación de avisos, responsable y siguiente visita acordada, como datos distintos de una fecha calculada.

### Cálculo propuesto, pendiente de implementación y validación

- Por horas: lectura base del último periódico confirmado + 250 h. Restar la última lectura comparable para expresar horas restantes o exceso desde esa lectura.
- Por días: fecha del último periódico confirmado + 30/60/90 días calendario, según el plan y la fecha local de Guatemala.
- Mayor: lectura base del último **mayor** confirmado + 2,000 h. Un preventivo de 250 h no reinicia automáticamente este ciclo. Si falta la base, mostrar **Pendiente de confirmar**, sin inventar vencimiento.
- Proyección en fecha para planes por horas: estimar el ritmo reciente con lecturas comparables y mostrar cobertura, fecha de la última lectura y supuestos. La proyección es orientativa; no modifica el horómetro. Sin datos suficientes, con lecturas antiguas, ritmo nulo o reinicio, no proyectar una fecha confiable.
- Si una base es estimada, cualquier cálculo derivado debe seguir marcado como estimación y quedar pendiente de confirmar antes de programar como definitivo.
- Confirmar después si un mayor sustituye el preventivo de esa visita y reinicia también su ciclo, y qué tolerancias/anticipación corresponden. No asumir esta política.
- No se incorpora todavía el modo combinado «horas o días, lo que ocurra primero»; requeriría acordar esa regla además del selector solicitado.

## Etapa 4: agenda y vista del cliente

Reutilizar el mismo cálculo de planificación para agenda, ficha y portal del cliente. Distinguir fecha prevista y cita confirmada. Mostrar pendientes, próximos vencimientos y equipos con información insuficiente. Separar visita programada/no programada del tipo preventivo/correctivo: no inferirlo de la descripción histórica.

## Criterios de aceptación posteriores

Antes de activar la planificación: probar los límites de 250 y 2,000 h; fechas de 30/60/90 días; cambios de plan; bases desconocidas o estimadas; lecturas antiguas, simultáneas o decrecientes; equipo sin uso y sin lecturas; permisos por cliente; y conservación del historial. Evitar fechas fijas, valores de ejemplo o contadores de hallazgos simulados del prototipo.
