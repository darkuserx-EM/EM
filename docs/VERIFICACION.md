# Verificación de la base y captura web

Fecha de revisión: 04/10/2026, zona America/Guatemala.

- TypeScript: compilación sin errores.
- Vite: distribución de producción generada correctamente, con fuentes e iconos locales.
- Vitest: 48 pruebas aprobadas. Cubren modelo, persistencia, autoría, duplicados, cuota, revisiones entre pestañas, roles, filtrado por cliente, Excel, importación atómica, actualización por ID, restauración, historial y captura web. Diez pruebas cubren específicamente la importación de clientes y los permisos de importación/exportación; los perfiles sin Administración no pueden exportar.
- Excel: respaldo escrito como archivo XLSX binario y leído nuevamente; igualdad de las 20 entidades verificada por prueba.
- Navegador: creación de una marca ficticia, rechazo de duplicado y persistencia después de recargar.
- Navegador: importación de XLSX inválido muestra dos errores y bloquea Confirmar; archivo válido muestra vista previa y se importa correctamente.
- Navegador: cambio a cliente muestra exclusivamente sus dos equipos de ejemplo; acceso directo a /catalogos redirige a /portal.
- Escritorio y viewport de 390 px: revisión visual, navegación móvil y comprobación de ancho de documento sin desbordamiento global. Las tablas amplias permiten desplazamiento dentro de su contenedor.
- Consola del navegador: sin errores ni advertencias en las pantallas comprobadas.
- Descarga de respaldo: el botón se ejecutó sin errores en la consola, pero el automatizador del navegador no recibió el evento de descarga. El contenido XLSX sí se verificó por prueba automatizada; confirmar manualmente la recepción del archivo en el navegador del usuario.

## Entorno de desarrollo

El modo HMR estándar de Vite encontró una restricción del entorno Windows al escanear directorios padres fuera del proyecto. La compilación final y las pruebas funcionan con configuración nativa. Se añadió `pnpm dev`, que observa cambios, recompila y sirve una vista local sin ese escaneo. Después de guardar un cambio se recarga la pestaña. `pnpm dev:hmr` queda disponible para estaciones sin esa restricción.

## Estado de entrega

La base de la etapa 1 está implementada y se adelantó la captura web de clientes, contactos, sedes y equipos como avance parcial de las etapas 2 y 3. Contratos y los demás flujos operativos siguen pendientes. El servidor local muestra una demostración, no un despliegue en Hostinger ni una conexión real a MySQL. El selector de roles no es autenticación real.

Se dejaron dos opciones explícitas de prueba en el navegador usado para la revisión: una marca creada y una importada inactiva. Forman parte de los datos ficticios de prueba y quedan auditadas. El código fuente conserva la muestra inicial limpia.

## Ajuste de la ficha y plantilla de clientes

- La consulta por equipo muestra tres intervenciones y diez lecturas de muestra. Los servicios permanecen pendientes de firma; no se simula el cierre real de una OT.
- Navegador: TCL-001 muestra 850 h acumuladas, 240 h de diferencia entre las diez lecturas y 7 h de mano de obra. Filtro 01/09/2026 a 03/10/2026: un servicio, tres lecturas, 35 h de uso y 1.5 h de mano de obra. Un intervalo invertido muestra error y bloquea exportación.
- Se corrigió la aplicación inmediata de los campos de fecha mediante eventos input, comprobada nuevamente en el navegador.
- Navegador: coordinación consulta las reparaciones sin el panel de costos. Se restauró el perfil administrador al terminar.
- Revisión visual del expediente a 1440 px y 390 px. La tabla de lecturas se desplaza en su contenedor, sin desbordamiento del documento; gráfica y campos legibles. Consola sin errores ni advertencias.
- Los catálogos anteriores se conservaron: 35 opciones en el navegador revisado. La muestra del código contiene 33.
- Plantilla de clientes: cuatro hojas (Guía, Cliente, Contacto y Sede), 100 filas vacías por hoja de captura, mínimos señalados, listas de estado/Sí/No, día de facturación 1–31, NIT y teléfono como texto. Las cuatro hojas se renderizaron y revisaron; se reabrió el XLSX para verificar encabezados, celdas vacías, validaciones y paneles congelados C2. No contiene fórmulas de cálculo.
- El enlace Plantilla de clientes se verificó en Clientes y el archivo está incluido en dist/templates. La guía se actualizó para la importación disponible en la web; conserva datos, estilos, validaciones y paneles de las cuatro hojas.

## Captura y edición desde la web

- Administración dispone de Nuevo cliente y Nuevo equipo; la ficha de cliente permite agregar y editar contactos y sedes, y vincular equipos. Los campos obligatorios se indican y los códigos se generan automáticamente.
- Navegador: se creó Cliente de prueba web EMSA (CLI-007), un contacto ficticio, Bodega de prueba web (SED-001) y un equipo ficticio (TCL-019, serie DEMO-WEB-EMSA-001). Se verificaron los vínculos entre cliente, sede y equipo.
- El equipo nuevo conserva una única lectura inicial de 125.5 h y no recibe reparaciones de muestra. Su estado se cambió a En mantenimiento y se agregaron observaciones; ambos persistieron al recargar. La ficha muestra sede y referencia de ubicación.
- Al cambiar el cliente en el formulario se limpia la sede anterior. Solo aparecen sedes del cliente seleccionado. El alta iniciada desde una ficha mantiene ese cliente.
- Distelsa, Bodega A, la dirección proporcionada y G96Q+P5 Villa Nueva se usan únicamente como textos de ejemplo en campos vacíos; no se creó ese cliente ni se geocodificó la dirección.
- Formularios revisados visualmente a 1440 y 390 px. El documento móvil mide 390 px y el diálogo tiene 349 px de ancho útil, sin desbordamiento horizontal. Se comprobó el desplazamiento hasta los campos inferiores y los botones de guardado.
- Las pruebas adicionales validan rechazo de duplicados, referencias inexistentes y sedes de otra empresa; ausencia de escrituras parciales; restricciones de perfiles; conservación de lectura y propiedad al editar; y respaldo XLSX de los nuevos datos y vínculos.
- Las lecturas posteriores, las correcciones auditadas de horómetro/propiedad y la importación masiva de equipos siguen pendientes de sus etapas. Las importaciones de Catálogos y Clientes están disponibles para Administración.
- Los registros ficticios de esta comprobación permanecen en el navegador de revisión. La muestra incluida en el código fuente conserva los seis clientes y veinticinco equipos originales.

## Lista y ficha lateral de clientes

- Se aplicó la alternativa elegida: directorio a la izquierda y ficha a la derecha, con Resumen, Equipos, Contactos y Sedes. La tarjeta anterior y la ficha aislada fueron reemplazadas; los formularios y datos existentes se conservan.
- Navegador: cambio al cliente de prueba mantiene su sede, contacto y equipo. La edición de contacto abre los datos existentes; al cancelar se conserva la sección. Nuevo equipo abre con el cliente fijo y solo sus sedes disponibles.
- Filtro Prospecto muestra una empresa; una búsqueda incompatible muestra el estado vacío y Limpiar filtros restaura el directorio.
- Revisión visual a 1440 y 390 px. En móvil la lista permite desplazamiento interno y la ficha se apila debajo; no se observó desbordamiento horizontal del documento.
- TypeScript y producción Vite completan sin errores; las 38 pruebas existentes siguen aprobadas. No se alteró el almacenamiento ni se agregaron registros para este cambio de diseño.

## Importación de clientes y permisos administrativos

- Navegador: archivo con tres clientes, un contacto y una sede; un estado inválido señala la fila del cliente y la sede dependiente, y bloquea Confirmar. No se guarda parte del archivo.
- Archivo corregido: vista previa de cinco altas sin errores. Al confirmar se crean CLI-008, CLI-009 y CLI-010 con nombres explícitos de prueba, un contacto para A y una sede para C. La lista y el contacto vinculado permanecen después de recargar. Estos registros ficticios permanecen en el navegador; la muestra del código fuente no cambió.
- Coordinación: Clientes conserva la consulta y no muestra plantilla, importar, exportar, nuevo ni editar. El rol Administrador se restaura al terminar. Las pruebas comprueban además el rechazo desde el repositorio para todos los otros perfiles.
- Diálogo revisado en escritorio y a 390 px: documento de 390 px, modal de 364 px y tabla con desplazamiento interno. Confirmación accesible en móvil.
- La plantilla actualizada conserva sus cuatro hojas, los datos de captura vacíos, validaciones, estilos y paneles congelados; se modificaron únicamente cuatro celdas de instrucciones.
