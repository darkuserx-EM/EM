# Validación del PR #121

Revisión del 20/10/2026 sobre `main` 20672d8 y la propuesta d662bca.

## Correcciones

- Una OS en borrador no representa una visita programada. Solo se consideran órdenes del portal del mismo ID de equipo y tipo normalizado, en estado Programada, En proceso o En espera, con fecha válida. Se conservan los contratos y el vocabulario del repositorio (OT/OS son órdenes de servicio).
- Un preventivo programado ya no oculta un mayor vencido sin programar, ni viceversa. La fila identifica el tipo de servicio.
- Las sedes incluyen equipos sin plan; al expandirlos se muestran dentro de su sede, sin duplicarlos.
- El resumen distingue los vencidos de los que vencen hoy mediante la etiqueta conjunta; el cálculo de fechas, horas, estimaciones y lecturas antiguas continúa usando `projectPlan`.
- En móvil las filas se apilan con etiquetas para mantener visibles programación y acciones.
- Las consultas de esta pantalla se deshabilitan para roles no administrativos, manteniendo la autorización existente del servidor.

## Cobertura

Pruebas de regresión para borradores, fechas inválidas, equipos/tipos diferentes, estados terminados, sedes sin planes y cobertura parcial de ciclos. Pruebas de renderizado para el aviso pendiente junto a la OS programada y restricciones de los perfiles Coordinador, Técnico y Cliente.

Comprobación de navegador con datos sintéticos en localhost: escritorio 1440 px y móvil 390 px; búsqueda sin resultados, limpieza, filtro Sin plan y plegado. En 390 px, documento 390 px y tabla/contenedor 354 px, sin desbordamiento horizontal. La sesión de Coordinador no muestra equipos en esta pantalla.

La integración exige `pnpm test`, `pnpm build` y el CI del commit corregido, incluida la prueba MySQL. No hay cambios en esquemas, migraciones, datos operativos ni permisos del servidor. Las pruebas locales no equivalen a una prueba autenticada en producción. La disponibilidad del despliegue debe verificarse después de la fusión.
