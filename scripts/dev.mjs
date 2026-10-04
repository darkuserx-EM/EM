// Build-and-watch mode avoids native dependency scanning outside the project.
// Use dev:hmr on a normal unrestricted workstation for Vite's hot replacement.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const port = process.env.PORTAL_EM_PORT ?? '5173';
const children = new Set();
let preview;
let stopping = false;
function launch(args) {
  const child = spawn(process.execPath, [vite, ...args, '--configLoader', 'native'], { cwd: root, windowsHide: true, stdio: ['inherit', 'pipe', 'pipe'] });
  children.add(child);
  child.stderr.on('data', data => process.stderr.write(data));
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { children.delete(child); if (!stopping && code) stop(code); });
  return child;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
const watcher = launch(['build', '--watch']);
watcher.stdout.on('data', data => {
  const message = data.toString(); process.stdout.write(data);
  if (message.includes('built in') && !preview) {
    preview = launch(['preview', '--host', '127.0.0.1', '--port', port, '--strictPort']);
    preview.stdout.on('data', output => process.stdout.write(output));
    console.log('\nPortal EM: compilación automática activa. Recarga el navegador después de cada cambio.\n');
  }
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
