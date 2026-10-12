# Publicación de pruebas en Hostinger

Configuración de sincronización y registro de errores: [ESTABILIZACION.md](ESTABILIZACION.md). El proxy se verificó el 12/10/2026; se conserva `TRUST_PROXY=1` (valor predeterminado). `ENABLE_NETWORK_DIAGNOSTICS` permanece deshabilitada tras la comprobación.

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

## Proxy verificado el 12/10/2026 — issue #4

Se habilitó temporalmente el diagnóstico administrativo en la versión `e1ff3951`, con Hostinger CDN activo. Se compararon la conexión de trabajo y el teléfono del titular con Wi-Fi apagado y datos móviles 5G. La segunda medición fue entregada por el titular a las 06:38 de Guatemala. Las direcciones completas y la captura se conservan fuera de Git.

| Comprobación | Resultado |
| --- | --- |
| Dos redes independientes | Direcciones IPv6 efectivas distintas; ninguna corresponde al socket local. |
| Entrada a Node.js | Socket `127.0.0.1` en ambas mediciones. |
| Resolución de Express | `trustProxy: 1`; `req.ip` coincide con la última dirección de `X-Forwarded-For`, y `req.ips` contiene esa dirección. |
| Cabeceras manipuladas | Una IP falsa y una cadena de dos IP falsas en `X-Forwarded-For` no alteraron `req.ip`. Tampoco lo hicieron `Forwarded` y `X-Real-IP` falsos. Los valores añadidos a la izquierda no se tomaron como identidad efectiva. |
| Restricción del diagnóstico | Administrador autenticado: 200 y `Cache-Control: no-store`; sin sesión: 401. Las pruebas del servidor verifican también el rechazo del perfil cliente (403). |
| Cierre de la comprobación | `ENABLE_NETWORK_DIAGNOSTICS=false` aplicado en Hostinger; administrador autenticado: 404. Salud: 200, `status: ok`, `database: connected`. |

El comportamiento coincide con la [documentación de Hostinger CDN sobre la IP del visitante](https://www.hostinger.com/support/hostinger-cdn-visitor-ip-addresses-in-logs-and-analytics/): el CDN agrega al final de la cabecera la dirección que se conectó a él; las entradas anteriores pueden venir del cliente. La [documentación de Express](https://expressjs.com/en/guide/behind-proxies/) explica que un salto selecciona la dirección inmediatamente anterior al socket, recorriendo la cadena desde la derecha.

Se conserva **`TRUST_PROXY=1`**, sin ampliar la confianza ni cambiar reglas de acceso. Tres direcciones repetidas en una cabecera no prueban tres saltos confiables. La evidencia descarta que estas dos redes compartan la identidad del proxy en la configuración pública comprobada; no prueba que cada persona tenga una IP exclusiva (una red compartida puede tener una salida común).

Repetir la comprobación si se añade otro CDN/proxy, cambia el alojamiento o se habilita otra ruta de entrada al servidor. No habilitar `TRUST_PROXY=true`, aumentar saltos ni confiar en subredes completas a partir de una IP privada. Mantener el diagnóstico apagado fuera de una comprobación supervisada. No se modificaron registros operativos, fotografías ni historial.

## Referencias

- https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/

La verificación del plan confirma compatibilidad, no capacidad garantizada para un volumen de usuarios aún no definido. Los recursos del plan se comparten con otros sitios.

## Estado verificado el 11/10/2026 (Guatemala)

El repositorio es privado y el despliegue automático continúa funcionando. La API de GitHub informa main sin protección; consultar su protección devuelve 403 por el plan de la cuenta. No cambiar a público para habilitarla. Hasta disponer de protección, comprobar manualmente CI del commit exacto antes de cada merge. Issue #11 reabierto con la evidencia. Hostinger no espera el resultado de CI en main.

El panel muestra respaldos diarios de MySQL. El 12/10/2026 se descargó y recuperó una copia real del proveedor en una base local aislada; tras migrarla, sus 518 registros, siete fotografías y cuatro adjuntos coinciden exactamente con el respaldo productivo de referencia. Ver [el procedimiento y la evidencia de recuperación](RECUPERACION-HOSTINGER.md). Se conservan copias privadas locales fuera de Git; no se ha configurado un destino externo para copias cifradas programadas. No se restauró sobre producción.
