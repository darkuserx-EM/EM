# Publicación prevista en Hostinger

Se verificó compatibilidad en hPanel el 04/10/2026. Todavía no se ha desplegado este proyecto ni creado un subdominio o base de datos.

## Demostración estática

- Dirección propuesta: portal.expertosenmontacargas.com, pendiente de configuración y comprobación de DNS/HTTPS.
- Compilar con Node.js 24: instalar dependencias y ejecutar `pnpm build`.
- En Web Apps, elegir un proyecto React/Vite, con directorio de salida `dist` y comando de compilación correspondiente al gestor de paquetes elegido.
- Si se aloja como sitio HTML estático, publicar el contenido de dist en el directorio del sitio destinado al portal. La regla .htaccess incluida permite recargar rutas de React Router en Apache/LiteSpeed.
- Comprobar rutas directas, HTTPS, fuentes, descarga de Excel y comportamiento en móvil.
- Crear un destino independiente para el portal. No subir estos archivos sobre el public_html de WordPress existente.

## Operación real, en una entrega posterior

Configurar una aplicación Node.js y una base MySQL propia del portal. Autorizar consultas por sesión y empresa en el servidor. Añadir almacenamiento persistente para adjuntos, copias comprobadas y restauración. Si se usa el almacenamiento de archivos del hosting, comprobar su conservación en nuevos despliegues y su inclusión en respaldos.

Los correos automáticos, WhatsApp y procesos programados necesitan configuración adicional; no están implementados ni contratados en esta entrega. No se requiere instalar WordPress ni adquirir un constructor de sitios para ejecutar este proyecto.

## Referencias

- https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/

La verificación del plan confirma compatibilidad, no capacidad garantizada para un volumen de usuarios aún no definido. Los recursos del plan se comparten con otros sitios.
