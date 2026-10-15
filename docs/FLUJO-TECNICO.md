# Solicitudes y órdenes del técnico

## Crear y atender una orden

1. En **Inicio → Solicitudes asignadas por atender**, abre la solicitud. También puedes entrar desde **Solicitudes → Crear orden de atención** o desde el planificador. Abrir el formulario no crea registros.
2. Confirma equipo, responsable, apoyos y motivo; pulsa **Iniciar atención**. Se registra una única orden en proceso, con fecha y autor, y el formulario continúa abierto en Diagnóstico. Una orden existente se abre con **Atender orden / Continuar atención**; un borrador o visita programada empieza solo al pulsar **Iniciar atención**.
3. En **Diagnóstico** agrega fotos de Antes; en **Trabajo**, fotos de Después. Elige el archivo y pulsa **Guardar adjunto**. La confirmación aparece después de guardar archivo y referencia; no necesitas guardar el texto ni salir. Las fotos y videos de la solicitud se consultan aquí por referencia, sin duplicarlos.
4. Usa **Guardar avance** para conservar el texto parcial y seguir en la misma sección. No exige diagnóstico o pruebas finales mientras la orden siga abierta. Si falla, conserva los cambios en esta ventana para reintentar. No hay autoguardado ni recuperación sin conexión: guarda antes de salir o recargar.
5. Para completar, documenta diagnóstico, trabajo y pruebas, indica el final y elige **Completada → Completar orden**. Una carga pendiente o fallida debe reintentarse o quitarse explícitamente de la selección. Quitar selección no elimina archivos ya guardados. Se conserva el cierre automático de la solicitud cuando todas sus órdenes están completadas.

Para una orden sin solicitud previa, usa **Órdenes de servicio → Nueva orden**. El técnico puede elegir cualquier equipo activo, sin habilitación individual, y agregar hasta dos apoyos. Un coordinador vinculado a una ficha de técnico —como Raúl— puede ser responsable o apoyo sin perder su perfil. Los participantes trabajan en la misma orden; otros técnicos no pueden abrirla ni descargar sus evidencias.

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

## Atención continua · primera etapa

Los avances usan la versión leída por el formulario, no la recibida silenciosamente en una actualización de fondo. Si otro participante cambia la orden, el guardado se rechaza conservando el texto local para comparar; no se sobrescribe el historial. La fecha de inicio conservada no se redondea al guardar otros campos. Las órdenes completadas solo admiten corrección o reapertura con motivo por administración/coordinación, sin alterar este control. No se hacen obligatorios el horómetro, las fotografías ni el nombre de quien recibe.
