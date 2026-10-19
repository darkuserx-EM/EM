# Importación histórica y conciliación de lecturas

El formulario acepta directamente la plantilla `.xlsx` (hasta 8 MB), además de TXT/TSV. Solo lee la hoja `Carga`, con encabezados en la primera fila y hasta 2,000 filas de reportes. Nunca importa las instrucciones ni el ejemplo. Las fechas numéricas de Excel se interpretan como fecha y hora locales de Guatemala, sin depender del formato visual de la celda; H1 y H3 conservan su precisión numérica. Se rechazan fórmulas y filas con datos pero sin ID o fecha. Mantener los ID originales, las órdenes originales y las series exactas; revisar la vista previa antes de confirmar. La carga de Excel pasa por las mismas validaciones y transacción del servidor que la carga de texto, incluyendo la reutilización de lecturas y el bloqueo de conflictos.

La importación compara el equipo, cliente, instante real (UTC y Guatemala equivalentes), H1, H3 y calidad de la lectura. No compara solamente el valor del horómetro. Si existe una única lectura sin orden y coincide, conserva su ID, fecha, valores, autoría y procedencia y la vincula a la nueva orden. La bitácora conserva su versión anterior. Las lecturas estimadas, diferencias y coincidencias múltiples o ya vinculadas bloquean el lote completo. Un reporte repetido por ID de origen sigue omitiéndose.

La vista previa informa lecturas nuevas, reutilizadas y conflictos; el servidor vuelve a comprobar todo contra la revisión actual. Las consultas, errores y cierres del formulario no realizan escrituras. Las imágenes no se modifican.

La operación administrativa `reconcileHistoricalReadings` recibe pares explícitos `conservar_id` y `duplicada_id`, junto con la revisión. Solo admite una lectura histórica conservada sin orden y su duplicado generado por la importación, ambos equivalentes al mismo reporte e ID de origen. Rechaza otras referencias, grupos ambiguos, repetición de pares, cambios concurrentes y otros perfiles. No ofrece borrado general de lecturas.

Cada par deja la lectura original vinculada y archiva íntegros ambos registros anteriores en la bitácora (`lectura_original_json`, `lectura_duplicada_json`), además del equipo y orden asociados. La copia redundante sale de las lecturas activas; las bitácoras anteriores no se modifican. La transacción aplica todos los pares o ninguno. Antes de ejecutarla: respaldo completo verificado, ensayo aislado, comprobación de recuperación y comparación posterior de entidades, archivos y permisos.

Los códigos nuevos HOR-H se generan por el máximo existente para no reutilizar códigos tras la conciliación. Costos e inventario quedan fuera de este cambio.

## Corregir un reporte importado en la máquina equivocada

Administración puede corregir un reporte histórico importado desde su detalle, con el botón «Corregir reporte importado». Hay dos opciones y ambas piden un motivo de 8 a 500 caracteres:

- **Anular.** Se usa cuando el reporte no corresponde a ningún equipo de este cliente registrado en el portal. El reporte sale del historial activo junto con sus lecturas de importación (las registradas por «Importación histórica AppSheet»). Una lectura conservada de otro origen no se borra: solo pierde el vínculo con el reporte. Si después se registra el equipo correcto, el mismo reporte se puede volver a importar.
- **Mover a otro equipo del mismo cliente.** El reporte pasa al otro equipo con todas sus lecturas.

Lo que no se puede corregir así:

- un reporte con otras referencias (repuestos, horas o una solicitud vinculada);
- una orden creada en el portal;
- un cambio hecho por un perfil que no sea administración.

La bitácora guarda la versión anterior del reporte (`version_anterior`) y de sus lecturas (`lecturas_anteriores_json`). Si el reporte se movió, también guarda el equipo anterior (`equipo_anterior_id`). La operación aplica todo o nada y vuelve a comprobar la revisión de los datos.
