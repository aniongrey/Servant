#!/usr/bin/env node
/**
 * Development orchestrator: backend as its own process, Vite in front of it.
 *
 * Why not just let the dev server mount the API modules in-process? Because a
 * Vite restart re-evaluates the config and tears the backend down with it. The
 * realtime gateway then fails to rebind ("already served by another local
 * gateway") and the session stays broken until every process is killed by hand.
 * Splitting them keeps the backend alive across frontend restarts.
 *
 * Layout:
 *   [backend]  node src-tauri/binaries/shiro-server.cjs   -> 127.0.0.1:5174
 *   [bundle]   vite build --watch (rebuilds the backend payload)
 *   [ui]       vite dev server on 5173, proxying /api -> 5174
 *
 * Editing backend sources rebuilds the payload and restarts only the backend.
 * Editing frontend sources keeps the usual hot reload.
 *
 * The last half only holds because `vite.config.ts` does not import any backend
 * module: Vite watches whatever the config statically imports, so a config that
 * pulled in `apiModules.ts` would restart this whole server — and drop every
 * open WebSocket, realtime gateway included — on every backend edit.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const backendBundle = path.join(root, 'src-tauri', 'binaries', 'shiro-server.cjs');
const backendPort = process.env.SHIRO_DEV_BACKEND_PORT ?? '5174';
const RESTART_DEBOUNCE_MS = 300;

const children = new Set();
let backend;
let restartTimer;
let shuttingDown = false;

function label(name, chunk) {
  return chunk
    .toString()
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => `[${name}] ${line}\n`)
    .join('');
}

function track(name, child) {
  children.add(child);
  child.stdout?.on('data', (chunk) => process.stdout.write(label(name, chunk)));
  child.stderr?.on('data', (chunk) => process.stderr.write(label(name, chunk)));
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.log(`[${name}] exited (code=${code} signal=${signal})`);
    }
  });
  return child;
}

function startBackend() {
  backend = track(
    'backend',
    spawn(process.execPath, [backendBundle], {
      cwd: root,
      // stdin stays open on purpose: the backend exits when it closes, which is
      // what guarantees no orphan survives this script.
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SHIRO_SERVER_HOST: '127.0.0.1',
        SHIRO_SERVER_PORT: backendPort,
        SHIRO_PROJECT_ROOT: root,
        SHIRO_DATA_DIR: root
      }
    })
  );
}

function stopBackend() {
  if (!backend || backend.exitCode !== null) return;
  const pid = backend.pid;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    backend.kill('SIGTERM');
  }
}

function restartBackend(reason) {
  console.log(`[dev] restarting backend (${reason})`);
  stopBackend();
  setTimeout(startBackend, 200);
}

function scheduleRestart(reason) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => restartBackend(reason), RESTART_DEBOUNCE_MS);
}

async function waitForBundle(timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(backendBundle)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  stopBackend();
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  setTimeout(() => process.exit(code), 300).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  if (!existsSync(viteBin)) {
    throw new Error(`vite not found at ${viteBin} — run \`npm install\``);
  }

  // Drop a payload left by an earlier run before watching: `waitForBundle` only
  // proves the file exists, so a stale bundle would be started and then restarted
  // a moment later once the watch build finished.
  rmSync(backendBundle, { force: true });

  // Rebuilds the backend payload on every backend source change.
  track(
    'bundle',
    spawn(process.execPath, [viteBin, 'build', '--config', 'vite.server.config.ts', '--watch'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  );

  if (!(await waitForBundle())) {
    throw new Error('the backend payload was never produced — check the [bundle] output above');
  }
  startBackend();

  watch(backendBundle, { persistent: true }, () => scheduleRestart('payload rebuilt'));

  console.log(`[dev] backend  http://127.0.0.1:${backendPort}  (restarts on backend edits)`);
  console.log('[dev] page     http://127.0.0.1:5173      (hot reload on frontend edits)');

  const ui = track(
    'ui',
    spawn(process.execPath, [viteBin, '--host', '0.0.0.0'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SHIRO_DEV_BACKEND_PORT: backendPort }
    })
  );
  ui.on('exit', () => shutdown(0));
}

main().catch((error) => {
  console.error(`[dev] ${error.message}`);
  shutdown(1);
});
