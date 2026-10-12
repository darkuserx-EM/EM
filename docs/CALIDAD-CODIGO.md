# Verificación automática de código

CI ejecuta lint, typecheck, pruebas de aplicación/servidor, integración MySQL y compilación. ESLint revisa src, server y scripts con reglas de errores recomendadas; no altera formato ni diseño. Los generados y dependencias se excluyen. Las expresiones que rechazan caracteres de control se permiten explícitamente, y las variables descartadas se nombran con prefijo _. No se desactiva no-undef en JavaScript.

TypeScript verifica la aplicación con tsc -b. checkJs estricto comienza en security.mjs, totp.mjs y session-policy.mjs, con contratos JSDoc, sin any ni ts-nocheck. Las rutas Express, persistencia y respaldos siguen cubiertos por lint y pruebas de integración, pero aún no por checkJs estricto; M8 queda parcial. Extender módulo por módulo a esos archivos con tipos concretos de peticiones y consultas SQL. No añadir casts masivos para simular cobertura.

No se reformatea todo el repositorio ni se introduce Prettier en esta corrección: produciría diffs extensos ajenos a los fallos y dificultaría revisar seguridad. Las dependencias de desarrollo de ESLint quedan fijadas por lockfile.

## Issue #70 · etapa 1: contratos SQL y archivo histórico

`checkJs` estricto incluye el adaptador SQL, la migración y escritura de bitácora y los lotes de adjuntos. Las consultas declaran sus columnas; el índice permisivo de `RowDataPacket` no se propaga al consumidor. Los escritores de auditoría y los lectores de respaldos exigen una conexión transaccional. No cambia el orden de bloqueos, commits, comparación de originales ni límites de memoria.

`server/type-tests/persistence.mts` comprueba contratos negativos durante `typecheck`: columnas no seleccionadas, parámetros SQL no serializables, pool usado como transacción, payload y binarios incorrectos y tipos del cursor. Las expectativas solo existen en estas pruebas, nunca para silenciar errores de producción. La integración comprueba además migración interrumpida, identidad conflictiva, 25,000 movimientos y recuperación íntegra. Las rutas restantes aún no se declaran completamente tipadas.

## Issue #70 · etapa 2: persistencia y caché

Se incluyen la conexión y migraciones de base de datos, planes de escritura, proyección operativa, caché de snapshots, presentación de imágenes y diagnóstico seguro de errores. Los comandos de escritura forman una unión discriminada; no se puede ejecutar un plan en un pool en lugar de su conexión transaccional. Los errores capturados son `unknown` y sus propiedades se estrechan antes de utilizarlas.

La declaración de `generated/domain.mjs` se genera desde `server/domain.ts`, la misma entrada TypeScript que compila esbuild. No duplica contratos a mano ni inspecciona JavaScript generado como si fuera fuente mantenible. `typecheck` genera primero ese puente y usa resolución Bundler, igual que el dominio compartido. Las fuentes `.mjs` mantienen extensiones explícitas para Node. `server/type-tests/database.mts` añade once contratos negativos; el comportamiento de caché, CAS, rollback y migraciones sigue cubierto por integración.
