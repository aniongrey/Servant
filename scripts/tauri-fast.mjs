import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stopProcessTree } from './dev-process-lifetime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const base = 'http://127.0.0.1:5173';

// A listening socket is not readiness: preview can answer 404 while dist rebuilds.
export async function waitForDesktop(url, signal, intervalMs = 250) {
  while (true) {
    signal.throwIfAborted();
    try {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(2000)]);
      const page = await fetch(`${url}/pages/desktop.html`, { signal: requestSignal });
      const html = await page.text();
      if (page.ok && page.headers.get('content-type')?.includes('text/html') &&
          /(?:\/assets\/desktop-[^"']+\.js|\/src\/app\/desktop-main\.tsx)/.test(html)) {
        const api = await fetch(`${url}/api/provisioning/gate`, { signal: requestSignal });
        if (api.ok && typeof (await api.json()).setupRequired === 'boolean') return;
      }
    } catch {
      // Connection refused, 503, and partial startup responses are retried.
    }
    await delay(intervalMs, undefined, { signal });
  }
}

async function main() {
  // Refuse an old server before the build empties the directory it is serving.
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', () => reject(new Error('5173 is occupied. Close the previous dev server before starting Servant.')));
    probe.listen(5173, '127.0.0.1', () => probe.close(resolve));
  });

  const children = new Set();
  const startup = new AbortController();
  const stop = () => startup.abort(new Error('Desktop startup cancelled'));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  function run(args) {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    children.add(child);
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => { children.delete(child); resolve(code ?? 1); });
    });
    return { child, done };
  }
  try {
    if (!process.env.npm_execpath) throw new Error('Start with npm run tauri:fast');
    const server = run([process.env.npm_execpath, 'run', 'desktop:serve']);
    server.done.then(
      (code) => startup.abort(new Error(`Desktop server exited (${code})`)),
      (error) => startup.abort(error)
    );
    console.log('[desktop] Building and waiting for the desktop page and API...');
    await waitForDesktop(base, AbortSignal.any([startup.signal, AbortSignal.timeout(180_000)]));
    console.log('[desktop] Page and API ready; starting Tauri.');
    const app = run([
      'node_modules/@tauri-apps/cli/tauri.js', 'dev', '--no-watch',
      '--config', 'src-tauri/tauri.fast.conf.json',
      '--config', JSON.stringify({ build: { beforeDevCommand: '' } }),
      ...process.argv.slice(2)
    ]);
    const onAbort = () => stopProcessTree(app.child.pid);
    startup.signal.addEventListener('abort', onAbort, { once: true });
    try {
      process.exitCode = await app.done;
    } finally {
      startup.signal.removeEventListener('abort', onAbort);
    }
  } finally {
    for (const child of children) stopProcessTree(child.pid);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[desktop] ${error.message}`);
    process.exitCode = 1;
  });
}
