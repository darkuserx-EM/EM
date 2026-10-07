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
