# Ajustes del formulario de clientes — 7 de octubre de 2026

El código CLI se asigna al guardar. La referencia externa se conserva para relacionar contactos y sedes en Excel, pero no se solicita en la captura web. Razón social y nombre comercial se guardan por separado. Lista, búsqueda, ficha y selección de cliente reconocen el nombre comercial y conservan la razón social.

Sector / actividad se selecciona del catálogo administrable «Sectores / actividades». Al iniciar el servidor, la migración 2 agrega diez opciones iniciales una sola vez sin sustituir catálogos existentes. `em_meta.schema_version` controla esta migración interna; el formato de respaldo continúa en `schemaVersion: 1` porque las nuevas columnas son opcionales.

Ubicación principal identifica la planta, sede o municipio principal. Las direcciones de atención se administran en Sedes y la dirección fiscal permanece separada. Plus Code tiene su propio campo de texto. Pendiente de una fase posterior: enlazarlo con mapas, definir el proveedor y resolver códigos abreviados con su localidad. Esta entrega no geocodifica ni envía ubicaciones a servicios externos.

Día de facturación y reporte mensual de horas se ocultan en formulario y ficha. Se mantienen las columnas antiguas para leer respaldos previos, y editar el cliente no elimina sus valores históricos. La plantilla de altas ya no las solicita.

El logo admite PNG, JPG o WebP de hasta 5 MB. El navegador genera una imagen WebP compacta de hasta 384 píxeles por lado y 24 000 caracteres de data URL, reduciéndola cuando sea necesario. Se conserva la imagen ajustada, no el archivo original. Se almacena con el cliente en MySQL, sobrevive a despliegues y cabe en una celda de Excel para exportación/restauración. La validación compartida restringe tamaño, formato y firma de imagen; no admite SVG ni URLs externas. La bitácora registra actualización o retiro sin copiar la imagen en su texto.

El error de respuesta del servidor comunicado por el usuario no se reprodujo en la comprobación inicial con datos ficticios. La interfaz ahora distingue respuestas no JSON, fallos de conexión y tiempo de espera. Conserva el formulario ante esos fallos y no reintenta escrituras automáticamente, evitando altas duplicadas. La comprobación final debe cubrir alta con logo, edición y recarga desde el navegador publicado.

Verificación local: 55 pruebas de datos y 8 de servidor aprobadas. Incluyen ida y vuelta XLSX de logo/nombre comercial/Plus Code, conservación de columnas antiguas, rechazo de imágenes no admitidas, catálogo idempotente y errores de conexión sin reintentos. TypeScript y compilación de producción completados.
