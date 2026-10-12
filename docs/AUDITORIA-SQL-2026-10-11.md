# Revisión de la auditoría SQL · 11/10/2026

La auditoría recibida identifica costes reales, pero sus EXPLAIN están simulados y sus tiempos/ganancias son proyecciones. em_records guarda un documento por fila; no es un único documento de toda la base. No hay evidencia aportada para afirmar que solo permite un operador.

## Decisiones y cambios

| Hallazgo | Resultado |
|---|---|
| SQL-01, lectura del conjunto | Fotografías ya separadas en em_media (#59). Subir adjuntos ahora autoriza consultando únicamente su orden, dentro del bloqueo que protege su existencia. Las mutaciones del dominio aún validan todo el conjunto; pendiente #20. |
| SQL-02, bloqueo global | Se conserva para no perder unicidad, relaciones o monotonicidad del horómetro. #61 eliminó falsos conflictos globales en operaciones independientes, pero no la serialización. Quitar el bloqueo exige validación incremental equivalente y pruebas de concurrencia. |
| SQL-03, índices de negocio | Es posible proyectar JSON en índices auxiliares o columnas; em_audit_index ya lo hace (#63). No se sustituyen las entidades por el esquema ilustrativo: usa campos/unidades y nulabilidad que no coinciden completamente con el dominio, y requiere migración de respaldo/roles. |
| SQL-04, adjuntos | Migración 8 añade (order_id,created_at,id) y (created_at,id), idempotentes. Listados desempatan por id. Manifiesto acepta limit 1–200 y cursor; sin parámetros conserva su respuesta completa para compatibilidad. |
| SQL-05, eventos | La consulta target_id/action citada pertenece a una prueba. La consulta real de eventos ya está paginada e indexada por created_at,id (#63). No se añaden índices de actor/target que ninguna pantalla consulta. |
| SQL-06, respaldo | Tanto respaldo de evidencias como completo usan lotes: hasta 50 metadatos y como máximo 8 MiB de binarios por consulta. OCTET_LENGTH mide bytes reales; no se confía en size para limitar memoria. Mantiene REPEATABLE READ, hashes y footer; un archivo corrupto interrumpe la descarga. |
| SQL-07, claves foráneas | No se aplica ON DELETE CASCADE: eliminar/restaurar registros no debe destruir evidencias. Se conserva autorización por orden y recuperación de archivos huérfanos explícita para administración. |
| SQL-08, usuarios | La instalación revisada tiene cinco cuentas. Leer la lista completa necesita todas las filas; un índice name/role no resuelve paginación ni implica una mejora. No se añade sin una consulta selectiva real. |

## Evidencia reproducible

server/sql.integration.test.mjs crea una base efímera de loopback con 4,000 adjuntos pequeños, 200 órdenes sintéticas y tres archivos de 4 MiB. Ejecuta EXPLAIN antes y después de migrar, compara bytes/hashes, comprueba paginación sin duplicados con fechas empatadas e instrumenta el guardado para descartar SELECT de toda em_records. Se ejecuta localmente en MariaDB y en CI con MySQL 8.

Resultado local MariaDB: por orden, índice order_id + Using filesort pasa a idx_attachment_order_created, 20 filas estimadas, sin filesort. Manifiesto limitado a 101 filas pasa de ALL + filesort a idx_attachment_created, 101 filas estimadas. No se fuerza el índice: el optimizador decide. Una consulta completa sin límite puede elegir ALL y ordenar; no se promete eliminar todo filesort.

Para 4,003 archivos: 164 consultas en lugar de 4,004 (aprox. 95.9% menos). El lote binario nunca supera 8 MiB. Base64, JSON, buffers HTTP y metadatos añaden memoria: 8 MiB no es un límite del RSS del proceso. No se atribuyen estos resultados sintéticos al rendimiento productivo ni se promete 15–40 veces más rapidez. Las fotos de equipo y registros del respaldo completo siguen con su recorrido acotado anterior; esta mejora de lotes afecta a los adjuntos.

## Despliegue y reversión

Migración aditiva, esquema 8; no transforma ni elimina registros/archivos. Los índices anteriores se conservan para compatibilidad. Revertir código conserva los índices y datos. CI debe estar verde antes de fusionar. Descargar un respaldo completo y contrastar identidades, hashes y conteos después. No restaurar un respaldo antiguo solo para revertir código.

No se introduce un linter SQL que prohíba indiscriminadamente SELECT *: en lecturas de una cuenta o una fila autorizada no significa escaneo completo. ESLint, pruebas de permisos/integración y planes medidos cubren cambios concretos; incorporar nuevas consultas con su evidencia.
