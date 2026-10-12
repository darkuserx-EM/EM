# Verificación automática de código

CI ejecuta lint, typecheck, pruebas de aplicación/servidor, integración MySQL y compilación. ESLint revisa src, server y scripts con reglas de errores recomendadas; no altera formato ni diseño. Los generados y dependencias se excluyen. Las expresiones que rechazan caracteres de control se permiten explícitamente, y las variables descartadas se nombran con prefijo _. No se desactiva no-undef en JavaScript.

TypeScript verifica la aplicación con tsc -b. checkJs estricto comienza en security.mjs, totp.mjs y session-policy.mjs, con contratos JSDoc, sin any ni ts-nocheck. Las rutas Express, persistencia y respaldos siguen cubiertos por lint y pruebas de integración, pero aún no por checkJs estricto; M8 queda parcial. Extender módulo por módulo a esos archivos con tipos concretos de peticiones y consultas SQL. No añadir casts masivos para simular cobertura.

No se reformatea todo el repositorio ni se introduce Prettier en esta corrección: produciría diffs extensos ajenos a los fallos y dificultaría revisar seguridad. Las dependencias de desarrollo de ESLint quedan fijadas por lockfile.

## Issue #70 · etapa 1: contratos SQL y archivo histórico

`checkJs` estricto incluye el adaptador SQL, la migración y escritura de bitácora y los lotes de adjuntos. Las consultas declaran sus columnas; el índice permisivo de `RowDataPacket` no se propaga al consumidor. Los escritores de auditoría y los lectores de respaldos exigen una conexión transaccional. No cambia el orden de bloqueos, commits, comparación de originales ni límites de memoria.

`server/type-tests/persistence.mts` comprueba contratos negativos durante `typecheck`: columnas no seleccionadas, parámetros SQL no serializables, pool usado como transacción, payload y binarios incorrectos y tipos del cursor. Las expectativas solo existen en estas pruebas, nunca para silenciar errores de producción. La integración comprueba además migración interrumpida, identidad conflictiva, 25,000 movimientos y recuperación íntegra. Las rutas restantes aún no se declaran completamente tipadas.
