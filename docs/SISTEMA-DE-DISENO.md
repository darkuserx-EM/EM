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

## Siguientes pasos

1. ~~Base global~~ (paso 1, `base.css`).
2. **Por pantalla:** ~~Órdenes~~ (paso 2) → ~~Calendario y planificador~~ (paso 3) → Flota y clientes → resto de la ficha → Inicio → administración → portal del cliente.
3. **Componentes compartidos:** `Button`, `Field`, `Badge`, `Tabs`/`Steps`, `KpiCard`, `DataTable`.
4. **Control en CI:** Stylelint contra colores y tamaños fuera de los tokens, y prueba de contraste.
