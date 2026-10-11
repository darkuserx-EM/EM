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

## Siguientes pasos

1. **Base global** (`styles.css`): barra lateral, cabeceras, botones, campos, etiquetas de estado y tablas.
2. **Por pantalla:** Órdenes → Calendario y planificador → Flota y clientes → resto de la ficha → Inicio → administración → portal del cliente.
3. **Componentes compartidos:** `Button`, `Field`, `Badge`, `Tabs`/`Steps`, `KpiCard`, `DataTable`.
4. **Control en CI:** Stylelint contra colores y tamaños fuera de los tokens, y prueba de contraste.
