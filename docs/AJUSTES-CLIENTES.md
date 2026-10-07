# Ajustes del formulario de clientes — 7 de octubre de 2026

El código CLI se asigna al guardar. La referencia externa se conserva para relacionar contactos y sedes en Excel, pero no se solicita en la captura web. Razón social y nombre comercial se guardan por separado. Lista, búsqueda, ficha y selección de cliente reconocen el nombre comercial y conservan la razón social.

Sector / actividad se selecciona del catálogo administrable «Sectores / actividades». Al iniciar el servidor, la migración 2 agrega diez opciones iniciales una sola vez sin sustituir catálogos existentes. `em_meta.schema_version` controla esta migración interna; el formato de respaldo continúa en `schemaVersion: 1` porque las nuevas columnas son opcionales.

Ubicación principal identifica la planta, sede o municipio principal. Las direcciones de atención se administran en Sedes y la dirección fiscal permanece separada. Plus Code tiene su propio campo de texto. Pendiente de una fase posterior: enlazarlo con mapas, definir el proveedor y resolver códigos abreviados con su localidad. Esta entrega no geocodifica ni envía ubicaciones a servicios externos.

Día de facturación y reporte mensual de horas se ocultan en formulario y ficha. Se mantienen las columnas antiguas para leer respaldos previos, y editar el cliente no elimina sus valores históricos. La plantilla de altas ya no las solicita.

El logo admite PNG, JPG o WebP de hasta 5 MB. El navegador genera una imagen WebP compacta de hasta 384 píxeles por lado y 24 000 caracteres de data URL, reduciéndola cuando sea necesario. Se conserva la imagen ajustada, no el archivo original. Se almacena con el cliente en MySQL, sobrevive a despliegues y cabe en una celda de Excel para exportación/restauración. La validación compartida restringe tamaño, formato y firma de imagen; no admite SVG ni URLs externas. La bitácora registra actualización o retiro sin copiar la imagen en su texto.

El error de respuesta del servidor comunicado por el usuario no se reprodujo en la comprobación inicial con datos ficticios. La interfaz ahora distingue respuestas no JSON, fallos de conexión y tiempo de espera. Conserva el formulario ante esos fallos y no reintenta escrituras automáticamente, evitando altas duplicadas. La comprobación final debe cubrir alta con logo, edición y recarga desde el navegador publicado.

Verificación local: 55 pruebas de datos y 8 de servidor aprobadas. Incluyen ida y vuelta XLSX de logo/nombre comercial/Plus Code, conservación de columnas antiguas, rechazo de imágenes no admitidas, catálogo idempotente y errores de conexión sin reintentos. TypeScript y compilación de producción completados.

Verificación publicada del formulario de clientes: alta y edición desde el navegador, logo y campos nuevos confirmados tras recargar y desde una sesión independiente. La protección por revisión rechazó un guardado mientras había cambios en otro dispositivo; se recargó antes de continuar. El registro ficticio se retiró sin alterar clientes, contactos ni sedes reales. Hostinger publicó automáticamente el commit `c2bc7c37` desde GitHub.

## Sedes y contacto de ingreso

Departamento se elige de una lista, con Guatemala seleccionada en nuevas sedes. Se conservan los valores existentes al editar. La lista corresponde a los departamentos publicados por el [INE](https://www.ine.gob.gt/perfil_estadistico/).

Horario de atención deja de aparecer en captura y ficha. Su columna histórica se conserva para respaldos anteriores. Quién autoriza el ingreso guarda `autoriza_contacto_id`: un contacto del mismo cliente. La ficha consulta el nombre, cargo, teléfono y correo actuales de ese contacto, y permite abrir la sección Contactos. Si todavía no hay contactos, se explica cómo agregarlos y se permite guardar la sede sin asignar una persona.

La validación compartida comprueba esa relación en altas, ediciones, restauraciones y vista previa de importación. Cambiar de empresa a un contacto vinculado no puede dejar una sede con una relación incorrecta. El texto antiguo `autoriza_ingreso` no se convierte automáticamente en una persona, porque podría contener un cargo o un nombre ambiguo. Se muestra como referencia al editar hasta seleccionar un contacto. La plantilla incorpora referencia de ubicación y el ID opcional del contacto existente; también puede vincularse posteriormente en la web.
