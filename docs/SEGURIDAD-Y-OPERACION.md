# Segundo bloque de estabilidad · 08/10/2026

## Cambios

- **#5:** ocho intentos por combinación correo/red IP durante quince minutos. Se mantiene el límite adicional por IP del acceso (30 por quince minutos). IPv6 se agrupa con `ipKeyGenerator`. Se elimina el bloqueo previo compartido solo por correo: elevarlo mantendría la posibilidad de impedir el acceso legítimo desde otras redes. No revela si una cuenta existe. La protección ante ataques distribuidos y segundo factor son mejoras futuras; el resultado depende también de verificar el proxy (#4).
- **#6:** restaurar conserva exactamente la bitácora actual y agrega una entrada con revisión del respaldo, fecha de exportación si está disponible y revisión reemplazada. No acepta la bitácora del archivo como sustituto del historial vigente. La operación es transaccional en servidor; una copia antigua no puede borrar acciones posteriores. Los archivos antiguos sin fecha siguen siendo compatibles y se indica que esta no está disponible.
- **#8:** login y configuración inicial aceptan como máximo 100 KiB; las demás rutas comprueban sesión y CSRF antes de leer el cuerpo. Las escrituras administrativas conservan 32 MiB para fotos y respaldos; el límite es deliberado para proteger memoria del alojamiento y se informa con 413. No hay cargas ilimitadas.
- **#9:** guardado por lotes de hasta 200 filas y 512 KiB acumulados, con filas grandes individuales. Borrados en grupos de 200. Se mantiene una única transacción y el bloqueo de revisión para impedir guardados cruzados. Reduce viajes a MySQL; no permite dos importaciones simultáneas sobre la misma revisión. El benchmark compara 2,000 filas sintéticas contra el algoritmo anterior dentro de una transacción revertida en MySQL de CI, no en datos operativos.
- **#10:** Mi cuenta permite cambiar contraseña (14–128 caracteres) y cerrar otras o todas las sesiones. Exige contraseña actual, sesión y CSRF; limita intentos. Cambiar la contraseña conserva la sesión actual y revoca las demás. Las rutas de cuenta y el inicio de sesión usan el mismo bloqueo por usuario para impedir que una petición con una contraseña antigua cree una sesión después del cambio. Los datos de cuentas quedan fuera del respaldo operativo.
- **#12:** CI ejecuta pruebas contra MySQL 8: migración repetible, índices en tablas existentes, lotes y borrados, rollback, conflicto 409, importación atómica, conservación de auditoría, límites de acceso, contraseña/sesiones y limpieza. Las pruebas solo aceptan MySQL de loopback y crean/eliminan su propia base `em_ci_<uuid>`, con información sintética. Nunca usan las variables DB del portal.
- **#13:** `packageManager` fija pnpm 10.18.3. README usa `npx pnpm@10.18.3`, sin depender de Corepack, y recomienda Node 24 LTS para igualar Hostinger. [Cambio de distribución de Corepack](https://github.com/nodejs/corepack#readme).
- **#14:** índices en vencimiento; limpieza al iniciar y cada quince minutos, hasta 500 filas vencidas por tabla y pasada, sin solapar ejecuciones. Conserva registros activos, registra fallos sin contenido sensible y se detiene al apagar el servidor. No modifica información de clientes ni equipos.

## Lo que no conviene cambiar parcialmente

**#1:** la causa del bloqueo de 20,000 filas y el costo cuadrático ya se corrigieron. Se conserva la validación completa al cargar/guardar instantáneas: sustituirla solo por validación de campos editados omitiría unicidad y relaciones entre entidades. La caché evita repetirla en consultas sin cambios. Separar bitácora y fotos, paginar y validar cambios de manera incremental requiere una migración coordinada de esquema, API, exportación y restauración. Queda como fase de escalabilidad, no como requisito para publicar este bloque.

**#4:** el diagnóstico preparado sigue apagado. Aún se necesita verificar la cadena de proxies desde dos redes independientes y contrastarla con Hostinger. No se asume que una IP privada autorice confiar en una subred completa.

**#11:** el workflow incluye MySQL en `test-and-build`; exigir su resultado al integrar cambios se configura en la protección de `main`, no en el código. Debe comprobarse en GitHub antes de considerar cerrado ese issue. [Protección de ramas](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## Despliegue y recuperación

Conservar respaldo privado antes de publicar y comparar los registros después. La única modificación de esquema es añadir índices si faltan: no transforma ni elimina datos de negocio. La limpieza afecta exclusivamente a sesiones/límites ya vencidos. Para revertir código no restaurar un respaldo de datos antiguo; los índices añadidos son compatibles con la versión anterior.

Las pruebas de contraseñas, restauración y revocación se ejecutan con cuentas sintéticas en CI. No cambiar la contraseña real del administrador ni cerrar sus otras sesiones como prueba de publicación. Verificar en línea salud, sesión, sincronización, rechazo anónimo y apertura de Mi cuenta sin enviar el formulario.

## Sesiones e inactividad

Máximo absoluto: 8 horas. Se cierra tras 60 minutos sin interacción (SESSION_IDLE_MINUTES, 15–240). El sondeo y las lecturas automáticas no renuevan la sesión. La interacción de teclado, clic o desplazamiento envía una confirmación con CSRF, como máximo una vez por minuto. En producción la cookie es __Host-em_session (Secure, HttpOnly, SameSite=Strict, Path=/, sin Domain). Las sesiones antiguas se migran al siguiente uso conservando su vencimiento; salir borra ambas cookies. La migración 6 inicializa la actividad de sesiones anteriores una sola vez; no amplía las 8 horas. Reversión: cerrar las sesiones y volver a ingresar con la versión anterior; la columna añadida es compatible.
