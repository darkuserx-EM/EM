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
| `Badge` | `<Badge tone="warning">Por vencer</Badge>` | Tonos `success`, `info`, `warning`, `danger` y `neutral`. `Status` lo usa con `statusTone(valor)`. |
| `Panel` | `<Panel title="Servicios" description="Por mes" actions={…}>…</Panel>` | El encabezado aparece solo si hay título o acciones. |
| `Field` | `<Field label="Marca" required help="…" error={error}>{control => <input {...control} value={marca} onChange={…} />}</Field>` | Vincula etiqueta, ayuda y error con el control (`id`, `aria-describedby`, `aria-invalid`). Con error, el campo toma borde rojo. |
| `Tabs` | `<Tabs label="Secciones" value={vista} onChange={setVista} items={[{ value: 'resumen', label: 'Resumen' }, { value: 'equipos', label: 'Equipos', count: 4 }]} />` | `role="tablist"`. Una sola pestaña enfocable; se cambia con las flechas, Inicio y Fin. Variantes `line` (por defecto) y `segmented`. |
| `KpiCard` | `<div className="kpi-grid"><KpiCard label="En espera" value={3} pressed={filtro === 'espera'} onClick={…} /></div>` | Sin `onClick` solo informa; con `onClick` es un botón; con `pressed` además actúa como filtro (`aria-pressed`). |
| `Steps` | `<Steps label="Pasos del reporte" current={paso} onSelect={setPaso} items={[{ label: 'Diagnóstico', done: true }, { label: 'Trabajo' }]} />` | Asistente con orden: marca el paso actual (`aria-current="step"`) y los completados (✓ y texto oculto «completado»). Sin `onSelect` solo indica el avance. Para secciones sin orden, usar `Tabs`. En móvil la barra se desplaza por dentro. |
| `DataTable` | `<DataTable caption="Equipos" rows={equipos} rowKey={e => e.id} columns={[{ id: 'codigo', header: 'Equipo', cell: e => e.codigo }, { id: 'horas', header: 'Horómetro', numeric: true, cell: e => e.horas }]} />` | `caption` obligatorio (oculto, para lectores de pantalla); cabeceras con `scope="col"`; `numeric` alinea a la derecha con cifras tabulares; `hideHeader` para columnas como «Acciones»; mensaje `empty` cuando no hay filas. |
| `Pagination` | `<Pagination page={pagina} pageCount={total} onChange={setPagina} summary="24 órdenes" />` | Debajo de la tabla, dentro del mismo panel. Desactiva «Anterior» y «Siguiente» en los extremos. |

En `base.css`, los colores de `.button` (y sus variantes `button-dark`, `button-danger` y `button-orange`), `.icon-button` y el aviso de cambios sin guardar pasan a tokens. Visualmente cambia poco: borde del botón `#dddfd5` → `--color-border`, radio 7 → 8 px, y botón oscuro `#3a3a3a` → `--color-primary`. El foco de enlaces y botones usa `--color-focus`. Las tablas (`.data-table`) usan el token `--color-border-subtle` para separar filas y `--color-surface-subtle` en la cabecera y al pasar el cursor. La tabla de permisos de Accesos usa `DataTable` como ejemplo.

## Revisión automática

`src/design/design-tokens.test.ts` corre con `pnpm test`, y por lo tanto en «Portal EM checks» de GitHub. También se puede correr sola con `pnpm check:design`. Falla si:

- una hoja `.css` en `src/` usa un color fijo (`#hex`, `rgb()`, `hsl()`) fuera de `src/design/tokens.css`;
- una hoja usa un tamaño de letra menor de 12 px, en `font-size` o en el atajo `font`, con `px` o `rem`;
- un componente `.tsx` usa clases de Tailwind con valores fijos (`bg-[#…]`, `text-[10px]`) o estilos en línea con color o tamaño fijo;
- `src/styles.css`, la hoja antigua, suma colores fijos o textos pequeños. Hoy tiene 428 y 259: sus reglas ya están reemplazadas por las hojas de cada pantalla. Si se limpia, hay que bajar esos números en la prueba.

El mensaje de error indica archivo, línea y valor. Las ilustraciones SVG con atributos de color, como el montacargas de `ui.tsx`, no se revisan.

Para agregar estilos: usar la hoja de la pantalla y los tokens. Si hace falta un color nuevo, se agrega como token en `tokens.css`, con su contraste documentado.
