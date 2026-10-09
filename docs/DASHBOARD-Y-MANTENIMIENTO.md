# Resumen del equipo y planificación de mantenimiento

Acuerdo de alcance del 9 de octubre de 2026. Se incorpora la propuesta visual por etapas, conservando el expediente y los datos existentes.

## Etapa 1: resumen administrativo implementado

La ficha abre en **Resumen** para administración. Las pestañas Reparaciones y servicios, Uso y horómetro y Fotografías y placa siguen disponibles. Los demás roles conservan su vista anterior.

- Indicadores del período seleccionado: servicios, uso entre lecturas y cantidad de lecturas.
- Gráfica interactiva: puntos seleccionables con teclado, listado alternativo y acceso al reporte de origen. Las lecturas estimadas mantienen su identificación, valor original y explicación. Una disminución del contador interrumpe la línea.
- Servicios por tipo, últimos preventivos y mayores reportados como completados dentro del período y cinco servicios recientes con acceso al reporte completo.
- Los estados históricos pendientes se describen como reportes por revisar; no se convierten en averías abiertas ni cambian el estado operativo actual.
- Sin predicciones, alertas automáticas de vencimiento ni escrituras de datos. Se reutilizan los datos ya disponibles en la ficha, sin agregar consultas o intervalos de sincronización.

## Etapa 2: seguimiento de hallazgos

Propuesta pendiente de implementación: registrar componente, descripción, prioridad confirmada, estado, responsable, reporte de origen, reporte de resolución y visibilidad para el cliente. Revisar las recomendaciones importadas antes de convertirlas en hallazgos abiertos. Una visita puede tener varias recomendaciones o repetir una anterior: contar reportes no equivale a contar fallas.

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
