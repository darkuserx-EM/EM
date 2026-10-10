# Resumen del equipo y planificación de mantenimiento

Acuerdo de alcance del 9 de octubre de 2026. Se incorpora la propuesta visual por etapas, conservando el expediente y los datos existentes.

## Etapa 1: resumen administrativo implementado

La ficha abre en **Resumen** para administración. Las pestañas Reparaciones y servicios, Uso y horómetro y Fotografías y placa siguen disponibles. Los demás roles conservan su vista anterior.

- Indicadores del período seleccionado: servicios, uso entre lecturas y cantidad de lecturas.
- Gráfica interactiva: puntos seleccionables con teclado, listado alternativo y acceso al reporte de origen. Las lecturas estimadas mantienen su identificación, valor original y explicación. Una disminución del contador interrumpe la línea.
- Servicios por tipo, últimos preventivos y mayores reportados como completados dentro del período y cinco servicios recientes con acceso al reporte completo.
- Los estados históricos pendientes se describen como reportes por revisar; no se convierten en averías abiertas ni cambian el estado operativo actual.
- En esta primera etapa, sin predicciones, alertas automáticas de vencimiento ni escrituras de datos. Las estimaciones mensuales se incorporan en el apartado posterior de esta entrega. Se reutilizan los datos ya disponibles en la ficha, sin agregar consultas o intervalos de sincronización.

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

## Etapa 3: planificación administrativa implementada

Administración puede configurar el preventivo y el mayor desde la pestaña Mantenimiento del equipo o desde el módulo Mantenimiento. No se generan planes ni bases para los equipos existentes al publicar. Cada plan empieza pendiente hasta que administración revisa su base.

| Configuración | Opciones disponibles |
| --- | --- |
| Criterio del mantenimiento periódico | Selector **Por horas** / **Por días** |
| Plan por horas | **250 h** |
| Plan por días | **30, 60 o 90 días** |
| Mantenimiento mayor | Ciclo separado de **2,000 h**, como recomendación operativa solicitada |

Estas opciones deben confirmarse contra el manual y las condiciones de cada equipo al configurar su plan. La recomendación de 2,000 h no se aplica retroactivamente a servicios antiguos ni se presenta como exigencia universal del fabricante.

### Base y versiones

- Equipo, tipo de mantenimiento (periódico/mayor), criterio, intervalo y fecha de vigencia del plan. Guardar versiones para conservar las reglas anteriores.
- Fecha y horómetro del último mantenimiento correspondiente, ligados a una orden completada y revisada. Separar lectura registrada, estimada y validada; conservar evidencia de la corrección.
- Si no existe ese historial, una base inicial expresamente confirmada, con fecha, lectura, responsable y motivo. No usar silenciosamente cero ni un múltiplo del horómetro total.
- Historial de cambios o reinicios del contador. Las lecturas deben ser comparables antes de calcular horas restantes.
- Cada modificación crea una versión; la anterior queda conservada. El servidor asigna autoría, fecha y correlativo. La importación y la edición directa de versiones no están habilitadas. El respaldo conserva todas las versiones.
- Responsable opcional y motivo obligatorio. Las citas y tolerancias por equipo quedan pendientes de la etapa de agenda.

### Cálculo y límites

- Por horas: lectura base del último periódico confirmado + 250 h. Restar la última lectura comparable para expresar horas restantes o exceso desde esa lectura.
- Por días: fecha del último periódico confirmado + 30/60/90 días calendario, según el plan y la fecha local de Guatemala.
- Mayor: lectura base del último **mayor** confirmado + 2,000 h. Un preventivo de 250 h no reinicia automáticamente este ciclo. Si falta la base, mostrar **Pendiente de confirmar**, sin inventar vencimiento.
- Proyección orientativa por horas: mínimo tres lecturas de instantes distintos posteriores a la base, dentro de los últimos 90 días respecto de la lectura más reciente y abarcando al menos 14 días. El ritmo es el incremento dividido entre días transcurridos. No se proyecta si hay estimaciones, disminución del contador, lecturas futuras o simultáneas distintas, lectura de más de 30 días, ritmo nulo o proyección superior a 365 días. La fecha resultante no es una cita y no modifica lecturas.
- Los avisos próximos usan 25 h o 7 días de anticipación; son umbrales de esta primera versión, pendientes de configuración por equipo. Una lectura antigua exige actualización; si ya superaba el objetivo se conserva ese atraso conocido, mostrando la fecha de lectura.
- Si una base es estimada, cualquier cálculo derivado debe seguir marcado como estimación y quedar pendiente de confirmar antes de programar como definitivo.
- Confirmar después si un mayor sustituye el preventivo de esa visita y reinicia también su ciclo, y qué tolerancias/anticipación corresponden. No asumir esta política.
- No se incorpora todavía el modo combinado «horas o días, lo que ocurra primero»; requeriría acordar esa regla además del selector solicitado.
- Los servicios nuevos no avanzan la base automáticamente. Administración revisa el reporte completado y guarda una nueva versión del ciclo correspondiente. Los planes no cambian el estado operativo ni los avisos manuales del equipo.
- Datos y escritura de PlanPM se restringen a administración en interfaz y servidor. El formulario confirma el descarte de cambios sin guardar y utiliza textos de 14 px, metadatos de 12 px y contraste reforzado.

### Adaptación visual administrativa del 9 de octubre

La ficha administrativa usa la distribución de la propuesta: cabecera en tarjeta, indicadores de próximo preventivo, hallazgos abiertos, último horómetro y servicios; bloque de próximo servicio con preventivo y mayor en paralelo; barras de avance y explicación de base, intervalo y lectura utilizada. El gráfico interactivo, los tipos de servicio, las recomendaciones y el historial quedan en secciones legibles a todo el ancho. Los datos técnicos permanecen debajo; las demás pestañas conservan su navegación.

Los indicadores y planes consultan todo el historial; el filtro de fechas afecta solamente la actividad y los gráficos del período. Se mantienen separados para que un filtro no cambie un vencimiento. Las barras se muestran solamente cuando existe una base válida; las estimaciones conservan su aviso y los valores originales. No se incorporan cifras ilustrativas del HTML ni se interpreta un reporte histórico como hallazgo abierto.

El módulo Mantenimiento muestra tarjetas que filtran objetivos alcanzados, próximos vencimientos, bases/lecturas por revisar y ciclos sin configurar. Incluye búsqueda, filtro por cliente y acceso a los planes del equipo. Los contadores expresan ciclos (dos posibles por equipo), no equipos averiados. La configuración sigue restringida a administración.

No se trasladan del prototipo las visitas no planificadas, diagnósticos de fallas repetidas, el modo combinado horas/días ni las fechas de ejemplo: faltan datos estructurados o reglas confirmadas para presentarlos como hechos. La agenda de citas y la nueva vista del cliente siguen en la siguiente etapa; esta entrega termina el dashboard administrativo y su planificación.

## Etapa 4: agenda y vista del cliente

Reutilizar el mismo cálculo de planificación para agenda, ficha y portal del cliente. Distinguir fecha prevista y cita confirmada. Mostrar pendientes, próximos vencimientos y equipos con información insuficiente. Separar visita programada/no programada del tipo preventivo/correctivo: no inferirlo de la descripción histórica.

## Validación de la planificación

Pruebas de dominio y HTTP: límites de 250 y 2,000 h, fechas 30/60/90 días, cambios de plan, bases desconocidas o estimadas, lecturas antiguas/simultáneas/decrecientes, equipo sin uso, versiones, autoría, respaldo y permisos. La prueba MySQL comprueba dos cambios simultáneos (uno se confirma y el otro recibe conflicto), conservación del historial y rollback. La revisión visual usa una copia privada en memoria; no crea planes de prueba en producción.


## Uso mensual estimado (9 de octubre de 2026)

A solicitud del usuario se incorpora **Uso por mes** debajo de la evolución del horómetro, con barras seleccionables, selector alternativo accesible y agrupación por año. Se reutilizan las lecturas existentes; no se agregan consultas, campos, lecturas sintéticas ni cambios al estado del equipo o a los planes.

- Se reparte cada incremento de H1 proporcionalmente al tiempo entre las dos lecturas consecutivas, cortando en los límites de mes de Guatemala (UTC−6). Se suman sin redondear; solo se redondea la presentación. Es una distribución estimada, no una medición diaria.
- El filtro de fechas limita los tramos mostrados, usando también las lecturas inmediatamente exteriores para calcular los límites. El día Hasta es inclusivo y el cálculo nunca supera el instante actual. Se muestran hasta 24 meses, con aviso y acceso a los anteriores mediante el filtro.
- Mes sin cobertura significa **sin datos**, no cero horas. Se distinguen meses parciales, tramos que dependen de lecturas corregidas y separaciones de más de 60 días. Se mantienen los valores originales en el historial.
- Retrocesos, valores negativos/no finitos, lecturas simultáneas distintas e incrementos superiores a una hora por hora transcurrida interrumpen el cálculo; nunca se conectan a través del tramo dudoso. Los duplicados idénticos no duplican uso. Fechas inválidas y futuras se excluyen y se avisan.
- Proyección opcional desde la última lectura **hasta hoy**, nunca hasta un cierre futuro: mínimo tres instantes comparables en los últimos 90 días de la lectura más reciente, que abarquen 14 días, incremento positivo y última lectura de hasta 30 días. Se usa únicamente el tramo continuo posterior a cualquier anomalía o estimación, sin lecturas estimadas. Fechas futuras o inválidas impiden proyectar. Se explica la tasa diaria, fechas y cantidad de lecturas. Se puede ocultar sin alterar el historial.
- La línea de promedio del primer año visible exige tres meses completos. La comparación reciente usa los últimos tres meses completos consecutivos. Los promedios son orientativos y no incluyen meses parciales ni proyección; pueden incluir distribuciones derivadas de una lectura corregida, identificada en el detalle del mes.
- Verificación con casos sintéticos: límites de mes/año, febrero bisiesto, zona horaria, conservación de horas, filtros sin lecturas interiores, duplicados, reinicios, valores inválidos, estimaciones, proyección reciente/antigua/insuficiente, promedios y ausencia de modificaciones al origen. Revisión visual en escritorio y móvil sobre copia privada de los datos.


## Ficha compacta y revisión visual (9 de octubre de 2026)

La autoevaluación detectó gráficos SVG cuya altura y rotulación crecían con el ancho, tarjetas de indicadores demasiado altas y explicaciones siempre abiertas que repetían información. Se ajusta únicamente la presentación administrativa:

- Gráficos de 212 px de alto, con ancho adaptativo medido en su contenedor. Los puntos y textos conservan su tamaño en pantallas amplias. El horómetro reduce sus marcas de fecha en móvil; el gráfico mensual conserva desplazamiento horizontal y un selector alternativo.
- Lectura/mes seleccionado y condición estimada o proyectada siempre visibles. El listado y la explicación completa se despliegan con **Ver detalle de lecturas** y **Ver detalle y cálculo mensual**. Se mantienen los valores originales de las lecturas estimadas y el enlace al reporte.
- Indicadores del período en una fila compacta, filtros junto al título y menor separación entre secciones. Se compactan cabecera, servicios recientes y resumen de los planes.
- El resumen de cada ciclo conserva objetivo, estado, horas/días restantes y avance. La base y su fórmula se despliegan con **Ver base y cálculo**. La vista de configuración mantiene su presentación completa.
- Las advertencias de lecturas antiguas o no comparables siguen visibles. No se cambian cálculos, datos, permisos ni solicitudes al servidor. Los colores del horómetro mantienen la distinción entre lecturas registradas y estimadas; no se añaden nuevas clasificaciones de visitas en esta revisión visual.

Validación visual en escritorio, pantalla amplia y móvil, más comprobación de selección por teclado, acceso a reportes, filtros, detalles y ausencia de desbordamientos. Capturas y datos de prueba se conservan fuera del repositorio público.
