# Importación histórica y conciliación de lecturas

La importación compara el equipo, cliente, instante real (UTC y Guatemala equivalentes), H1, H3 y calidad de la lectura. No compara solamente el valor del horómetro. Si existe una única lectura sin orden y coincide, conserva su ID, fecha, valores, autoría y procedencia y la vincula a la nueva orden. La bitácora conserva su versión anterior. Las lecturas estimadas, diferencias y coincidencias múltiples o ya vinculadas bloquean el lote completo. Un reporte repetido por ID de origen sigue omitiéndose.

La vista previa informa lecturas nuevas, reutilizadas y conflictos; el servidor vuelve a comprobar todo contra la revisión actual. Las consultas, errores y cierres del formulario no realizan escrituras. Las imágenes no se modifican.

La operación administrativa `reconcileHistoricalReadings` recibe pares explícitos `conservar_id` y `duplicada_id`, junto con la revisión. Solo admite una lectura histórica conservada sin orden y su duplicado generado por la importación, ambos equivalentes al mismo reporte e ID de origen. Rechaza otras referencias, grupos ambiguos, repetición de pares, cambios concurrentes y otros perfiles. No ofrece borrado general de lecturas.

Cada par deja la lectura original vinculada y archiva íntegros ambos registros anteriores en la bitácora (`lectura_original_json`, `lectura_duplicada_json`), además del equipo y orden asociados. La copia redundante sale de las lecturas activas; las bitácoras anteriores no se modifican. La transacción aplica todos los pares o ninguno. Antes de ejecutarla: respaldo completo verificado, ensayo aislado, comprobación de recuperación y comparación posterior de entidades, archivos y permisos.

Los códigos nuevos HOR-H se generan por el máximo existente para no reutilizar códigos tras la conciliación. Costos e inventario quedan fuera de este cambio.
