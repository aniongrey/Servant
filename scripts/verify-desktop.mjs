#!/usr/bin/env node
/**
 * Build the packaged desktop app and then prove it works — one command.
 *
 * `build:fast` proves the code compiles and stages a folder. It cannot prove the
 * two things that have actually broken this project once already:
 *
 *   - `/api/*` answered by the Tauri asset protocol, so `response.json()` throws
 *     `Unexpected token '<'` and every backend feature dies at once;
 *   - `/api/memory/*` answered with 503 because the Python interpreter the
 *     sidecar found had none of the dependencies, which also takes chat history
 *     and the activity log down with it.
 *
 * Both are invisible to a compiler and invisible in `npm run dev`, because the
 * dev server serves the API on the page origin. They only appear in a real
 * packaged run. So this script closes that loop:
 *
 *   1. refuse to start while another `Servant.exe` is running — the staging copy
 *      cannot overwrite a locked executable, and verifying a stale instance
 *      proves nothing about the build that just finished;
 *   2. build via `scripts/build-fast.mjs` (skipped with `--no-build`);
 *   3. launch `dist-fast/Servant/Servant.exe` and read its port announcement file,
 *      which is the only reliable way to learn the sidecar's port;
 *   4. wait for the Python memory service to finish its cold start, then assert
 *      the HTTP surface, including the JSON 404 that distinguishes a real
 *      backend from the asset protocol's HTML fallback;
 *   5. run one real conversation turn through `scripts/verify-chat.mjs`;
 *   6. close what it started (unless `--keep-open`) and print `backend.log` when
 *      anything failed — that file names the missing module or the failing route.
 *
 * Anything going into the executable — Rust sources, the sidecar payload, the
 * packaging config, `bundle.resources` — has no hot reload at all. This is the
 * command for those changes.
 *
 * Usage:
 *   npm run verify:desktop
 *   npm run verify:desktop -- --no-build --keep-open
 *   npm run verify:desktop -- --skip-chat        # HTTP surface only, no LLM turn
 *   npm run verify:desktop -- --port=49492       # check an instance already running
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { dataDir, projectRoot } from './lib/tauri-config.mjs';

const exeSuffix = process.platform === 'win32' ? '.exe' : '';
const APP_NAME = `Servant${exeSuffix}`;
const SIDECAR_NAME = `servant-server${exeSuffix}`;
const stageDir = path.join(projectRoot, 'dist-fast', 'Servant');
const appPath = path.join(stageDir, APP_NAME);
const backendLogPath = path.join(dataDir(), 'backend.log');

const PORT_WAIT_MS = Number.parseInt(process.env.SERVANT_VERIFY_PORT_WAIT_MS ?? '90000', 10);
/**
 * The Python memory service is spawned lazily by the backend and imports
 * pyarrow + sentence-transformers before it listens, so the first handful of
 * seconds after launch legitimately answer 503 (`ECONNREFUSED` in `backend.log`,
 * followed by `记忆服务已恢复`). A check that ran immediately would report a
 * failure that fixes itself, which is worse than no check at all — so the
 * readiness wait is long and the failure is only reported after it expires.
 */
const MEMORY_READY_WAIT_MS = Number.parseInt(
  process.env.SERVANT_VERIFY_MEMORY_WAIT_MS ?? '60000',
  10
);
const HTTP_TIMEOUT_MS = 20_000;

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const optionOf = (name) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

/**
 * What a working packaged app answers. The 404 entry is the important one: the
 * asset protocol answers *any* unknown path with `200 text/html`, so a request
 * that comes back as HTML means the address is wrong, not that the route is.
 */
const HTTP_CHECKS = [
  {
    path: '/api/character-skill',
    expect: 200,
    json: true,
    why: 'the character card the app ships reaches the page'
  },
  {
    path: '/api/memory/messages?limit=1',
    expect: 200,
    json: true,
    why: `the Python memory service is running — a 503 here means ${path.join(
      dataDir(),
      '.venv-memory'
    )} is absent or lacks dependencies`
  },
  {
    path: '/api/chat/history?limit=1',
    expect: 200,
    json: true,
    why: 'conversation history persists (it forwards to the memory service, so it 503s with it)'
  },
  {
    path: '/api/activity-logs?limit=1',
    expect: 200,
    json: true,
    why: 'the activity log store is reachable'
  },
  {
    path: '/api/nothing',
    expect: 404,
    json: true,
    why: "unknown paths get a JSON 404 — HTML here means we are talking to the asset protocol"
  }
];

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function pidIsAlive(pid) {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' });
  return result.status === 0 && new RegExp(`\\b${pid}\\b`).test(result.stdout ?? '');
}

/**
 * `tasklist` is the only process listing guaranteed to be present, and it is
 * called with a filter so it never prints more than the requested image.
 */
function runningPids(imageName) {
  if (process.platform !== 'win32') return [];
  const result = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/NH'], {
    encoding: 'utf8'
  });
  if (result.status !== 0) return [];
  const pattern = new RegExp(`${imageName.replace('.', '\\.')}\\s+(\\d+)`, 'gi');
  return [...(result.stdout ?? '').matchAll(pattern)].map((match) => Number(match[1]));
}

function announcedPort(pid) {
  const file = path.join(dataDir(), `backend-port-${pid}.json`);
  if (!existsSync(file)) return undefined;
  try {
    const announcement = JSON.parse(readFileSync(file, 'utf8'));
    return typeof announcement?.port === 'number' ? announcement : undefined;
  } catch {
    return undefined; // half-written file, read again on the next poll
  }
}

function backendLogTail(lines = 25) {
  if (!existsSync(backendLogPath)) return '(no backend.log yet)';
  const content = readFileSync(backendLogPath, 'utf8').trimEnd().split(/\r?\n/);
  return content.slice(-lines).join('\n');
}

function build() {
  console.log('\n=== build:fast ===');
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'build-fast.mjs')], {
    cwd: projectRoot,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`build:fast failed with exit code ${result.status}`);
  console.log(`--- build ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

function launch() {
  console.log(`\n[verify] launching ${appPath}`);
  const child = spawn(appPath, [], { cwd: stageDir, stdio: ['ignore', 'pipe', 'pipe'] });
  const echo = (stream, prefix) => {
    stream?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) console.log(`${prefix} ${line}`);
      }
    });
  };
  echo(child.stdout, '[app]');
  echo(child.stderr, '[app]');
  return child;
}

async function waitForBackend(child) {
  const started = Date.now();
  while (Date.now() - started < PORT_WAIT_MS) {
    if (child.exitCode !== null) {
      throw new Error(
        `${APP_NAME} exited during startup (code=${child.exitCode}). backend.log:\n${backendLogTail()}`
      );
    }
    const announcement = announcedPort(child.pid);
    if (announcement) {
      const base = `http://${announcement.host ?? '127.0.0.1'}:${announcement.port}`;
      console.log(`[verify] backend announced ${base} (sidecar pid ${announcement.pid})`);
      return base;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `no port announcement for pid ${child.pid} within ${PORT_WAIT_MS}ms. backend.log:\n${backendLogTail()}`
  );
}

async function probe(base, pathname, { limit = 300 } = {}) {
  const response = await fetch(`${base}${pathname}`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  const contentType = response.headers.get('content-type') ?? '';
  let body = '';
  try {
    body = (await response.text()).slice(0, limit);
  } catch {
    /* a body is optional for the checks below */
  }
  return { status: response.status, contentType, body };
}

/**
 * The memory service is the slowest thing to come up and three other endpoints
 * forward to it, so everything waits on it rather than each check racing it.
 */
async function waitForMemoryService(base) {
  const started = Date.now();
  let last = '';
  let announced = false;
  while (Date.now() - started < MEMORY_READY_WAIT_MS) {
    try {
      const outcome = await probe(base, '/api/memory/messages?limit=1');
      if (outcome.status === 200) {
        const elapsed = Date.now() - started;
        if (announced || elapsed > 1000) {
          console.log(`[verify] memory service ready after ${(elapsed / 1000).toFixed(1)}s`);
        }
        return { ready: true, elapsed };
      }
      last = outcome.body.replace(/\s+/g, ' ');
    } catch (error) {
      last = error.message;
    }
    if (!announced && Date.now() - started > 1500) {
      console.log('[verify] waiting for the Python memory service to finish its cold start');
      announced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ready: false, elapsed: Date.now() - started, last };
}

async function checkHttp(base) {
  console.log('\n=== HTTP surface ===');
  const failures = [];
  for (const check of HTTP_CHECKS) {
    let outcome;
    try {
      outcome = await probe(base, check.path);
    } catch (error) {
      failures.push(check);
      console.log(`  [FAIL] ${check.path}\n         ${error.message}\n         ${check.why}`);
      continue;
    }
    const jsonOk = !check.json || outcome.contentType.includes('json');
    const ok = outcome.status === check.expect && jsonOk;
    console.log(`  ${ok ? '[ok]  ' : '[FAIL]'} ${check.path.padEnd(30)} HTTP ${outcome.status}`);
    if (!ok) {
      failures.push(check);
      console.log(`         expected HTTP ${check.expect}${check.json ? ' JSON' : ''}`);
      console.log(`         ${check.why}`);
      console.log(`         body: ${outcome.body.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
  }
  return failures;
}

/**
 * A turn needs an LLM, which is a machine-level dependency rather than a property
 * of the build — so a missing model is reported as a skip instead of a failure.
 */
async function checkChatTurn(base) {
  console.log('\n=== conversation turn ===');
  let model;
  try {
    // Not truncated: this response is parsed, and a cut-off JSON body reads as
    // "Ollama is not answering" — the one thing this check must not confuse.
    const tags = await probe(base, '/api/ollama/tags', { limit: Number.MAX_SAFE_INTEGER });
    model = JSON.parse(tags.body).models?.[0]?.name;
  } catch {
    /* handled below, where it is worth a diagnostic */
  }
  if (!model) {
    console.log('  [skip] no model from /api/ollama/tags — Ollama is not answering');
    console.log('         start Ollama and re-run, or pass --skip-chat to silence this');
    return 'skipped';
  }

  const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'verify-chat.mjs')], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, SERVANT_VERIFY_BACKEND: base }
  });
  if (result.error) throw result.error;
  return result.status === 0 ? 'pass' : 'fail';
}

/**
 * Teardown. `desktop_windows.rs` answers `CloseRequested` on the pet window with
 * `api.prevent_close()` + `hide()`, so the WM_CLOSE that `taskkill` without `/F`
 * posts can never terminate the app — only the tray menu's quit calls
 * `app.exit(0)`. The window message is still sent first in case that changes,
 * but the tree kill is the real path, and `/T` matters: it takes the sidecar and
 * the Python memory service with it instead of orphaning them.
 */
function stopApp(pid) {
  if (!pidIsAlive(pid)) return 'already gone';
  spawnSync('taskkill', ['/PID', String(pid)], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!pidIsAlive(pid)) return 'closed cleanly';
    sleepSync(1000);
  }
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  sleepSync(1500);
  // A hard kill skips the sidecar's own cleanup, which is what normally removes
  // this announcement file. Left behind it would only ever be read again by a
  // process whose pid happens to be reused.
  rmSync(path.join(dataDir(), `backend-port-${pid}.json`), { force: true });
  return 'terminated with its process tree (/T /F)';
}

async function verify(base, { chat }) {
  const readiness = await waitForMemoryService(base);
  const failures = await checkHttp(base);
  const chatOutcome = chat ? await checkChatTurn(base) : 'skipped';

  console.log('\n=== desktop verification ===');
  console.log(`  app      : ${appPath}`);
  console.log(`  backend  : ${base}`);
  console.log(`  data     : ${dataDir()}`);
  console.log(`  http     : ${HTTP_CHECKS.length - failures.length}/${HTTP_CHECKS.length}`);
  console.log(
    `  memory   : ${
      readiness.ready
        ? `ready after ${(readiness.elapsed / 1000).toFixed(1)}s (cold start)`
        : `NOT ready after ${(readiness.elapsed / 1000).toFixed(1)}s — last answer: ${readiness.last}`
    }`
  );
  console.log(`  chat     : ${chatOutcome}`);
  console.log(`  log      : ${backendLogPath}`);

  if (failures.length > 0 || chatOutcome === 'fail') {
    console.log('\n--- backend.log (tail) ---');
    console.log(backendLogTail(30));
    return 1;
  }
  console.log('\nPASS packaged desktop app');
  return 0;
}

async function main() {
  const explicitPort = optionOf('port');
  if (explicitPort) {
    console.log(`[verify] port ${explicitPort} was given — nothing is built or started`);
    return verify(`http://127.0.0.1:${explicitPort}`, { chat: !hasFlag('skip-chat') });
  }

  // Checked before the build, not just before the launch: a three-minute build
  // that ends in "the executable is locked" is worse than an immediate refusal.
  const busy = runningPids(APP_NAME);
  if (busy.length > 0) {
    throw new Error(
      `${APP_NAME} is already running (pid ${busy.join(', ')}). ` +
        'The staging step cannot overwrite a running executable, and verifying the old ' +
        'instance would say nothing about the new build.\n' +
        '  close it, or check it as-is: npm run verify:desktop -- --port=<its backend port>'
    );
  }

  if (!hasFlag('no-build')) {
    const orphan = runningPids(SIDECAR_NAME);
    if (orphan.length > 0) {
      console.log(
        `[verify] note: an orphaned ${SIDECAR_NAME} is running (pid ${orphan.join(', ')}) — ` +
          'the staging copy of it will fail while that process holds the file'
      );
    }
    build();
  }

  if (!existsSync(appPath)) {
    throw new Error(`missing ${appPath} — run \`npm run build:fast\` first`);
  }

  const child = launch();
  let stopping = false;
  const onSignal = () => {
    if (!stopping) stopApp(child.pid);
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let code;
  try {
    const base = await waitForBackend(child);
    code = await verify(base, { chat: !hasFlag('skip-chat') });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    stopping = true;
    if (hasFlag('keep-open')) {
      console.log(`[verify] leaving ${APP_NAME} running (pid ${child.pid}) — --keep-open`);
    } else {
      console.log(`[verify] ${stopApp(child.pid)}`);
    }
  }
  return code;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`\n[verify:desktop] failed: ${error.message}`);
  process.exitCode = 1;
}
