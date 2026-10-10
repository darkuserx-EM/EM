# Portal EMSA

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Administración EMSA: organiza flota, clientes, mantenimiento, solicitudes, órdenes y agenda.
- Técnicos: consultan trabajo asignado y registran reportes, lecturas y evidencia.
- Clientes: consultan exclusivamente su flota y los reportes compartidos; solicitan atención.

## Product Purpose

Relacionar equipos, clientes, sedes, mantenimiento e historial para que cada usuario identifique pendientes y decida la siguiente acción con información verificable.

## Operating Context

Operación en Guatemala. El portal se utiliza en escritorio y móvil. Las fechas operativas usan America/Guatemala. Existe información histórica importada de AppSheet; las fotografías de esa aplicación están en Google Drive. La revisión de esa integración está pendiente.

## Capabilities and Constraints

- Conservar funciones, cálculos, permisos y relaciones al refinar la interfaz.
- Mantener separados el estado operativo, la situación administrativa y el aviso de mantenimiento.
- Distinguir mediciones registradas, estimadas y proyecciones. Un dato pendiente no equivale a cero ni a una falla.
- Identificar equipos por código, ID interno del cliente, marca, modelo y serie.
- Planes por horas o días; intervalos solicitados de 250 horas y 30, 60 o 90 días. El mantenimiento mayor de 2,000 horas requiere una base confirmada.
- Capacidad en lb; alturas en pulgadas y metros; distancia en millas por defecto.
- Conservar reportes y fotografías como evidencia relacionada con el equipo.
- Contratos permanece pendiente por decisión del usuario.
- Publicación existente en portal.expertosenmontacargas.com, separada del sitio comercial, con repositorio GitHub privado y Hostinger.

## Brand Commitments

Portal EM / Expertos en Montacargas (EMSA). Interfaz en español, lenguaje sencillo y operativo. Conservar la identidad existente. Para la vista de administrador y la Ficha del equipo, el usuario solicitó menos tarjetas innecesarias, textos repetidos, redondeado excesivo y degradados genéricos. Las seis pestañas de la ficha comparten ancho, jerarquía y separadores; se conservan los estados, la evidencia, las acciones y el diseñador opcional.

La ficha usa el ancho máximo común de 1,600 px. Cliente, sede y última lectura pertenecen al encabezado; las especificaciones y observaciones se consultan en un panel lateral desplegable. Los costos se muestran solo a administración en Reparaciones y servicios, según el período seleccionado.

## Evidence on Hand

Estos hechos provienen de las decisiones y respuestas del usuario en la conversación de desarrollo y de la implementación existente. Las pruebas de interfaz deben usar datos sintéticos; no fabricar métricas, estados ni resultados de mantenimiento. No registrar credenciales ni datos privados de clientes en esta documentación.

## Product Principles

1. Priorizar pendientes y acciones sobre decoración.
2. Mostrar la fuente y el alcance de los indicadores.
3. Conservar historial e integridad de los datos.
4. Mantener coherencia entre perfiles y tamaños de pantalla.
5. Probar cada cambio antes de publicar.

## Open Decisions

Almacenamiento e integración definitiva de fotografías; completar contratos en otra etapa. No se ha fijado una preferencia de generación de imágenes para futuras páginas comerciales; esta pantalla de aplicación se refina directamente en código.
