# Portal EM · Base y pruebas en línea

Base navegable para Expertos en Montacargas, S.A. (EMSA). Versión 0.2: prototipo local y primera conexión con servidor Node.js/MySQL para pruebas. Incluye cuenta inicial de administración, sesiones y persistencia compartida de clientes, contactos, sedes, equipos y catálogos. Publicado para pruebas en https://portal.expertosenmontacargas.com. El 04/10/2026 se verificaron HTTPS, acceso, escritura/importación en MySQL, sesiones independientes y persistencia tras reiniciar.

## Trabajar desde GitHub

Repositorio: https://github.com/darkuserx-EM/EM

```sh
git clone https://github.com/darkuserx-EM/EM.git
cd EM
git switch -c cambio/nombre-del-cambio
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Antes de subir cambios, ejecuta `corepack pnpm test` y `corepack pnpm build`. Guarda el trabajo en tu rama y abre una solicitud de cambios hacia `main` para revisarlo. El repositorio es público: contiene código, documentación y una plantilla vacía de clientes. Los reportes reales, archivos de clientes, respaldos y credenciales deben conservarse fuera del repositorio. El despliegue en Hostinger se configura por separado.

## Iniciar

Requiere Node.js 24 o superior. Dependencias fijadas en `pnpm-lock.yaml`. La configuración TypeScript se carga de forma nativa para evitar búsquedas innecesarias fuera del proyecto en entornos restringidos.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Si no usas Corepack, instala pnpm y ejecuta `pnpm install --frozen-lockfile` y `pnpm dev`. También se puede usar `npm install` y `npm run dev`, aunque el archivo de bloqueo de esta entrega es de pnpm.

```sh
pnpm test
pnpm build
pnpm preview
```

El desarrollo utiliza http://127.0.0.1:5173. La compilación genera `dist/`. `pnpm dev` vuelve a compilar automáticamente al guardar; recarga el navegador para ver los cambios. Este modo evita una limitación del escaneo nativo de dependencias en entornos Windows restringidos. En una estación sin esa restricción se puede usar `pnpm dev:hmr` para la recarga instantánea de Vite.

## Qué incluye

- Identidad Stone Light del portal interno, navegación adaptable y vista oscura EMSA para cliente y operador.
- Solo en la demostración local, selector de seis usuarios ficticios: administración, coordinación, tres técnicos y un cliente. El operador no tiene cuenta.
- Catálogos con altas, edición, activación/desactivación, búsqueda, filtros y bitácora.
- Plantilla Excel con instrucciones, vista previa validada, alta o actualización por ID y exportación que respeta los filtros.
- Respaldo de las 20 entidades en un libro Excel y restauración validada. Se descarga una copia del estado anterior antes de restaurar.
- Solo en la demostración local, muestra de 6 clientes, 25 equipos y 3 técnicos; consulta y exportación de flota y clientes. La gestión completa se construye en sus etapas.
- Captura web administrativa: Nuevo cliente y Nuevo equipo; edición desde sus fichas. Clientes incluye NIT, datos de facturación y atención, contactos y sedes. Equipos incluye asignación a cliente/sede y especificaciones. Los códigos CLI/TCL/TCE son automáticos y cada cambio queda en bitácora.
- Clientes usa una lista con ficha lateral, búsqueda y filtro por estado. Sus secciones Resumen, Equipos, Contactos y Sedes permiten consultar y editar sin abandonar el directorio. En móvil la ficha aparece debajo de la lista.
- Ficha de equipo con reparaciones, diagnósticos, trabajos, repuestos y mano de obra; historial de horómetros con gráfica, filtros por fecha y exportación del expediente. Importes internos solo para administración.
- Importación administrativa de clientes desde Excel, con contactos y sedes opcionales vinculados por referencia_cliente. Incluye plantilla, vista previa por hoja/fila, rechazo de duplicados y guardado completo o ninguno. Importar y exportar quedan restringidos a Administración, tanto en botones como en repositorios.
- Plan visible de 10 etapas y espacios reservados para los módulos siguientes.
- Repositorios asíncronos, tipos TypeScript, validación central y adaptador local; preparados para agregar otro proveedor.

## Probar la demostración local

1. En Catálogos, crea una marca ficticia, edítala y recarga. Comprueba que sigue ahí.
2. Filtra opciones y expórtalas. El Excel solo incluye la selección filtrada.
3. Descarga la plantilla desde Importar Excel. Prueba una fila válida y otra duplicada: la confirmación permanece bloqueada si hay errores.
4. Descarga un respaldo completo, realiza un cambio y restaura el archivo previo. Revisa la bitácora y la copia previa descargada.
5. Cambia de usuario con el botón superior derecho. Coordinación no ve configuración; técnicos ven sus espacios; el cliente ve únicamente su empresa de muestra.
6. Revisa a 390 px y en escritorio. El menú móvil se abre con el botón superior izquierdo.
7. En Flota, abre un equipo. Revisa Reparaciones y servicios y Uso y horómetro; filtra fechas y exporta. El uso corresponde a la diferencia entre las lecturas seleccionadas, separado de las horas del técnico.
8. Como Administrador, abre Clientes → Nuevo cliente. Guarda nombre y estado; luego agrega un contacto y una sede desde su ficha. En Nuevo equipo registra identificación y horómetro, y selecciona cliente/sede. Guarda, edita un dato y recarga para verificar persistencia.
9. Como Administrador, abre Clientes → Importar clientes. Descarga la plantilla, completa tres o cuatro filas en Cliente, selecciona el Excel, revisa la vista previa y confirma. Contacto y Sede son opcionales. Para actualizar registros, conserva el id de una exportación; sin id se intenta una nueva alta. Los duplicados por referencia, nombre o NIT se rechazan. Al cambiar a Coordinador desaparecen los botones de plantilla, importación, exportación, alta y edición.

## Estructura

```text
src/
  app/          Rutas, sesión de demostración, consultas y avisos
  components/   Navegación y elementos visuales compartidos
  domain/       Entidades, permisos, validación y formatos
  data/         Adaptador local, repositorios, Excel y muestra
  features/     Inicio, catálogos, respaldos, módulos, roles y portal
public/         Favicon y reglas para distribución estática
docs/           Arquitectura, alcance y despliegue
```

## Pruebas con conexión compartida

El modo en línea usa servidor y cuenta autenticada; no muestra el selector de roles. Consulta `docs/BASE-DE-DATOS.md` para el esquema inicial, configuración, límites y pruebas pendientes. El modo local en localhost conserva la demostración anterior. Para forzar el servidor en desarrollo usa VITE_DATA_MODE=server.

## Alcance y límites de la demostración local

El selector de usuario **no es autenticación**. El filtrado local demuestra la experiencia de uso, pero no protege información frente a alguien con acceso al navegador. Los dispositivos no comparten datos. No introducir datos reales, contraseñas ni claves privadas.

El respaldo incluye datos tabulares y el logo compacto del cliente. Aún no incluye fotografías de trabajos, firmas ni otros archivos adjuntos; necesitarán almacenamiento y respaldo propios.

Los identificadores son estables y los correlativos se calculan desde los registros existentes. El servidor MySQL aplica transacciones y control de revisión compartida; esas garantías no se extienden al adaptador local. El modo local detecta revisiones cambiadas entre pestañas, pero no ofrece una base de datos multiusuario.

No hay envío de correo/WhatsApp, firmas, PDF, tickets operativos ni formularios de checklist en esta entrega. Las pantallas los identifican como etapas pendientes. La interfaz no inventa valores de SLA, tarifas ni reglas de facturación.

La captura web y la importación de clientes adelantan una parte de las etapas 2 y 3, sin completar contratos, documentos, PM ni importación masiva de equipos. Coordinación dispone de consulta; las altas, ediciones, importaciones y exportaciones se habilitan para Administración. El horómetro inicial genera una lectura de ingreso del registro. Las siguientes lecturas y correcciones se implementarán en su flujo; la ficha no cambia el horómetro ni la propiedad ya registrados.

## Permisos y hosting revisados

El 04/10/2026 se verificó en hPanel: Business Web Hosting, 200 GB de almacenamiento, 3 GB de RAM, 2 núcleos de CPU, soporte React/Vite/Node.js, gestión MySQL, dominio expertosenmontacargas.com y opción de subdominios. El panel indicaba copias diarias y vencimiento del hosting el 11/09/2027. Estos son recursos del plan compartido entre sus sitios, no recursos exclusivos del portal.

Se autorizó la creación local del proyecto y la descarga de dependencias. El usuario autorizó posteriormente publicar un entorno de pruebas independiente en Hostinger. Se creó la aplicación Node.js, la base dedicada y la cuenta de administración de pruebas. WordPress continúa en el dominio comercial. El resultado de despliegue se documenta en docs/HOSTINGER.md.

Ver `docs/ARQUITECTURA.md` y `docs/HOSTINGER.md`.
