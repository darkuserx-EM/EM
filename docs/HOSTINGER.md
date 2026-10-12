# Publicación de pruebas en Hostinger

Configuración de sincronización, registro de errores y comprobación pendiente del proxy: [ESTABILIZACION.md](ESTABILIZACION.md). Las nuevas variables son `TRUST_PROXY` (valor conservado: `1`) y `ENABLE_NETWORK_DIAGNOSTICS` (deshabilitada por defecto).

Destino autorizado: portal.expertosenmontacargas.com, como aplicación independiente del WordPress comercial. El 04/10/2026 se verificó Business Web Hosting, Node.js 24, pnpm y MySQL. El asistente se preparó con el subdominio y el repositorio entonces público https://github.com/darkuserx-EM/EM, rama main. La aplicación quedó publicada para pruebas el 04/10/2026. Se verificaron HTTPS, conexión con una base MySQL dedicada, acceso administrativo, escritura/importación y persistencia después del reinicio.

## Aplicación con MySQL

- Dirección verificada: https://portal.expertosenmontacargas.com.
- Compilar con Node.js 24: instalar dependencias y ejecutar `pnpm build`.
- En Web Apps, elegir Express, Node 24.x, pnpm, raíz ./ y entrada server/index.mjs. Compilación: pnpm build. Inicio: pnpm start. Puerto: PORT o 3000. El servidor entrega dist y resuelve las rutas de React.
- No configurar esta versión como Vite estático: necesita ejecutar el servidor para acceder a MySQL.
- Comprobar rutas directas, HTTPS, fuentes, descarga de Excel y comportamiento en móvil.
- Crear un destino independiente para el portal. No subir estos archivos sobre el public_html de WordPress existente.

## Primera instalación

Crear una base MySQL exclusiva y un usuario asociado. El titular debe introducir personalmente las credenciales nuevas. Usar el host indicado por Hostinger, habitualmente localhost. Completar las variables de .env.example en Hostinger, nunca en GitHub: DB_*, APP_ORIGIN, NODE_ENV=production, VITE_DATA_MODE=server y una clave SETUP_TOKEN aleatoria de al menos 32 caracteres. Ninguna contraseña debe usar un nombre VITE_*.

El servidor crea sus tablas y catálogos iniciales. La pantalla de instalación exige SETUP_TOKEN para crear la primera cuenta de administración. Tras iniciar sesión, retirar esa variable y reiniciar. Se creó una cuenta inicial de administración exclusiva para pruebas; sus credenciales se entregan por separado y no forman parte del repositorio. Se retiró SETUP_TOKEN después del alta y se verificó que la instalación permanece cerrada. Consultar BASE-DE-DATOS.md para el diseño, límites y pruebas de persistencia, permisos, importación y restauración. Antes de datos reales se deben comprobar las copias MySQL y una restauración.

La publicación inicial se hizo desde la URL pública y entonces no quedó habilitada la actualización automática. El 08/10/2026 se verificó que la integración del PR #16 en `main` disparó automáticamente un despliegue en Hostinger: commit `7538d948`, estado Completed/Current a las 09:55 de Guatemala. Las pruebas y compilación del PR habían pasado antes de integrarlo. El disparador de Hostinger responde a la actualización de main; no espera por sí mismo los checks de GitHub, por lo que sigue pendiente exigirlos con protección de rama.

En localhost se conserva la demostración; VITE_DATA_MODE=server fuerza la conexión al servidor para pruebas locales. Nunca publicar VITE_DATA_MODE=local como entorno operativo. La gestión de cuentas, recuperación de acceso y sus límites se documentan en CUENTAS-Y-RECUPERACION.md. Las fotografías y adjuntos persisten en MySQL y cuentan con respaldo verificable; ver FOTOGRAFIAS-MYSQL.md.

Los correos automáticos, WhatsApp y procesos programados necesitan configuración adicional; no están implementados ni contratados en esta entrega. No se requiere instalar WordPress ni adquirir un constructor de sitios para ejecutar este proyecto.

## Referencias

- https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/

La verificación del plan confirma compatibilidad, no capacidad garantizada para un volumen de usuarios aún no definido. Los recursos del plan se comparten con otros sitios.

## Estado verificado el 11/10/2026 (Guatemala)

El repositorio es privado y el despliegue automático continúa funcionando. La API de GitHub informa main sin protección; consultar su protección devuelve 403 por el plan de la cuenta. No cambiar a público para habilitarla. Hasta disponer de protección, comprobar manualmente CI del commit exacto antes de cada merge. Issue #11 reabierto con la evidencia. Hostinger no espera el resultado de CI en main.

El panel muestra respaldos diarios de MySQL. Se ensayaron migración, exportación y restauración en una base local aislada, comparando identidades y bytes. No equivale a restaurar una copia del proveedor. Quedan pendientes comprobar retención/recuperación de Hostinger y configurar un destino externo aprobado para copia cifrada.
