# Verificación automática de código

CI ejecuta lint, typecheck, pruebas de aplicación/servidor, integración MySQL y compilación. ESLint revisa src, server y scripts con reglas de errores recomendadas; no altera formato ni diseño. Los generados y dependencias se excluyen. Las expresiones que rechazan caracteres de control se permiten explícitamente, y las variables descartadas se nombran con prefijo _. No se desactiva no-undef en JavaScript.

TypeScript verifica la aplicación con tsc -b y todo el servidor de producción con checkJs estricto: rutas Express, persistencia, migraciones, archivos, respaldos, autenticación, mantenimiento y entrada del proceso. El dominio compartido conserva su fuente TypeScript. Los contratos JSDoc y las declaraciones se comprueban sin any explícito, ts-nocheck, ts-ignore ni conversiones masivas. Las excepciones esperadas solo existen en pruebas negativas de compilación.

No se reformatea todo el repositorio ni se introduce Prettier en esta corrección: produciría diffs extensos ajenos a los fallos y dificultaría revisar seguridad. Las dependencias de desarrollo de ESLint quedan fijadas por lockfile.

## Issue #70 · etapa 1: contratos SQL y archivo histórico

`checkJs` estricto incluye el adaptador SQL, la migración y escritura de bitácora y los lotes de adjuntos. Las consultas declaran sus columnas; el índice permisivo de `RowDataPacket` no se propaga al consumidor. Los escritores de auditoría y los lectores de respaldos exigen una conexión transaccional. No cambia el orden de bloqueos, commits, comparación de originales ni límites de memoria.

`server/type-tests/persistence.mts` comprueba contratos negativos durante `typecheck`: columnas no seleccionadas, parámetros SQL no serializables, pool usado como transacción, payload y binarios incorrectos y tipos del cursor. Las expectativas solo existen en estas pruebas, nunca para silenciar errores de producción. La integración comprueba además migración interrumpida, identidad conflictiva, 25,000 movimientos y recuperación íntegra. Las rutas restantes aún no se declaran completamente tipadas.

## Issue #70 · etapa 2: persistencia y caché

Se incluyen la conexión y migraciones de base de datos, planes de escritura, proyección operativa, caché de snapshots, presentación de imágenes y diagnóstico seguro de errores. Los comandos de escritura forman una unión discriminada; no se puede ejecutar un plan en un pool en lugar de su conexión transaccional. Los errores capturados son `unknown` y sus propiedades se estrechan antes de utilizarlas.

La declaración de `generated/domain.mjs` se genera desde `server/domain.ts`, la misma entrada TypeScript que compila esbuild. No duplica contratos a mano ni inspecciona JavaScript generado como si fuera fuente mantenible. `typecheck` genera primero ese puente y usa resolución Bundler, igual que el dominio compartido. Las fuentes `.mjs` mantienen extensiones explícitas para Node. `server/type-tests/database.mts` añade once contratos negativos; el comportamiento de caché, CAS, rollback y migraciones sigue cubierto por integración.

## Issue #70 · etapa 3: archivos y respaldos

Fotografías, adjuntos, recuperación y respaldo completo se comprueban con tipos de Express y mysql2. Se distinguen los metadatos públicos de los de recuperación, las cargas pendientes de las fotografías guardadas y los bytes `Buffer` de su transporte base64. El archivo de respaldo tiene una unión discriminada por tipo de entrada. Las respuestas de carga y recuperación tienen contratos explícitos.

Las validaciones existentes estrechan los valores antes de persistirlos; se construyen los metadatos a partir de los campos comprobados y no mediante conversiones de tipo. Se mantiene la verificación de tamaño/huella, la identidad, autoría, fecha original, control de acceso y transmisión con contrapresión. `@types/express` es exclusivamente de desarrollo. Diez contratos negativos adicionales cubren estos límites, además de las pruebas HTTP y de recuperación contra MariaDB/MySQL.

## Issue #70 · etapa 4: cobertura completa

La configuración incluye recursivamente los módulos del servidor, en lugar de enumerar unas pocas utilidades. Comprueba también los archivos de contratos (`skipLibCheck: false`). Se excluyen los artefactos generados y las pruebas de ejecución; los contratos negativos `.mts` sí se compilan y nunca se ejecutan ni publican como rutas.

Las consultas declaran columnas concretas de cuentas, sesiones, segundo factor, eventos e índices. Las mutaciones son una unión por acción y distinguen registros de resultados de importación. Los cuerpos de petición, respuestas, cursores y errores dejan de propagarse como valores sin tipo. El contexto de permisos compartido expresa las dos colecciones que realmente lee, sin cambiar su filtrado.

`scripts/check-server-types.mjs`, incluido en `typecheck` y por tanto en CI, verifica que los 28 módulos/contratos de producción entren en la comprobación, que no se desactive la revisión y que ningún acceso a un cuerpo de petición conserve el `any` predeterminado de Express. Añadir un módulo bajo `server/` lo incorpora automáticamente. Las pruebas negativas cubren cada grupo de módulos y se comprobó adicionalmente que una asignación incompatible y una ruta con cuerpo sin tipo hacen fallar el proceso; los dos archivos de prueba temporal se retiraron.

Validación de cada etapa: aplicación, servidor, integración con MariaDB local y MySQL en CI, compilación y comprobación de producción. Se mantienen autenticación, roles, CSRF, vencimiento, TOTP, archivos, respaldo, rollback y concurrencia; no se cambian el esquema SQL ni los datos de clientes. La cobertura estricta no sustituye la validación de entrada ni las pruebas de integración.
