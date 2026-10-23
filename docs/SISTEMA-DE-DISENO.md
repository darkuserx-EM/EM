# Sistema de diseño · paso 0

Los valores comunes de diseño (tokens) viven en `src/design/tokens.css`, que se importa antes que `styles.css`. La base es la pantalla de Mantenimiento, que cumple contraste AA y tamaño mínimo de 12 px.

## Reglas para código nuevo

- **Color:** usar `var(--color-*)`. No escribir colores hexadecimales en los componentes.
  - El naranja `--color-brand` es solo decorativo (contraste 2.6:1). Para texto o enlaces naranjas, usar `--color-brand-text`.
- **Texto:** `--text-xs` (12 px) es el mínimo. Cuerpo y tablas en `--text-md` (14 px).
- **Espaciado:** múltiplos de 4 (`--space-1` … `--space-12`).
- **Radios:** `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-full`.
- **Breakpoints:** 600 · 900 · 1200 · 1600 px.
- **Foco y táctil:** `--focus-ring` en todos los controles. `--target-min` (44 px) en pantallas táctiles.

## Variables anteriores

Las variables existentes se conservan y apuntan a los tokens para no romper estilos:

| Variable | Token | Cambio visible |
|---|---|---|
| `--paper`, `--white` | `--color-bg`, `--color-surface` | Ninguno |
| `--ink` | `--color-text` (`#273328`) | Antes `#1a1a1a`: casi igual |
| `--muted` | `--color-text-muted` (`#59634f`) | **Antes `#797c73` (3.83:1 sobre el fondo, no cumplía AA); ahora 5.7:1** |
| `--line` | `--color-border` | Gris un poco más verdoso |
| `--orange` | `--color-brand` | Ninguno |
| `--home-ink`, `--home-muted`, `--home-line`, `--home-accent`, `--home-soft` | Tokens equivalentes | Textos secundarios de Inicio más legibles (`--home-muted` era `#6c7568`) |
| `--file-line`, `--file-muted` | `--color-border`, `--color-text-muted` | Mínimo |
| `--dashboard-ink`, `--dashboard-muted` | `--color-text`, `--color-text-muted` | Secundario algo más oscuro |

No usar las variables anteriores en código nuevo. Se retirarán al migrar cada pantalla.

## Paso 1 · Base global (`src/design/base.css`)

Capa cargada **después** de `styles.css`. Fija con tokens la tipografía, el color, los bordes de los campos y el foco de los componentes compartidos:
- menú lateral y barra superior;
- encabezado de página (`SectionTitle`), paneles y botones;
- campos, búsqueda, tablas y etiquetas de estado (`.status`);
- ventanas, avisos y estados vacíos.

No cambia anchos, rellenos ni rejillas. En móvil reemplaza las reducciones a 8–11 px de `styles.css`. Los tonos de `.status` se definen solo aquí.

Las declaraciones equivalentes de `styles.css` quedan anuladas por orden y se retirarán al migrar cada pantalla. Los archivos de cada pantalla pueden seguir ajustando estos componentes, pero no por debajo de `--text-xs`.

## Paso 2 · Órdenes y solicitudes (`operations.css`)

Todos los colores y tamaños de Órdenes, del formulario de 5 pasos, del reporte, de Solicitudes y de los estados de operación usan tokens. Se conservan la distribución, las reglas de móvil y la impresión del reporte.

Además, `.table-scroll` tiene `position: relative` en `base.css`. Los textos `.sr-only` de las cabeceras se escapaban del desplazamiento y ensanchaban toda la página en móvil (Órdenes medía 550 px en una pantalla de 375).

## Paso 3 · Calendario y planificador (`planning.css`)

Todos los colores y tamaños de las vistas anual, mensual y semanal, del tablero del planificador y de las ventanas de detalle y programación usan tokens. Se conservan las rejillas, los anchos de columna y las reglas de móvil.

- **Tipos de evento:** cita en verde (`--color-accent`) y vencimiento o proyección en naranja (`--color-brand-text`). Los puntos de la leyenda y del calendario anual alcanzan 3:1 sobre blanco.
- **Estados del tablero:** el punto de cada columna usa el color semántico del estado (programada = información, en espera = advertencia, completada = éxito).
- **Indicadores:** el filtro activo (`aria-pressed`) se marca con `--color-accent-soft`, también en el planificador.
- **Título del mes:** solo la primera letra en mayúscula («Octubre de 2026»). Antes `text-transform: capitalize` mostraba «Octubre De 2026».
- **Eventos compactos** de la vista mensual: con 12 px se recortan antes. El texto completo sigue en el título emergente y en el detalle del día.

## Paso 4 · Flota y clientes

- Reescritos con tokens: `equipment-status.css`, `client-directory.css`, `equipment-form.css`, `equipment-images.css` y `equipment-specifications.css`.
- `records.css` (nuevo, importado en `RecordsPage`) reemplaza con tokens las reglas de Flota y del formulario de registros que siguen en `styles.css`. No se edita `styles.css` para evitar conflictos.
- `base.css`: `.field-help` y la vista previa de importación con tokens; en móvil, los botones de importación ya no bajan a 9 px.
- **Corrección del paso 1:** `base.css` había dejado en 14 px los campos de formulario en móvil. Vuelven a 16 px para evitar el zoom automático de iOS.

## Paso 5 · Ficha del equipo

- Los 8 archivos de la ficha (`equipment-dashboard`, `equipment-file`, `equipment-findings`, `equipment-layout-designer`, `equipment-planning`, `equipment-summary`, `imported-history`, `monthly-usage`) pasan de 286 usos de colores fijos a tokens, y sus 63 tamaños de letra menores de 12 px pasan a `--text-xs` como mínimo. Se conservan la estructura y el orden de las reglas: solo cambian los valores.
- Equivalencias por tipo de propiedad y tono: texto oscuro → `--color-text`; texto secundario → `--color-text-muted`; verdes de acción → `--color-accent`; ámbar y rojo → `--color-warning-*` y `--color-danger-*`; fondos claros → `--color-surface*` o `--color-accent-soft`; bordes → `--color-border` o `--color-border-strong`; contornos de foco → `--color-focus`.
- **Token nuevo `--color-warning-solid`** (`#a6752d`, de Mantenimiento): barras y líneas de gráfico en ámbar (estimado, por vencer). `--color-warning-text` es demasiado oscuro para una barra.
- `equipment-file.css` completa los textos del historial (Reparaciones y Uso) que `styles.css` dejaba bajo AA.

## Paso 6 · Inicio y Reportes

- `home.css`, `admin-home.css` y `operational.css` pasan a tokens con las mismas equivalencias del paso 5: quedan 0 colores fijos y ningún tamaño menor de 12 px.
- El botón principal de Inicio («Nueva orden») usa `--color-brand-text` (5.7:1 con texto blanco). Al pasar el cursor se oscurece con `color-mix()`, sin color fijo.
- El resalte naranja de las barras al pasar el cursor usa `--color-brand`, que es decorativo.
- `base.css`: `small` sin tamaño propio mantiene su proporción (`.83em`) con mínimo de 12 px. Antes el navegador lo dejaba en 10–11 px; pasaba en los indicadores de Reportes y en «Planes de esta semana».

## Paso 7 · Administración

- `src/features/settings/admin.css` (nueva, importada en `Settings.tsx`, que va en el paquete principal) reemplaza con tokens las reglas de `styles.css` de Catálogos, Datos (incluida la importación del historial), Accesos, Plan de trabajo, módulos próximos y «Mi cuenta». No se edita `styles.css`.
- `.text-green` y `.text-red` pasan a `--color-success-text` y `--color-danger-text`. En el Plan de trabajo, el estado «Disponible para validación» vuelve a verse en verde: antes `.roadmap-status` lo dejaba gris.
- Los íconos grandes de Datos y del Plan (`.large-icon.green/blue/amber`) usan los pares semánticos de fondo y texto.
- La ilustración de los módulos próximos (ícono y número de etapa) es `aria-hidden`: repite «Etapa N» y es decorativa.

## Paso 8 · Portal del cliente

- `client-portal.css` y `client-shell.css` pasan a tokens con las equivalencias del paso 5 (0 colores fijos; mínimo 12 px). En `client-shell.css` se retiran las variables antiguas (`--ink`, `--paper`).
- **Vista del operador** (`/revision/TCL-001`, la única pantalla oscura): sobre fondo casi negro, la etiqueta superior usa `--color-brand` (7.4:1) y el texto secundario `color-mix(in srgb, var(--color-text-inverse) 65%, transparent)`. Los tokens de texto están pensados para superficies claras.
- `base.css`: la letra del espacio de trabajo en el menú lateral (`.workspace-symbol`) usa `--color-text-muted`; antes tenía 3.39:1.

Con este paso todas las pantallas usan tokens. Lo único que queda bajo 12 px es el subtítulo del logotipo, exento por ser parte de la marca.

## Siguientes pasos

1. ~~Base global~~ (paso 1, `base.css`).
2. **Por pantalla:** ~~Órdenes~~ (paso 2) → ~~Calendario y planificador~~ (paso 3) → ~~Flota y clientes~~ (paso 4) → ~~ficha del equipo~~ (paso 5) → ~~Inicio~~ (paso 6) → ~~administración~~ (paso 7) → ~~portal del cliente~~ (paso 8).
3. ~~**Componentes compartidos**~~: `src/components/design-system.tsx` (ver «Componentes»).
4. ~~**Control en CI**~~: revisión automática en `src/design/design-tokens.test.ts` (ver abajo).

## Componentes

`src/components/design-system.tsx` reúne los componentes compartidos. Reutilizan las clases existentes (`.button`, `.status`, `.panel`, `.record-field`) con tokens en `base.css`, así que migrar una pantalla no cambia su aspecto. **Pantallas nuevas: usar estos componentes, no clases sueltas.** Al editar una pantalla existente, migrar lo que se toque.

| Componente | Uso | Notas |
|---|---|---|
| `Button` | `<Button variant="primary" icon={<Plus size={16} />}>Nueva orden</Button>` | Variantes `secondary` (por defecto), `primary` y `danger`; `size="sm"`. Es `type="button"` por defecto: para enviar un formulario, `type="submit"` explícito. |
| `ButtonLink` | `<ButtonLink to="/plan">Ver plan</ButtonLink>` | Enlace interno (react-router) con aspecto de botón. Mismas variantes. |
| `IconButton` | `<IconButton label="Editar TCL-001" icon={<Pencil size={15} />} onClick={…} />` | `label` es obligatoria: se usa como `aria-label` y texto emergente. |
| `Badge` | `<Badge tone="warning">Por vencer</Badge>` | **Única etiqueta de estado del portal.** Tono según el significado: `success` listo o al día, `info` programado o en curso, `warning` en espera, en revisión o por vencer, `danger` vencido o fuera de servicio, `neutral` sin estado o dato informativo. `Status` (equipos y clientes) lo usa con `statusTone(valor)`, `OperationStatus` (órdenes y solicitudes) con `operationTone(estado)` y `PlanStatus` (planes de mantenimiento) con el tono del plan. Reemplaza a `.os-status`, `.pm-status`, `.review-pill`, `.plain-tag` y `.roadmap-status`. |
| `Panel` | `<Panel title="Servicios" description="Por mes" actions={…}>…</Panel>` | El encabezado aparece solo si hay título o acciones. |
| `Field` | `<Field label="Marca" required help="…" error={error}>{control => <input {...control} value={marca} onChange={…} />}</Field>` | Vincula etiqueta, ayuda y error con el control (`id`, `aria-describedby`, `aria-invalid`). Con error, el campo toma borde rojo. |
| `Tabs` | `<Tabs label="Secciones" value={vista} onChange={setVista} items={[{ value: 'resumen', label: 'Resumen' }, { value: 'equipos', label: 'Equipos', count: 4 }]} />` | `role="tablist"`. Una sola pestaña enfocable; se cambia con las flechas, Inicio y Fin. Variantes `line` (por defecto) y `segmented`. |
| `KpiCard` | `<div className="kpi-grid kpi-grid-page" role="group" aria-label="Filtrar órdenes"><KpiCard icon={<Wrench size={18} />} label="En proceso" value={2} pressed={filtro === 'proceso'} onClick={…} /></div>` | Tres usos, cada uno con su señal: **filtro** (`onClick` + `pressed`: botón con `aria-pressed` y borde verde al estar activo; un segundo clic lo quita), **enlace** (`to`: lleva a otra pantalla; conserva su ícono y suma una flecha ↗ abajo a la derecha) e **informativo** (sin `onClick` ni `to`). `alert` pone la cifra en rojo (atrasadas). `tone` muestra, en lugar del ícono, un punto del color de la etiqueta de ese estado (el mismo tono de `Badge`): lo usan las tarjetas de estados de la flota. `meter={{ value, label }}` agrega una barra de avance bajo la cifra, con su texto para lectores de pantalla; un `<small>` dentro de `value` es el complemento de la cifra («4 de 25 con estado conocido»). `kpi-grid-page` separa el grupo de lo que sigue cuando va directo en la página. En el teléfono, dos columnas. Lo usan Inicio, Flota, Clientes, Portal del cliente, Órdenes, Solicitudes, Calendario, Planificador, Mantenimiento y Reportes. **Estados de la flota** (`FleetSummary`): `kpi-grid-states`, seis en una fila (tres hasta 1100 px y en la ficha del cliente, dos en el teléfono), con la cifra al pie para que quede alineada aunque un nombre ocupe dos líneas. |
| `Steps` | `<Steps label="Pasos del reporte" current={paso} onSelect={setPaso} items={[{ label: 'Diagnóstico', done: true }, { label: 'Trabajo' }]} />` | Asistente con orden: marca el paso actual (`aria-current="step"`) y los completados (✓ y texto oculto «completado»). Sin `onSelect` solo indica el avance. Para secciones sin orden, usar `Tabs`. En móvil la barra se desplaza por dentro. |
| `DataTable` | `<DataTable caption="Equipos" rows={equipos} rowKey={e => e.id} columns={[{ id: 'codigo', header: 'Equipo', cell: e => e.codigo }, { id: 'horas', header: 'Horómetro', numeric: true, cell: e => e.horas }]} />` | `caption` obligatorio (oculto, para lectores de pantalla); cabeceras con `scope="col"`; `numeric` alinea a la derecha con cifras tabulares; `hideHeader` para columnas como «Acciones»; mensaje `empty` cuando no hay filas. |
| `Pagination` | `<Pagination page={pagina} pageCount={total} onChange={setPagina} summary="24 órdenes" />` | Debajo de la tabla, dentro del mismo panel. Desactiva «Anterior» y «Siguiente» en los extremos. |
| `FilterToggle` | `<FilterToggle open={abierto} active={2} controls="os-filter-fields" onToggle={…} />` seguido de `<div id="os-filter-fields" className="filter-fields">…</div>` (con la clase `is-open` cuando está abierto) | En el teléfono (hasta 600 px) pliega los filtros secundarios y dice cuántos están activos; la búsqueda queda siempre visible. Con pantalla ancha el botón no aparece y `.filter-fields` no agrega caja (`display: contents`), así que los campos siguen en su cuadrícula. Lo usan Órdenes y Solicitudes. |
| `BrandMark` | `<BrandMark />` | Logotipo oficial «EM» en SVG. Decorativo (`aria-hidden`): el nombre va en texto al lado. Toma el color del texto (`currentColor`). Lo usa `Brand` (menú lateral, acceso, error y vista del operador). |

En `base.css`, los colores de `.button` (y sus variantes `button-dark`, `button-danger` y `button-orange`), `.icon-button` y el aviso de cambios sin guardar pasan a tokens. Visualmente cambia poco: borde del botón `#dddfd5` → `--color-border`, radio 7 → 8 px, y botón oscuro `#3a3a3a` → `--color-primary`. El foco de enlaces y botones usa `--color-focus`. Las tablas (`.data-table`) usan el token `--color-border-subtle` para separar filas y `--color-surface-subtle` en la cabecera y al pasar el cursor. La tabla de permisos de Accesos usa `DataTable` como ejemplo.

**Botones:**
- **Acción principal:** oscura en todas las pantallas (`variant="primary"`, clase `button-dark`), incluido «Nueva orden» en Inicio, que antes era naranja. El naranja es color de marca: `button-orange` queda solo en la vista del operador, sobre fondo oscuro.
- **Esquinas:** todos los botones usan `--radius-md` (8 px), los botones de ícono `--radius-sm` y los campos el radio general. Una pantalla no redefine el radio: el Inicio del administrador y la ficha del equipo usaban 4 px.

## Marca

- **Logotipo oficial:** `BrandMark` es el «EM» de Expertos en Montacargas, vectorizado del archivo de la marca (coincide en un 99 % con el original). Es recto, sin cursiva y sin subrayado. Reemplaza al «EM» que antes se escribía con texto en cursiva y una barra naranja.
- **Color:** negro (`--color-logo`) sobre fondos claros y blanco sobre la vista oscura del operador (`.client-theme`). No usar otros colores, contornos ni sombras.
- **Tamaño:** 22 px de alto en la marca del portal (unos 74 px de ancho). Escalar siempre con la proporción del dibujo (`width: auto`): no estirarlo ni recortarlo.
- **Composición (`Brand`):** el logotipo a la izquierda, alineado con «Portal EM», y el lema «EXPERTOS EN MONTACARGAS» (12 px) debajo del nombre.
- **Ícono de la pestaña** (`public/favicon.svg`): el mismo trazado en blanco sobre el cuadrado oscuro.

## Nombres de pantalla

**Regla:** el menú, la ruta de navegación (arriba de cada pantalla) y el título usan el mismo nombre. El título puede agregar un complemento («Calendario» → «Calendario de mantenimiento») o, en las vistas personales, el posesivo («Mis órdenes de servicio»), pero empieza con el nombre del menú. Las rutas de las direcciones (`/tickets`, `/preventivos`) no cambian.

| Menú | Título | Perfil |
|---|---|---|
| Solicitudes | Solicitudes de servicio | Todos (antes el menú del personal decía «Tickets») |
| Órdenes de servicio | Órdenes de servicio · Mis órdenes de servicio (técnico) | Personal |
| Mantenimiento | Mantenimiento de la flota (antes «Dashboard de mantenimiento») | Personal |
| Reportes de servicio | Reportes de servicio | Cliente (`/ordenes`) |
| Agenda | Agenda de mantenimiento | Cliente (`/calendario`) |
| Indicadores | Indicadores de servicio | Cliente (`/reportes`) |

- **Menú del cliente:** `clientNavigation` en `Shell.tsx`. La ruta de navegación del cliente usa estos nombres, no los del personal.
- **Inicio** es la excepción: su título saluda según el perfil («Operación», «Tu operación, bajo control», «Tu jornada, en orden»). La ruta de navegación sigue diciendo «Inicio».
- **Antetítulo** (el texto pequeño sobre el título): el grupo del menú al que pertenece la pantalla, con `sectionOf(módulo)` de `navigation.ts`. Por ejemplo, «ADMINISTRACIÓN» en Catálogos, Datos, Roles y accesos y Plan de trabajo, que antes llevaban lemas («Configura tu operación», «Tu información, organizada»…). Los módulos en preparación también usan su grupo. Inicio es la excepción: saluda según el perfil.
- **Menú compacto:** entradas de 34 px con mouse (44 px en pantallas táctiles) y 12 px entre grupos. En escritorio con poca altura (hasta 900 px) se oculta el recuadro inferior del menú, que repite el modo que ya dice la barra superior. Así, a 1366 × 850 el menú del administrador entra completo; antes había que desplazarlo 153 px.
- **Sección «Próximamente»:** los módulos sin construir (`upcoming: true` en `navigation`: Contratos, Checklist diario, Horas de técnicos y Viáticos) van en una sección plegable al final del menú, con el número de módulos. Está cerrada por defecto y se abre sola al entrar a uno de ellos. El botón usa `aria-expanded` y `aria-controls`. Al construir un módulo, se le quita `upcoming` y vuelve a su grupo.

## Primero el trabajo

- **Inicio del técnico:** la «Agenda de hoy» va primero, antes de la búsqueda y los indicadores. Arriba muestra sus citas atrasadas (hasta 3, de la más antigua a la más reciente, con enlace a todas). Si hoy no tiene servicios, muestra el siguiente servicio confirmado (`currentWork().next`, sin borradores).
- **Agenda de hoy del coordinador y el administrador:** sigue en la columna lateral. Si hay citas atrasadas, lo dice arriba («4 citas atrasadas · Revisar atrasadas») en lugar de mostrar solo «No hay servicios programados para hoy».
- **Listas en el teléfono:** en Órdenes y Solicitudes, la búsqueda queda visible y el resto de filtros se pliega con `FilterToggle`.

## Reporte de servicio

`ServiceReport` (`src/features/operations/ServiceReport.tsx`) es el reporte de una orden: el mismo en pantalla, en el portal del cliente y en papel o PDF («Imprimir / PDF»).

- **Orden de lectura:**
  1. encabezado con el logotipo, el código y el estado;
  2. resumen: cliente, sede, tipo, fecha, horario con duración y técnicos con su rol;
  3. equipo en cuadrícula: marca y modelo, serie, ID del cliente, horómetro y odómetro. El código EMSA no va: es interno y el personal lo ve en la ficha del equipo;
  4. **resultado** destacado;
  5. detalle del trabajo, con la etiqueta a la izquierda («Solicitud», «Diagnóstico», «Causa confirmada», «Trabajo realizado» y «Pruebas realizadas»);
  6. materiales: «Ninguno registrado» si no hay;
  7. recomendaciones y seguridad, solo si tienen texto;
  8. conformidad de quien recibe: en papel, siempre; en pantalla, solo cuando firmó en el portal;
  9. aviso de cierre.
- **Etiquetas para el cliente:** «Horómetro» y «Odómetro», sin «H1» ni «H3», que son nombres internos de AppSheet.
- **Papel:** página con nombre `service-report`, tamaño carta, 16 × 14 mm de margen.
  - En cada hoja, incluidas las evidencias, se repite el código de la orden como texto de impresión. El encabezado y pie propios incluyen el contacto de la empresa y «Página N de M». Al definirlos, Chrome 131 o posterior deja de imprimir su fecha, su título y la dirección con el identificador interno de la orden.
  - Al guardar con una impresora PDF del sistema, seleccionar también papel Carta (216 × 279 mm): el controlador puede reemplazar el tamaño indicado por la página.
  - El pie del reporte conserva sus párrafos juntos y unidos al bloque anterior. Si no cabe el cierre, se mueve completo con las firmas; no se agrega una hoja solo para el aviso o la fecha de generación.
  - `print-color-adjust: exact` conserva los fondos del resultado y de la cuadrícula del equipo, aunque «Gráficos de fondo» esté apagado.
- **Firma:** solo firma quien recibe. El técnico no tiene línea para firmar: lo identifican su usuario del portal, el historial de la orden y el resumen («Técnicos»). Va en una fila baja: la firma (o la línea para firmar a mano, de 10 mm) a la izquierda, con 75 mm de ancho en papel, y al lado el nombre con «Recibido por». En el teléfono, una debajo del otro.
  - **Firma digital de quien recibe** (prop `signature` de `ServiceReport`): la imagen ocupa el lugar de la línea, con el nombre de quien firmó y «firmado el 15/10/2026 a las 10:42». En papel mide 13 mm de alto. En pantalla aparece el apartado «Conformidad del servicio» solo cuando hay firma, también en el portal del cliente.
  - «Capturada en el portal por …» solo se ve en pantalla y solo para el personal de EMSA: el servidor no envía ese dato al cliente y no se imprime.
  - Sin firma digital: la línea para firmar a mano con el nombre de «Recibido por», solo en papel.
- **Recuadro para firmar** (`SignaturePad` y `ReceiverSignature` en `src/features/attachments`, estilos en `operations.css`):
  - lienzo de 200 px de alto (180 px en el teléfono) con borde punteado `--color-border-strong` (3.14:1) y la guía «Firma aquí»; `touch-action: none` evita que la página se mueva mientras se firma;
  - la tinta toma el `color` del lienzo (`--color-text`), sin colores fijos en el código;
  - botones del sistema: «Borrar», «Cancelar» y «Confirmar firma» (principal). En el teléfono, «Confirmar firma» ocupa todo el ancho arriba y los otros dos van debajo; todos miden 44 px en pantallas táctiles;
  - alternativa: el recuadro no se puede usar con teclado ni lector de pantalla, así que el texto de ayuda (enlazado con `aria-describedby`) explica que, si la persona no puede firmar en la pantalla, la firma queda pendiente («Firma pendiente», `Badge` de aviso) y el reporte impreso conserva la línea para firmar a mano;
  - la imagen se recorta a los trazos y se guarda a 2× como máximo (800 × 300 px), unos pocos KB.
- **Anexo:** las fotos de evidencia (Antes y Después) comienzan en una hoja nueva con su título y se distribuyen en tres columnas. Se conserva el encuadre completo de fotos horizontales y verticales, sin recortarlas; cada foto permanece junto a su nombre y categoría. Sin fotografías no se agrega una hoja de anexo. Los controles, los videos y los PDF no se imprimen.
- **Nombre del PDF:** mientras el reporte está abierto, el título de la página es «Reporte de servicio OS-N · Expertos en Montacargas», que el navegador propone como nombre del archivo.
- **Técnicos:** si quien ve el reporte no puede leer sus nombres, como el cliente, dice «Técnico de Expertos en Montacargas, S.A.» en lugar de «Sin técnico asignado».

## Formularios en línea y casillas

- **Estilos compartidos en `base.css`:** la barra de filtros y formularios en línea (`.ops-filters`: Reportes, Roles y accesos y Adjuntos) y los paneles `.access-accounts`, `.access-credentials`, `.ops-table-actions` y `.attachment-*` estaban en la hoja de Inicio. Al abrir Roles y accesos, Datos u Órdenes directamente (recargar o un enlace), esas pantallas quedaban sin estilos hasta pasar por Inicio. **Regla:** una clase que usan dos o más pantallas va en `base.css`, no en la hoja de una pantalla. Pasó lo mismo con `.equipment-admin-state` (dato secundario bajo el principal de una celda): estaba en la hoja de Flota y en la bitácora de Datos el ID del usuario quedaba pegado al nombre.
- **Casilla con texto:** `<label className="check-field"><input type="checkbox" />Sin vencimiento</label>`. Dentro de `.ops-filters` y `.account-fields`, que apilan etiqueta y campo, queda en una sola línea, a 16 px y centrada con los campos vecinos.
- **Campos en el teléfono:** hasta 600 px de ancho, todos los campos (`input`, `select` y `textarea`) usan 16 px, por una regla general de `base.css`. Con menos, iOS acerca la pantalla al enfocarlos. No hace falta repetirlo en cada pantalla.
- **Campos de fecha en cuadrículas:** si la etiqueta es `display: grid`, el campo necesita `min-width: 0`. Si no, el ancho propio del selector de fecha lo saca de su columna en el teléfono.

## Objetivos táctiles

En pantallas de dedo (`@media (pointer: coarse)`), todo control mide al menos `--target-min` (44 px). Con mouse no cambia nada: todas las reglas están dentro de ese bloque.

- **Regla general en `base.css`:** campos y selectores (con especificidad alta a propósito, para ganar a las alturas fijas de cada pantalla), menú lateral, botón de perfil, `.text-link`, `summary`, y enlaces que se muestran como bloque dentro de tablas y listas (`td > a`, `li > a`). `min-height` no afecta a los enlaces en línea dentro de un texto.
- **Hojas de pantalla:** cuando una pantalla fija la altura de un botón con un selector más específico, se agrega su propio bloque `@media (pointer: coarse)` **al final** de la hoja, para ganar también a sus reglas de móvil. Ejemplos: días del calendario, enlace de fila de Órdenes y botones de la ficha.
- **Calendario en teléfonos:** 7 columnas en 375 px dejan poco ancho; las celdas usan menos relleno lateral para que cada día llegue a 44 × 44 px.
- **Calendario en pantallas táctiles anchas** (más de 750 px, como una tableta): el número del día mide 44 × 44 px; antes medía 28 px de ancho. Las citas del mes miden 44 px de alto (antes 25): la hora va arriba y el código de la orden debajo, así se lee entero. Las semanas con citas quedan más altas; en el teléfono las citas siguen como conteo.
- **Al crear un control nuevo:** usar los componentes (`Button`, `IconButton`, `Tabs`, `Steps`…), que ya cumplen. Si una hoja fija una altura menor de 44 px, agregar su bloque táctil.

## Revisión automática

`src/design/design-tokens.test.ts` corre con `pnpm test`, y por lo tanto en «Portal EM checks» de GitHub. También se puede correr sola con `pnpm check:design`. Falla si:

- una hoja `.css` en `src/` usa un color fijo (`#hex`, `rgb()`, `hsl()`) fuera de `src/design/tokens.css`;
- una hoja usa un tamaño de letra menor de 12 px, en `font-size` o en el atajo `font`, con `px` o `rem`;
- un componente `.tsx` usa clases de Tailwind con valores fijos (`bg-[#…]`, `text-[10px]`) o estilos en línea con color o tamaño fijo;
- `src/styles.css`, la hoja antigua, suma colores fijos o textos pequeños. Hoy tiene 419 y 252: sus reglas ya están reemplazadas por las hojas de cada pantalla. Si se limpia, hay que bajar esos números en la prueba.

El mensaje de error indica archivo, línea y valor. Las ilustraciones SVG con atributos de color, como el montacargas de `ui.tsx`, no se revisan.

Para agregar estilos: usar la hoja de la pantalla y los tokens. Si hace falta un color nuevo, se agrega como token en `tokens.css`, con su contraste documentado.

## Decisión de mantenimiento

Se conservan los tokens y componentes compartidos ya aprobados, junto con las hojas de cada pantalla. Tailwind no justifica reescribir pantallas funcionales; excluir documentación y pruebas evita utilidades accidentales. Migrar componentes cuando se modifica su pantalla, con la revisión automática de diseño vigente.

## Órdenes en campo y trabajo compartido

Los técnicos pueden crear órdenes en cualquier equipo activo (incluidos equipos no operativos que necesitan reparación), sin habilitación individual. Los equipos vendidos o dados de baja no se ofrecen para nuevas órdenes del técnico. Las asignaciones históricas y las habilitaciones antiguas se conservan; estas últimas ya no limitan el acceso al catálogo activo.

Una orden conserva `tecnico_id` como responsable y admite `tecnico_apoyo_1_id` y `tecnico_apoyo_2_id`, opcionales y distintos. El técnico creador queda como responsable; coordinación y administración pueden asignar el equipo de trabajo. El responsable puede ajustar apoyos mientras la orden siga abierta. Los apoyos pueden documentar, adjuntar evidencias y cerrar con las mismas validaciones de ejecución, pero no cambiar el equipo de técnicos ni publicar al cliente.

Cada participante consulta la misma orden en Inicio, Órdenes, Calendario y Planificador. La paginación y los filtros del servidor aplican la pertenencia al equipo de trabajo sin multiplicar registros. Las fotos y videos se autorizan contra la orden compartida y conservan sus referencias originales. Las ediciones conservan autoría y versión; un guardado desactualizado se rechaza.

El alta en estado «En proceso» registra el inicio indicado; si está vacío, usa el instante actual. El formulario presenta las horas en Guatemala. No cambia automáticamente el estado operativo del equipo. La migración 11 agrega los apoyos al índice operativo y reconstruye esa proyección por lotes reanudables, sin modificar los registros originales, el historial ni los archivos; las órdenes anteriores sin apoyos siguen funcionando.

## Coordinadores en campo y revisión de órdenes completadas

El coordinador mantiene su perfil y puede tener un registro de técnico activo, disponible como responsable o apoyo. Accesos permite a administración vincular una cuenta de coordinador existente, con reautenticación y sin cambiar su contraseña. Las cuentas nuevas de coordinador crean ese registro; no se duplican las identidades vinculadas en un reintento.

Las órdenes operativas completadas admiten dos acciones exclusivas de administración y coordinación: Corregir reporte (mantiene estado, fechas, identidad, equipo, participantes y lecturas) y Reabrir orden (En proceso, retira la publicación al cliente y devuelve las solicitudes resueltas vinculadas a En revisión). Ambas requieren motivo de 8 a 500 caracteres y versión esperada; conservan la versión completa anterior y posterior en bitácora. Los reportes importados no se reescriben. Un segundo cierre no duplica una lectura original idéntica.

Coordinación también puede agregar evidencias a sus órdenes, incluso completadas con motivo obligatorio. Se conservan los archivos anteriores y se registra el autor y motivo del adjunto. El detalle muestra hasta 100 revisiones recientes para administración y coordinación. Técnicos y clientes no acceden a la corrección ni reapertura ni a las evidencias posteriores al cierre como escritores.

## Captura en tres secciones

La orden se captura en Inicio (equipo, participantes, visita, inicio y motivo), Atención (diagnóstico, trabajo, lecturas, seguridad y evidencias) y Cierre (pruebas, resultado, fin y conformidad). Se puede iniciar y guardar avances sin cerrar el editor. Materiales y recomendaciones son opcionales y se despliegan al consultar registros que ya contienen esos datos. Los campos de cierre siguen siendo obligatorios para completar.

Los síntomas activos del catálogo se agregan al motivo mediante botones; no reemplazan el texto previo ni completan diagnóstico, trabajo o pruebas. El técnico recibe únicamente ese catálogo en lectura; se conservan las restricciones de edición de solicitudes, órdenes y demás catálogos. El cliente conserva su vista de consulta de reportes compartidos.

Causa confirmada desaparece de la captura. No se elimina el campo persistido ni su contenido en reportes anteriores, exportaciones o auditoría. Los guardados parciales no envían ese campo.

Al abrir una orden nueva se sugieren el día, la hora de visita y el inicio del trabajo usando America/Guatemala. Son editables con los permisos existentes. Abrir una orden guardada no cambia ni rellena sus horas; al iniciar una atención sin inicio, el servidor registra el instante actual. En una visita futura debe dejarse el inicio vacío hasta comenzar. Las correcciones de reportes completados siguen conservando sus fechas y exigiendo motivo.

## Mantenimiento por tipo de flota

Los botones Todos los equipos, Equipos en renta y Equipos de clientes filtran conjuntamente la lista y sus indicadores. En renta identifica equipos propios con situación administrativa En renta; la asignación a un cliente no basta. Limpiar filtros restablece también esta selección.

Un plan preventivo nuevo de un equipo en renta propone Días y un intervalo de 30. Se conserva cualquier plan existente y el ciclo mayor mantiene su criterio por horas. La fecha base permanece pendiente hasta su confirmación por administración; no se crean servicios, lecturas ni planes automáticamente. Coordinación mantiene la consulta y administración la configuración.


## Reportes: control preventivo

Reportes filtra equipos y servicios por Todos, En renta o De clientes. La cobertura del período cuenta equipos con preventivo completado una vez por equipo, no órdenes; no certifica cumplimiento del intervalo. Sin fechas seleccionadas, el bloque preventivo usa el mes actual de Guatemala. El origen filtra el detalle general, mientras el bloque preventivo contempla todo el historial autorizado.

Administración y coordinación consultan los vencimientos de planes vigentes al día actual, separados del período de reportes, con programación y bases pendientes explícitas. El cliente conserva solo reportes compartidos y equipos propios; recibe una clasificación booleana de renta sin estado administrativo ni planes. El técnico mantiene su navegación actual sin acceso a Reportes. No se modifican bases, lecturas ni historial.


## Flota: selección de renta y clientes

Flota de equipos usa los mismos filtros Todos los equipos, Equipos en renta y Equipos de clientes que Mantenimiento y Reportes. La selección se combina con cliente, búsqueda, estado operativo y mantenimiento. Los indicadores y la exportación administrativa usan el mismo alcance; volver de la ficha conserva la selección. No cambia permisos ni registros.


### Claridad de mantenimiento y período de Reportes

Mantenimiento inicia en Preventivo y permite seleccionar Mayor o Ambos. El total de equipos se distingue de los ciclos evaluados; indicadores, agrupaciones y columnas siguen el tipo elegido. Las bases pendientes se destacan antes de los indicadores: cero ciclos vencidos no certifica que los equipos estén al día.

Reportes inicia en el mes actual de Guatemala. Desde y Hasta se aplican al resumen, cobertura preventiva, gráfico y detalle, incluyendo el filtro de origen. Restablecer vuelve al mes actual. Los intervalos inválidos muestran un aviso en lugar de indicadores engañosos. El seguimiento de vencimientos y programación conserva toda la información autorizada y se identifica como estado actual, independiente del período de servicios. No se modifican planes, bases, historial ni permisos.


### Filtros entre Flota, Mantenimiento y Reportes

La navegación entre estas tres pantallas conserva en la URL el tipo de flota y el cliente, además del período y filtros propios que se recuperan al regresar. Abrir o cerrar una ficha conserva el contexto; no se transfieren IDs de detalle al menú ni se guardan filtros en un almacenamiento compartido entre cuentas. Cambiar cliente o tipo de flota limpia el equipo específico de Reportes. Los permisos siguen siendo los del perfil y del servidor.

En teléfono (hasta 600 px), los filtros secundarios se pliegan con un botón accesible y conservan un resumen visible. Los indicadores ocupan dos columnas y la tabla de Flota se presenta como fichas con etiquetas, sin depender del desplazamiento horizontal. En computadora los controles permanecen visibles.

### Cancelación de solicitudes

Administración y coordinación disponen de «Cancelar solicitud» con motivo obligatorio de 8 a 500 caracteres. La descripción y las evidencias se conservan; la bitácora registra actor, fecha, motivo y versiones anterior/nueva. El estado Cancelado se retira del formulario general para usar esta acción explícita.

No se cancelan órdenes en cadena: las órdenes abiertas deben revisarse y cancelarse primero. Una orden completada impide cancelar la solicitud; corresponde revisar el trabajo y su resolución. El servidor verifica todas las relaciones, incluidos enlaces inversos, dentro de la escritura transaccional. Técnico y cliente no pueden cancelar. Los registros históricos se conservan.

### Avance visible de los ciclos

Mantenimiento conserva el cálculo de avance existente y muestra su porcentaje junto a una barra accesible en Preventivo y Mayor. El color sigue el estado calculado; al vencer hoy la barra es roja. Los avances estimados se identifican y se mantiene la fecha de la última lectura. Sin base o margen calculable no se presenta porcentaje. No cambia planes, historial ni permisos: administración y coordinación consultan esta pantalla.

### Borrador local de atención

El formulario respalda únicamente textos en el navegador, por cuenta, perfil y orden, durante siete días. Requiere restauración explícita; si la versión de la orden cambió, permite consultar el texto pero bloquea su restauración automática. Los guardados siguen validando la versión y los permisos en servidor. Una orden nueva conserva el identificador de reintento al recuperar texto. No se respaldan archivos, firmas, lecturas, fechas ni estado. Guardar correctamente o descartar explícitamente elimina la copia local. El indicador de red es orientativo: no deshabilita el envío ni afirma que el servidor esté disponible. El almacenamiento local puede estar bloqueado o borrarse por el navegador; se informa si falla y no sustituye «Guardar avance».
