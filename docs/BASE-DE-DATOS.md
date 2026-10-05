# Base compartida para las pruebas

La aplicación Node.js usa Express y MySQL con un usuario dedicado a una base nueva. Nunca se debe usar la base ni las credenciales de WordPress. El sitio comercial permanece en su dominio; el portal se instala como aplicación independiente en portal.expertosenmontacargas.com.

## Estructura inicial

- `em_meta`: versión de estructura y revisión global para detectar cambios concurrentes.
- `em_records`: un registro por entidad e identificador, con contenido validado y serializado como JSON. Esta estructura conserva los identificadores y las plantillas del prototipo mientras evolucionan los módulos. No representa todavía un esquema relacional final de los 20 módulos.
- `em_users`: cuentas, rol y contraseña derivada con scrypt y una sal aleatoria. Las cuentas se separan de las filas Usuario de los respaldos del prototipo.
- `em_sessions`: identificador de sesión derivado con SHA-256, token CSRF y vencimiento de 8 horas.
- `em_login_limits`: límite de intentos por cuenta, persistido entre reinicios.

Las tablas nuevas se crean con InnoDB al iniciar. La instalación inicial carga solo catálogos; no incorpora los clientes, equipos ni reportes ficticios o reales del navegador. Una transacción bloquea la revisión global para validar y guardar registros e historial juntos. Una revisión desactualizada se rechaza; la interfaz recupera la revisión actual para que el usuario revise su cambio.

Esta primera implementación está destinada a pruebas de EMSA. Lee el conjunto de registros dentro de una transacción y filtra por rol antes de responder. Antes de escalar el volumen se necesitan consultas por módulo, paginación y tablas/índices específicos. No se anuncia como plataforma SaaS multiorganización final.

## Acceso

1. Completar `DB_*`, `APP_ORIGIN`, `NODE_ENV=production`, `VITE_DATA_MODE=server` y una clave `SETUP_TOKEN` aleatoria de al menos 32 caracteres en las variables de Hostinger.
2. Publicar. La página inicial permite crear una sola cuenta de administración, verificando la clave de instalación en el servidor. El titular debe introducir personalmente su nueva contraseña (mínimo 14 caracteres).
3. Iniciar sesión. Retirar `SETUP_TOKEN` de Hostinger y reiniciar después de confirmar el acceso. Aunque la clave permanezca configurada, la existencia de cualquier cuenta impide repetir la instalación.

El servidor exige una sesión válida para leer datos. Las mutaciones requieren administrador, mismo origen y token CSRF. Nunca toma el rol del cuerpo enviado por el navegador. Las cookies son HttpOnly, Secure en producción y SameSite=Strict. Las contraseñas, secretos y archivos .env no se publican en GitHub ni en el directorio dist.

La interfaz de altas de usuarios, recuperación de contraseña y MFA aún no está implementada. En esta entrega se crea la cuenta inicial de administración; la cuenta de pruebas es una cuenta real del servidor, y no se permite cambiar de rol mediante un selector. No usar información operativa real hasta completar las pruebas y verificar copias y restauración.

## Validación realizada en MySQL real · 04/10/2026

- `/api/health` respondió por HTTPS con la base dedicada conectada.
- Cuenta inicial creada; inicio y cierre de sesión, rechazo de contraseña incorrecta y bloqueo de una segunda instalación verificados. Cookies HttpOnly, Secure y SameSite=Strict.
- Cliente, contacto, sede, equipo y lectura inicial de 100 horas guardados. Dos sesiones independientes consultaron los mismos registros. Se comprobó nuevamente la persistencia tras el reinicio de Node.js al retirar SETUP_TOKEN. El navegador mostró la ficha del cliente y el historial inicial del equipo.
- El servicio de importación aceptó tres clientes ficticios en un lote. Un lote con errores se rechazó sin altas parciales. También se exportaron los cuatro clientes desde el navegador y se volvió a cargar el Excel: la vista previa mostró cuatro actualizaciones y cero errores; la confirmación guardó el lote en el servidor sin duplicar clientes.
- Revisión atrasada rechazada; escritura sin CSRF válido o desde otro origen rechazada; lectura sin sesión rechazada.

## Validación pendiente antes de datos operativos

- Descargar respaldo, restaurarlo en una base de ensayo y verificar registros e historial. El Excel no incluye cuentas, sesiones ni archivos adjuntos.
- Confirmar los respaldos de MySQL del alojamiento y su restauración antes de habilitar datos reales.

Las pruebas automáticas locales cubren validaciones, filtrado, contraseñas, sesión requerida, rechazo de rol falsificado, origen y CSRF. Los tests HTTP usan un sustituto de almacenamiento y no confirman por sí mismos la conexión ni las transacciones de Hostinger.
