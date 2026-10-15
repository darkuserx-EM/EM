import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Revisión automática del sistema de diseño (docs/SISTEMA-DE-DISENO.md): los colores y tamaños se escriben con tokens.
const MIN_FONT_PX = 12;
// Única hoja que define colores: la paleta.
const PALETTE = 'src/design/tokens.css';
// Hoja antigua: sus reglas ya están reemplazadas por las hojas de cada pantalla. No puede crecer; al limpiarla, bajar estos números.
const LEGACY = { file: 'src/styles.css', hex: 419, smallFont: 252 };

type Finding = { file: string; line: number; text: string };

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name).replaceAll('\\', '/');
  return entry.isDirectory() ? walk(path) : [path];
});
const files = walk('src');
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;
// Quita los comentarios sin mover los números de línea.
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
const fontPx = (value: string) => {
  const match = value.trim().match(/^(\d*\.?\d+)(px|rem)\b/);
  return match ? Number(match[1]) * (match[2] === 'rem' ? 16 : 1) : null;
};

/** Colores fijos (#hex, rgb(), hsl()) y tamaños de letra menores de 12 px dentro de los bloques de declaraciones. */
export function auditCss(file: string, source: string) {
  const css = withoutComments(source); const colors: Finding[] = []; const smallFonts: Finding[] = [];
  for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
    const start = (block.index ?? 0) + 1;
    for (const color of block[1].matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)) colors.push({ file, line: lineOf(css, start + (color.index ?? 0)), text: color[0] });
    for (const font of block[1].matchAll(/(?:^|[;\s])font(-size)?\s*:\s*([^;]+)/g)) {
      const value = font[1] ? font[2] : (font[2].match(/(\d*\.?\d+(?:px|rem))/)?.[1] ?? '');
      const px = fontPx(value);
      if (px !== null && px < MIN_FONT_PX) smallFonts.push({ file, line: lineOf(css, start + (font.index ?? 0)), text: font[0].trim().replace(/^;/, '') });
    }
  }
  return { colors, smallFonts };
}

/** Clases de Tailwind con valores fijos y estilos en línea con color o tamaño fijo. */
export function auditTsx(file: string, source: string) {
  const findings: Finding[] = [];
  const patterns = [/\b[a-z-]+-\[#[0-9a-fA-F]{3,8}\]/g, /\btext-\[(\d*\.?\d+)px\]/g, /\b(?:color|background(?:Color)?|borderColor)\s*:\s*['"`]#[0-9a-fA-F]{3,8}/g, /\bfontSize\s*:\s*['"`]?(\d*\.?\d+)(?:px)?['"`]?/g];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
    const size = pattern.source.includes('fontSize') || pattern.source.includes('text-') ? Number(match[1]) : null;
    if (size === null || size < MIN_FONT_PX) findings.push({ file, line: lineOf(source, match.index ?? 0), text: match[0] });
  }
  return findings;
}

const report = (findings: Finding[]) => findings.map(item => `${item.file}:${item.line}  ${item.text}`).join('\n');
const hint = 'Usa los tokens de src/design/tokens.css: var(--color-…) para colores y var(--text-xs) o mayor para texto (mínimo 12 px).';

describe('sistema de diseño · revisión automática', () => {
  const sheets = files.filter(file => file.endsWith('.css') && file !== PALETTE && file !== LEGACY.file);

  it('las hojas de estilo no usan colores fijos fuera de tokens.css', () => {
    const found = sheets.flatMap(file => auditCss(file, readFileSync(file, 'utf8')).colors);
    expect(found, `${hint}\n${report(found)}`).toEqual([]);
  });

  it('las hojas de estilo no usan textos menores de 12 px', () => {
    const found = sheets.flatMap(file => auditCss(file, readFileSync(file, 'utf8')).smallFonts);
    expect(found, `${hint}\n${report(found)}`).toEqual([]);
  });

  it('los componentes no usan colores ni tamaños fijos en Tailwind o estilos en línea', () => {
    const found = files.filter(file => file.endsWith('.tsx')).flatMap(file => auditTsx(file, readFileSync(file, 'utf8')));
    expect(found, `${hint}\n${report(found)}`).toEqual([]);
  });

  it(`${LEGACY.file} no suma colores fijos ni textos pequeños`, () => {
    const { colors, smallFonts } = auditCss(LEGACY.file, readFileSync(LEGACY.file, 'utf8'));
    expect(colors.length, `${LEGACY.file} es la hoja antigua: escribe las reglas nuevas en la hoja de su pantalla, con tokens.`).toBeLessThanOrEqual(LEGACY.hex);
    expect(smallFonts.length, `${LEGACY.file} es la hoja antigua: escribe las reglas nuevas en la hoja de su pantalla, con tokens.`).toBeLessThanOrEqual(LEGACY.smallFont);
  });

  it('detecta los casos que debe bloquear', () => {
    const sample = auditCss('ejemplo.css', '.a{color:#fff;background:rgb(0 0 0)}\n.b{font-size:11px}\n.c{font:600 .6rem/1 Inter}\n/* #abc 9px */\n.d:has(#abc){font-size:var(--text-xs)}\n.e{font-size:max(var(--text-xs),.83em)}');
    expect(sample.colors.map(item => item.text)).toEqual(['#fff', 'rgb(']);
    expect(sample.smallFonts.map(item => item.line)).toEqual([2, 3]);
    expect(auditTsx('ejemplo.tsx', '<p className="text-[10px] bg-[#fafafa] text-[14px]" style={{ color: "#333", fontSize: 9 }} />').map(item => item.text)).toEqual(['bg-[#fafafa]', 'text-[10px]', 'color: "#333', 'fontSize: 9']);
  });
});
