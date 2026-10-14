# Solicitudes y órdenes del técnico

## Crear y atender una orden

1. En **Solicitudes**, abre una solicitud abierta asignada a tu técnico y pulsa **Crear orden de atención**. También aparece en **Planificador → Solicitudes por atender**.
2. Confirma los datos y guarda la orden como programada o borrador. El cliente, equipo y solicitud quedan vinculados; el responsable es el técnico de la sesión.
3. El detalle de la orden muestra las fotos y videos originales de la solicitud por referencia. No copia ni mueve esas evidencias.
4. Usa **Editar reporte** para iniciar el trabajo, documentar diagnóstico, trabajo y pruebas, y completar la orden. Se conserva el cierre automático de la solicitud cuando todas sus órdenes están completadas.

Para una orden sin solicitud previa, usa **Órdenes de servicio → Nueva orden**. Solo admite equipos con trabajo abierto asignado al técnico o habilitados expresamente por administración en **Roles y accesos → Equipos habilitados para técnicos → Configurar equipos**. No habilita toda la flota ni permite leer órdenes de otros técnicos. Retirar una habilitación conserva el historial y los trabajos ya asignados.

La creación queda privada para el cliente. Administración/coordinación conserva la acción **Compartir con cliente**, la reasignación y la reprogramación de visitas ya programadas. El técnico puede programar su propio borrador, pero no cambiar su responsable. Los controles se repiten en el servidor.

## Reabrir una solicitud resuelta sin orden

Administración, coordinación y el técnico asignado pueden abrir el detalle y pulsar **Reabrir solicitud**, indicando un motivo de 8 a 500 caracteres. Vuelve a **En revisión** y permite generar la orden. Administración/coordinación puede después editar sus datos; el técnico conserva el alcance de ejecución y creación de su orden.

No se habilita esta reapertura si hay una orden vinculada en cualquiera de los dos sentidos, aunque sea privada, histórica o cancelada. Tampoco aplica a solicitudes canceladas o importadas. Es una acción separada: no permite alterar simultáneamente cliente, equipo, descripción o asignación.

El código, fecha de creación, autor, evidencias y entradas anteriores de bitácora permanecen intactos. Se agrega una entrada **Reapertura sin orden** con actor, solicitud, equipo, estado anterior/nuevo y motivo completo, en la misma transacción del cambio. Una versión obsoleta o un cambio concurrente se rechaza sin sobrescribir.

## Planificador y permisos

La columna **Solicitudes por atender** incluye solicitudes operativas abiertas sin orden, con o sin fecha. Para el técnico solo muestra las asignadas a él. Al crear la orden desaparece esa tarjeta y aparece la orden en su etapa. Se deduplica antes de aplicar filtros, como en el calendario, sin revelar órdenes ajenas. Las resueltas se consultan desde Solicitudes; las citas conservan la fecha programada, nunca se deduce de la fecha de creación.

El cliente conserva Solicitudes, Agenda y reportes compartidos, sin acceso al planificador interno ni acciones de creación de órdenes/reapertura. No hay cambios en el almacenamiento ni en los permisos de archivos de Drive.

## Integridad y verificación

No requiere migración destructiva ni actualización en bloque. Los nuevos campos son opcionales en el registro JSON: `Tecnico.equipos_habilitados` (IDs válidos, máximo 500), `Ticket.reapertura_motivo` y `OrdenServicio.desde_solicitud` (marca del flujo de creación). Los respaldos conservan estos campos.

La creación desde una solicitud comprueba que no haya orden; el técnico siempre tiene esta comprobación. Las altas conservan su identificador de reintento. Dos creaciones simultáneas se reevalúan sobre el estado confirmado y solo una gana; una orden reasignada no se devuelve al técnico anterior mediante un reintento. Los vínculos históricos y el flujo administrativo de múltiples órdenes existentes se conservan.

Pruebas: dominio y validación incremental de habilitaciones; cuatro perfiles en calendario/planificador; integración con SQL real de creación concurrente, cierre, reapertura, cambios de versión y permisos cruzados; video con el mismo ID y bytes desde solicitud/orden, respaldo completo y una sola copia del contenido. Recorridos en navegador autenticado, incluido técnico a 390 px, antes de publicar.

Reversión: volver al código previo sin borrar registros, campos, archivos ni bitácora. Las órdenes nuevas siguen siendo órdenes operativas válidas. Costos, inventario y contratos permanecen fuera del alcance.
