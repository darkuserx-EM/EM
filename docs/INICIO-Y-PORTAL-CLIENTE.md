# Inicio operativo y portal del cliente

Revisión: 10 de octubre de 2026. Esta entrega adapta la propuesta visual de Inicio y corrige el contraste del portal del cliente. No migra ni reescribe datos existentes.

## Inicio

- Búsqueda por código, ID del cliente, serie, marca/modelo y empresa. La selección limita equipos, indicadores, prioridades, agenda y actividad.
- Estado conocido y pendiente de confirmar por separado. El porcentaje representa cobertura de clasificación, no disponibilidad temporal ni autorización para operar.
- Órdenes abiertas y citas atrasadas abren el detalle de las órdenes actuales. Los reportes importados no se convierten en trabajo pendiente.
- Administración puede consultar los vencimientos/proyecciones de la semana; no son citas confirmadas. El enlace de agenda abre la semana de Guatemala.
- La tabla prioriza hallazgos críticos, condición, vencimientos preventivos o mayores y datos pendientes. Los planes no visibles por permisos no se contabilizan como faltantes.
- Captura rápida de H1 con fecha local, validación del servidor e identidad de reintento. El técnico necesita una orden abierta asignada; la captura no modifica lecturas anteriores.
- Actividad reciente basada en órdenes, lecturas y estados autorizados, sin descargar la bitácora completa. Los filtros históricos afectan únicamente al gráfico mensual.

## Cliente

- Se elimina la aplicación del antiguo tema oscuro a las rutas del cliente: producía texto blanco sobre las tarjetas blancas. Formularios, reportes, agenda e indicadores comparten ahora las superficies claras del portal.
- Flota en filas con ID/código, marca/modelo, serie, estado, horómetro y acciones visibles. Diez equipos por página, búsqueda y filtros; ficha con uso, servicios y fotografías.
- Ancho adaptable y jerarquía compacta. En móvil cada fila se organiza como tarjeta sin desbordar la página.
- El calendario del cliente enlaza a reportes y no al planificador administrativo. Se ocultan controles de planes internos que este perfil no puede consultar.
- Se mantienen el aislamiento por empresa y la publicación explícita de reportes. Los estados pendientes no se interpretan como equipos averiados.

## Validación y publicación

Compilación TypeScript, 174 pruebas de dominio, 40 de servidor/seguridad y 23 de integración con base local sintética. Recorridos de administración, técnico y cliente: filtros, agenda semanal, lectura rechazada y válida, persistencia tras recarga, reportes y ficha; comprobación de ancho móvil y contraste.

Publicar por PR con CI correcto. Después verificar despliegue, sesión y recursos, comparar registros con respaldo previo y capturar el resultado. Una reversión de interfaz no requiere restaurar datos. Contratos permanece pendiente.
