import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
const root = resolve('.');
// Resolve only these local domain modules; avoid scanning parent directories on Windows.
await build({ entryPoints: ['server/domain.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24', outfile: 'server/generated/domain.mjs', tsconfigRaw: {}, plugins: [{ name: 'local-domain', setup(build) {
  build.onResolve({ filter: /.*/ }, args => ({ path: resolve(args.importer ? dirname(args.importer) : root, args.path) + (extname(args.path) ? '' : '.ts'), namespace: 'domain' }));
  build.onLoad({ filter: /.*/, namespace: 'domain' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'ts' }));
} }] });

// The bundle's API comes from its checked TypeScript entry, never a hand-written facade.
await writeFile('server/generated/domain.d.mts', 'export * from "../domain.js";\n');
