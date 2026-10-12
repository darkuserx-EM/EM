# Cuentas y recuperación de acceso

Administración puede crear Cliente, Técnico, Coordinador y Administrador desde Roles y accesos. El alta predeterminada dura 90 días; administración/coordinación admite acceso sin vencimiento. Crear perfiles de gestión o gestionar su acceso exige la contraseña actual del administrador. Las altas de técnicos nuevos requieren especialidad; seleccionar un técnico existente conserva su registro.

Todas las contraseñas de alta y restablecimiento son temporales. La interfaz obliga a cambiarlas y el servidor bloquea el acceso a datos, archivos y operaciones hasta hacerlo. Solo permite consultar la sesión, cambiar contraseña o cerrar sesión. Las cuentas existentes conservan su acceso; la migración no reinicia contraseñas ni obliga a usuarios existentes a cambiarlas.

## Gestión

- Renovar agrega entre 1 y 365 días desde el vencimiento actual o desde hoy si ya venció. No reactiva cuentas revocadas.
- Reactivar devuelve acceso desde hoy y elimina sesiones antiguas. Conserva empresa, técnico, perfil y autoría.
- Restablecer exige la contraseña actual de administración, genera una nueva temporal y cierra todas las sesiones del destinatario. No renueva ni reactiva automáticamente.
- Revocar impide acceso y cierra sesiones; no borra a la persona ni sus registros.
- Un administrador no puede revocarse a sí mismo. Debe permanecer un administrador activo sin vencimiento al revocar otro o asignar vencimiento. No hay cambios de perfil ni eliminación de usuarios en este módulo.
- Los eventos de creación, renovación, reactivación, revocación, cambio y restablecimiento quedan en `em_security_events`, sin contraseñas. Los hashes nunca se entregan en la lista.

El reintento de un alta conserva su identificador y contraseña mientras sigue pendiente del primer cambio. Si esa persona ya cambió la contraseña, no se vuelve a entregar la temporal anterior. Un restablecimiento repetido invalida la temporal anterior: conserva solo la última respuesta confirmada y entrégala por un canal privado.

## Recuperación de emergencia

Usar únicamente si se perdió acceso administrativo, desde una terminal privada del servidor con sus variables `DB_*`. Conservar primero la copia MySQL y comprobar el destino. No exponer esta operación como endpoint público ni crear un usuario sin autorización.

1. Ejecutar `node scripts/recover-admin.mjs` desde el proyecto ya compilado.
2. Indicar el correo de un administrador existente y confirmar la frase exacta solicitada.
3. El script activa esa cuenta sin vencimiento, invalida sus sesiones, registra el evento y muestra una contraseña temporal una sola vez. No altera registros operativos ni crea administradores.
4. Ingresar por HTTPS y definir la contraseña propia. No copiar la temporal a GitHub, documentación ni logs compartidos.

La migración añade `must_change_password` de forma repetible y marca versión de estructura 4. Revertir a código anterior puede omitir la obligación de cambio: antes de revertir, completar los cambios pendientes o mantener dichas cuentas revocadas. No restaurar una copia antigua de los datos para revertir código. El segundo factor y la recuperación por correo quedan para cambios separados.

## Segundo factor de administración

Disponible en Mi cuenta. Requiere TOTP_ENCRYPTION_KEY: 32 bytes aleatorios codificados en base64 (generarlos fuera del registro de despliegue y guardarlos como secreto del alojamiento). No se activa automáticamente. Sin clave el acceso existente continúa; si hay cuentas enroladas, el arranque verifica el descifrado y falla cerrado ante clave ausente/incorrecta. Respaldar la clave separada del respaldo SQL; perderla impide usar TOTP. No rotarla sin una migración de recifrado.

Configuración manual en una aplicación TOTP compatible con RFC 6238 (SHA1, 6 dígitos, 30 segundos). La clave pendiente vence a los 10 minutos. Alta y baja requieren contraseña actual; la baja requiere además TOTP o recuperación. Diez códigos aleatorios se muestran una sola vez y se guardan únicamente sus hashes. La clave TOTP se cifra con AES-256-GCM ligada al usuario. Se rechaza reutilizar un intervalo TOTP; se tolera un intervalo de desfase de reloj.

La contraseña correcta entrega un desafío de cinco minutos sin sesión; máximo cinco fallos por desafío y ocho intentos por cuenta en quince minutos, persistidos en SQL, además del límite por IP. Cambiar contraseña invalida desafíos anteriores. Activar/desactivar revoca otras sesiones. Los eventos no guardan secretos. El segundo factor está disponible para administradores; no obliga a las cuentas existentes a enrolarse.

Pérdida del teléfono: usar un código de recuperación y configurar de nuevo. Emergencia sin códigos: en terminal privada del servidor ejecutar scripts/recover-admin.mjs --reset-mfa, confirmar la cuenta y DESACTIVAR 2FA. Conserva el historial, revoca sesiones y desafíos y exige cambiar contraseña temporal. Esta vía requiere acceso al alojamiento y deja evento; no se ejecutó en producción durante la revisión.
