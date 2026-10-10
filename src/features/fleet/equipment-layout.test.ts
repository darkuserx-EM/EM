import { describe, expect, it } from 'vitest';
import { adjustLayout, decodeLayout, defaultLayout, encodeLayout, overlaps } from './equipment-layout';

const collisionFree = (items: ReturnType<typeof defaultLayout>) => items.every((item, i) => items.slice(i + 1).every(other => !overlaps(item, other)));
describe('optional equipment layout', () => {
  it('moves and resizes a block without losing or overlapping other blocks', () => {
    const original = defaultLayout(); const snapshot = structuredClone(original);
    const moved = adjustLayout(original, 'monthly', { x: 0, y: 0, w: 12, h: 12 });
    expect(moved.find(item => item.id === 'monthly')).toEqual({ id: 'monthly', x: 0, y: 0, w: 12, h: 12 });
    expect(collisionFree(moved)).toBe(true);
    expect(moved.map(item => item.id)).toEqual(original.map(item => item.id));
    expect(original).toEqual(snapshot);
  });
  it('keeps blocks within the canvas and respects minimum readable sizes', () => {
    const moved = adjustLayout(defaultLayout(), 'meter', { x: 30, y: -20, w: 0, h: 0 });
    expect(moved.find(item => item.id === 'meter')).toEqual({ id: 'meter', x: 8, y: 0, w: 4, h: 4 });
    expect(collisionFree(moved)).toBe(true);
    expect(adjustLayout(defaultLayout(), 'meter', { w: NaN, h: Infinity }).find(item => item.id === 'meter')).toEqual(defaultLayout().find(item => item.id === 'meter'));
  });
  it('round trips a downloaded design, and only returns geometry from imported content', () => {
    const items = adjustLayout(defaultLayout(), 'findings', { x: 0, y: 35 });
    const data = JSON.parse(encodeLayout(items, 1800)); data.items[0].html = '<script>unsafe</script>'; data.secret = 'not part of a design';
    expect(decodeLayout(JSON.stringify(data))).toEqual(items);
  });
  it('rejects incompatible, corrupt, duplicate, overlapping and oversized designs', () => {
    expect(() => decodeLayout('null')).toThrow();
    expect(() => decodeLayout('{broken')).toThrow();
    expect(() => decodeLayout(' '.repeat(33_000))).toThrow();
    for (const change of [
      (v: any) => { v.version = 99; },
      (v: any) => { v.items.pop(); },
      (v: any) => { v.items[1] = v.items[0]; },
      (v: any) => { v.items[0].w = '12'; },
      (v: any) => { v.items[0].x = -1; },
      (v: any) => { v.items[1].y = 0; },
    ]) { const value = JSON.parse(encodeLayout(defaultLayout())); change(value); expect(() => decodeLayout(JSON.stringify(value))).toThrow(); }
  });
  it('resolves repeated rearrangements without accumulating overlapping blocks', () => {
    let items = defaultLayout();
    for (let i = 0; i < 100; i++) {
      items = adjustLayout(items, items[i % items.length].id, { x: i % 9, y: i % 8, w: 4 + i % 9, h: 3 + i % 15 });
      expect(collisionFree(items)).toBe(true);
      expect(decodeLayout(encodeLayout(items))).toEqual(items);
    }
  });
});
