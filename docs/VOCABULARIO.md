# Vocabulario común de servicios

Los reportes importados de AppSheet y las órdenes del portal escriben los mismos conceptos de forma distinta. Toda pantalla, regla o indicador nuevo debe clasificarlos con `src/domain/vocabulary.ts`, nunca con listas de textos propias.

## Tipo de servicio · `serviceKind(row)`

| Clase | Valores reconocidos (sin distinguir mayúsculas, tildes ni espacios) |
|---|---|
| Preventivo | Preventivo, Mantenimiento Preventivo |
| Mayor | Mantenimiento Mayor, Mantenimiento mayor, Mayor |
| Correctivo | Correctivo |
| Emergencia | Emergencia |
| Inspección | Inspección |
| Otro | Cualquier otro valor o vacío. No se adivina la clase |

## Servicio completado · `isCompletedService(row)`

Completado: Completada, Completado, Completado con observaciones, Cerrada, Cerrado, Finalizada, Finalizado.

No completado: Pendiente, Pendiente de firma, Borrador, Programada, En proceso, En espera, Cancelada o vacío.

`completedService` (hallazgos y base de planes) y `orderClosed` (Inicio y Reportes) usan esta misma definición.

## Estado de un plan · `projectPlan` y `planStatusLabel`

- Un vencimiento calculado con base o lectura estimada **sigue siendo «Vencido» o «Vence hoy»**, con tono de peligro y `estimated: true`.
- En pantalla se muestra «Vencido · estimado» mediante `planStatusLabel`.
- Las estimaciones que aún no vencen conservan «Base estimada» o «Base o lectura estimada» para que se revisen.

## Al agregar un valor nuevo

1. Añadir el alias en `vocabulary.ts` y su caso en `vocabulary.test.ts`.
2. No duplicar listas de tipos o estados en componentes o en otros módulos del dominio.
