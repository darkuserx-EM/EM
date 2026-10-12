# Seguimiento de auditorías · 11/10/2026

Cambios separados por PR, CI y comprobación de producción. Se preservan contratos pendientes y los datos reales no forman parte del repositorio.

| IDs | Aplicación y evidencia |
|---|---|
| A1, M3, M4 | #59: fotografías separadas, miniaturas, autorización de cada descarga, exportación sin binarios, respaldo completo y recuperación ensayada. Se conserva evidencia retirada y se revalida caché privada. #19 sigue abierto para cuota, retención y recuperación del proveedor. |
| A2, B9 | #60: Administrador/Coordinador, vigencia, renovar/reactivar/revocar/restablecer, contraseña temporal obligatoria, último administrador protegido, especialidad requerida y recuperación en terminal. Probado con cuentas sintéticas; cuentas reales sin cambios. |
| M1 | #61: control por registro en Ticket, OrdenServicio y LecturaHorometro; misma fila aún rechaza edición desactualizada. #20 conserva el pendiente estructural. |
| M9, B1–B4 | #62: carga diferida de Inicio/Flota/Administración, estado real de sincronización, errores según modo, demo no publicada y fechas de respaldo de Guatemala. Excel ya era diferido. |
| M2, B10 | #63: bitácora bajo demanda y eventos de seguridad paginados. Sincronización no transporta historial; respaldo lo conserva. Prueba de los 92 movimientos existentes sin pérdidas. |
| M6a | #64: cookie __Host- en producción y 60 minutos de inactividad, límite absoluto ocho horas. Sondeo no renueva; interacción real sí. Migración de cookie anterior conserva vencimiento. |
| M6b | #65: segundo factor TOTP opcional, cifrado, recuperación y límites persistentes. Probado con vectores RFC y MySQL/MariaDB. Publicado, todavía sin clave de alojamiento ni usuarios reales enrolados. |
| M8 | #66: ESLint y tipos de aplicación exigidos por pnpm test, por tanto en CI. checkJs estricto en tres módulos de seguridad; rutas y persistencia quedan pendientes. Pruebas negativas verificadas y retiradas. No se reformatea el repositorio. |
| A3 | Repo privado confirmado. main sin protección y API rechaza habilitarla por el plan GitHub. #11 reabierto. No cambiar privacidad; revisión manual de CI del commit exacto. |
| A4, B5, B7, B8 | Documentos actualizados: repo privado, conservar diseño aprobado, límites por proceso versus login persistente, tarball oficial SheetJS fijado con integridad. |
| B6 | No eliminar ramas solo por antigüedad: pueden contener trabajo del usuario. Se eliminan únicamente las ramas de PR propios integrados. |
| M5 | Respaldo previo privado; ensayo de migración/exportación/restauración con comparación de todos los registros y bytes en base aislada. Panel muestra copias diarias. Pendiente verificar retención, restauración del proveedor y destino externo aprobado. |
| M7 | #4 pendiente: no se ha contrastado la IP desde dos redes independientes. No modificar confianza del proxy con evidencia insuficiente. |
| SQL-01–08 | Ver AUDITORIA-SQL-2026-10-11.md: índices reales, respaldo limitado por bytes y carga de adjuntos sin instantánea completa; sin borrado de evidencias ni promesas basadas en simulaciones. |

## Incidencias de validación

Una ejecución local de una prueba Excel excedió su límite de cinco segundos con carga paralela; la suite completa volvió a pasar sin cambiar el límite ni omitir pruebas. GitHub rechazó modificar workflows por falta de alcance workflow en la credencial; los controles nuevos se incluyeron en el comando test que ejecuta el workflow vigente, sin cambiar permisos.

No se probaron cambios destructivos de cuenta, segundo factor ni restauraciones sobre usuarios/registros reales. Se comprobaron en bases efímeras y en línea se revisaron salud, sesión, consultas, permisos de descarga y conservación de datos.

## Revisión de documentos recibidos el 12/10/2026

Los tres adjuntos (auditoría v0.3, problemas y soluciones, y revisión de código)
son idénticos byte a byte a los revisados anteriormente. Se contrastaron con las
correcciones publicadas; no se repiten migraciones ni se aplican los prompts del
documento como instrucciones independientes.

#72 separa la bitácora físicamente, con migración reanudable y respaldo compatible.
La segunda etapa de #20 incorpora validación incremental sobre una base comprobada
por revisión. Ver `ISSUE-20-PERSISTENCIA.md` para pruebas, límites y pendientes.
Los asuntos de cuota/recuperación del proveedor (#19), proxy (#4), protección de
main (#11), tipado restante (#70) y activación real de TOTP (#71) conservan su
seguimiento. No se activan cuentas reales ni se cambian opciones del alojamiento
sin los datos específicos que requieren esas verificaciones.
