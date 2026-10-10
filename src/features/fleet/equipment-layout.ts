export const layoutGrid = { columns: 12, rowHeight: 40, gap: 12 } as const;
export const layoutDefinitions = [
  { id: 'indicators', x: 0, y: 0, w: 12, h: 4, minW: 4, minH: 2 },
  { id: 'planning', x: 0, y: 4, w: 8, h: 8, minW: 4, minH: 4 },
  { id: 'findings', x: 8, y: 4, w: 4, h: 8, minW: 3, minH: 3 },
  { id: 'activity', x: 0, y: 12, w: 12, h: 3, minW: 4, minH: 2 },
  { id: 'meter', x: 0, y: 15, w: 6, h: 9, minW: 4, minH: 4 },
  { id: 'monthly', x: 6, y: 15, w: 6, h: 10, minW: 4, minH: 4 },
  { id: 'recent', x: 0, y: 25, w: 5, h: 11, minW: 3, minH: 3 },
  { id: 'types', x: 5, y: 25, w: 3, h: 7, minW: 3, minH: 3 },
  { id: 'completed', x: 8, y: 25, w: 4, h: 9, minW: 3, minH: 3 },
] as const;
export type LayoutId = typeof layoutDefinitions[number]['id'];
export type LayoutItem = { id: LayoutId; x: number; y: number; w: number; h: number };
export const defaultLayout = (): LayoutItem[] => layoutDefinitions.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
export const overlaps = (a: LayoutItem, b: LayoutItem) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Keep the chosen block in place; displace only the blocks it collides with. */
export function adjustLayout(items: LayoutItem[], id: LayoutId, patch: Partial<Omit<LayoutItem, 'id'>>) {
  const definition = layoutDefinitions.find(item => item.id === id)!;
  const current = items.find(item => item.id === id)!;
  const finite = (value: number | undefined, fallback: number) => value !== undefined && Number.isFinite(value) ? Math.round(value) : fallback;
  const w = Math.max(definition.minW, Math.min(12, finite(patch.w, current.w)));
  const chosen = { id, w, h: Math.max(definition.minH, Math.min(32, finite(patch.h, current.h))), x: Math.max(0, Math.min(12 - w, finite(patch.x, current.x))), y: Math.max(0, Math.min(400, finite(patch.y, current.y))) };
  const placed = [chosen];
  const others = items.filter(item => item.id !== id).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const item of others) {
    const next = { ...item };
    let collisions = placed.filter(other => overlaps(next, other));
    while (collisions.length) {
      next.y = Math.max(...collisions.map(other => other.y + other.h));
      collisions = placed.filter(other => overlaps(next, other));
    }
    placed.push(next);
  }
  return items.map(item => placed.find(next => next.id === item.id)!);
}

export function encodeLayout(items: LayoutItem[], viewportWidth?: number) {
  return JSON.stringify({ format: 'portal-em-equipment-layout', version: 1, view: 'summary', ...layoutGrid, viewportWidth, items }, null, 2);
}

/** A design contains geometry only, never equipment records or executable markup. */
export function decodeLayout(text: string): LayoutItem[] {
  if (text.length > 32_768) throw new Error('El archivo de diseño es demasiado grande.');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('El archivo no contiene un diseño válido.'); }
  if (!value || value.format !== 'portal-em-equipment-layout' || value.version !== 1 || value.view !== 'summary' || value.columns !== 12 || value.rowHeight !== 40 || value.gap !== 12 || !Array.isArray(value.items) || value.items.length !== layoutDefinitions.length) throw new Error('Selecciona un diseño descargado desde esta ficha.');
  const items: LayoutItem[] = layoutDefinitions.map(definition => {
    const matches = value.items.filter((row: LayoutItem | null) => row?.id === definition.id);
    const row = matches[0];
    if (matches.length !== 1 || !['x', 'y', 'w', 'h'].every(key => Number.isInteger(row[key])) || row.w < definition.minW || row.w > 12 || row.h < definition.minH || row.h > 32 || row.x < 0 || row.x + row.w > 12 || row.y < 0 || row.y > 700) throw new Error('El diseño tiene bloques incompletos o medidas fuera de rango.');
    return { id: definition.id, x: row.x, y: row.y, w: row.w, h: row.h };
  });
  if (items.some((item, index) => items.slice(index + 1).some(other => overlaps(item, other)))) throw new Error('El diseño contiene bloques superpuestos.');
  return items;
}
