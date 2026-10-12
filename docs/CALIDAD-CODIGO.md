# Verificación automática de código

CI ejecuta lint, typecheck, pruebas de aplicación/servidor, integración MySQL y compilación. ESLint revisa src, server y scripts con reglas de errores recomendadas; no altera formato ni diseño. Los generados y dependencias se excluyen. Las expresiones que rechazan caracteres de control se permiten explícitamente, y las variables descartadas se nombran con prefijo _. No se desactiva no-undef en JavaScript.

TypeScript verifica la aplicación con tsc -b. checkJs estricto comienza en security.mjs, totp.mjs y session-policy.mjs, con contratos JSDoc, sin any ni ts-nocheck. Las rutas Express, persistencia y respaldos siguen cubiertos por lint y pruebas de integración, pero aún no por checkJs estricto; M8 queda parcial. Extender módulo por módulo a esos archivos con tipos concretos de peticiones y consultas SQL. No añadir casts masivos para simular cobertura.

No se reformatea todo el repositorio ni se introduce Prettier en esta corrección: produciría diffs extensos ajenos a los fallos y dificultaría revisar seguridad. Las dependencias de desarrollo de ESLint quedan fijadas por lockfile.
