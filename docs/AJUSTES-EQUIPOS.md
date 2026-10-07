# Especificaciones de equipos

Cambios solicitados por EMSA el 7 de octubre de 2026:

- Capacidad en libras (`capacidad_lb`).
- Elevación en pulgadas (`altura_elevacion_in`), con conversión a metros al lado. Opciones proporcionadas por el usuario: 192, 195, 210, 240, 270, 276, 294, 300, 312, 321, 330, 341, 348, 366, 384, 400 y 402. No se atribuyen automáticamente a ningún modelo.
- Torre completamente bajada (`altura_torre_in`), confirmada por el usuario como medida para verificar accesos. Se captura en pulgadas y muestra metros.
- Cuchillas (`largo_cuchillas_in`): 30, 36, 39, 42, 45 y 48 pulgadas. El valor inicial 42 se usa únicamente en equipos nuevos, no para rellenar datos desconocidos de equipos existentes.
- Voltaje: 12, 24, 36 y 48 V. Se incluye 36 V porque aparece en la captura del equipo; también se conserva la entrada de otros valores.
- Energía: Eléctrico, Diésel, Gas o Dual; admite otras opciones. No se infiere la combinación de combustibles de un equipo dual.
- Batería: número de serie, campo compacto junto a voltaje. Cargador conservado.
- Llantas delanteras / rodos de carga y llantas traseras / tracción (giro), en campos separados. Opciones de rodos proporcionadas: 4 × 4.1, 5 × 2.9, 5 × 4.1, 6 × 2.9 y 6 × 4.1 pulgadas. No se presupone el orden diámetro/ancho de la referencia.
- Caster opcional: sin especificar, no aplica o especificación manual. El operador elige según el modelo; no se inventa una relación con un catálogo de modelos.

## Compatibilidad

Una pulgada equivale a 0.0254 metros; una libra a 0.45359237 kilogramos. La presentación de metros se redondea a tres decimales. Las unidades anteriores (`capacidad_kg`, `altura_elevacion_m`) se conservan y sincronizan cuando se recibe una corrección, incluyendo borrados. Los registros anteriores se muestran mediante conversión sin migración masiva ni modificación al abrirlos. El texto anterior de `llantas` se conserva y aparece como referencia. Los campos nuevos viajan en los respaldos y exportaciones de equipo.

La forma de guardar y los permisos de administración no cambian. Horómetros, contactos, clientes, sedes e historiales existentes no se modifican al publicar esta actualización.

## Fotografías y placa de datos

Cada equipo admite seis imágenes opcionales. `foto_equipo` se conserva como **Imagen de referencia del equipo**, guía visual del tipo/modelo que aparece en el encabezado y los listados. `placa_datos` conserva la placa original. Las nuevas `foto_frontal`, `foto_trasera`, `foto_lateral_1` y `foto_lateral_2` muestran el equipo real, sus aditamentos y daños visibles; no se rellenan con imágenes de referencia. La galería agrupa estas cuatro vistas y muestra por separado la referencia y la placa. Administración las carga, reemplaza o retira desde Nuevo/Editar equipo; los cambios se confirman al guardar. Se admiten PNG, JPEG y WebP de hasta 10 MB. Se conserva el archivo original si su data URL no supera 3 500 000 caracteres; las imágenes mayores se ajustan en el navegador, manteniendo hasta 2800 píxeles. La placa puede ampliarse en su visor. No se realiza OCR ni se cambian especificaciones automáticamente a partir de la fotografía.

Por preferencia del usuario, la galería aparece únicamente al seleccionar la pestaña **Fotografías y placa**, situada junto a Reparaciones y servicios y Uso y horómetro. La ficha abre inicialmente en Reparaciones y servicios; la galería no ocupa la vista principal.

Las imágenes se guardan en MySQL junto al registro, no en archivos del despliegue ni en el repositorio público. Las respuestas normales sustituyen los bytes por una referencia SHA-256; el navegador solicita cada imagen por una ruta autenticada que comprueba la visibilidad del equipo. La bitácora describe carga o retiro sin copiar bytes. La fotografía sustituye al ícono de ese equipo en el encabezado, la flota, la ficha del cliente y los estados sin historial. Los demás equipos conservan su imagen propia o el ícono genérico.

El respaldo completo y las exportaciones administrativas recuperan los archivos. Excel los divide en partes de 30 000 caracteres en `_imagenes_equipo` para respetar el tamaño de las celdas; al restaurar se comprueban equipo, campo, orden, duplicados, integridad de las partes y formato. El formulario permite guardar las seis imágenes juntas: el servidor admite hasta 32 MB en la ruta de cambios, después de verificar sesión, CSRF y administración. Las importaciones de clientes y catálogos siguen limitadas a archivos de 8 MB; seleccionar un respaldo admite 32 MB. El límite de 32 MB de la solicitud también se aplica al contenido restaurado, aunque el Excel esté comprimido. Los respaldos sin fotografías continúan siendo compatibles. En una fase de mayor volumen, la lectura de imágenes puede separarse del registro MySQL detrás de estas mismas rutas.

El documento maestro define **TCE** para equipo del cliente, **TCL** para equipo propio y **CLI** para cliente; no proporciona una expansión literal para cada letra. El sufijo numérico es el correlativo por prefijo. Se mantienen estos códigos y la serie del fabricante como identificadores distintos.
