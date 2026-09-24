#!/usr/bin/env node
/**
 * Fast production build: a runnable folder, no installer.
 *
 * `tauri build` spends most of its wall clock zipping ~700 MB into an MSI and an
 * NSIS package, and every one of those packages is 300-700 MB of writes the
 * developer never asked for. When the goal is "does this code work when it is
 * not running under Vite", the installer is pure overhead.
 *
 * This script produces the same application without any of that:
 *
 *   dist-fast/Shiro/Shiro.exe          the desktop shell
 *   dist-fast/Shiro/shiro-server.exe   the backend sidecar
 *   dist-fast/Shiro/…                  every other bundled resource
 *
 * Run `Shiro.exe` straight out of that folder. Nothing is installed, nothing in
 * the registry changes, and re-running this script overwrites the folder in
 * place — so a rebuild never disturbs the persistent data, which lives in the
 * per-user app data directory, not here.
 *
 * For the shipping installer use `npm run build:release`.
 *
 * Why the staging step instead of just pointing at `target/release/`: that
 * directory also holds hundreds of megabytes of Rust `.rlib`/`.pdb`/`.d` build
 * artefacts, so it is impossible to tell at a glance whether the payload is
 * complete. Staging copies exactly the files `tauri.conf.json` declares, which
 * keeps this output and the installer from drifting apart.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { dataDir, declaredResources, projectRoot as root, tauriDir } from './lib/tauri-config.mjs';

const releaseDir = path.join(tauriDir, 'target', 'release');
const stageDir = path.join(root, 'dist-fast', 'Shiro');
const exeSuffix = process.platform === 'win32' ? '.exe' : '';

const nodeBin = process.execPath;
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const tauriCli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

/** The bundled executable. Tauri names it after the crate; the installer ships it as `Shiro`. */
const BUILT_EXECUTABLE = `shiro-desktop${exeSuffix}`;
const STAGED_EXECUTABLE = `Shiro${exeSuffix}`;

function step(label, script, args) {
  console.log(`\n=== ${label} ===`);
  const started = Date.now();
  const result = spawnSync(nodeBin, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
  console.log(`--- ${label} ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

/**
 * The shipping config is the single source of truth for the app's identity and
 * its payload — see `lib/tauri-config.mjs`. Nothing about either is restated here.
 */

function stage() {
  console.log('\n=== staging the portable folder ===');
  rmSync(path.dirname(stageDir), { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  const built = path.join(releaseDir, BUILT_EXECUTABLE);
  if (!existsSync(built)) {
    throw new Error(`missing ${built} — the Tauri build did not produce it`);
  }
  cpSync(built, path.join(stageDir, STAGED_EXECUTABLE));

  const missing = [];
  for (const [source, destination] of declaredResources()) {
    const from = path.resolve(tauriDir, source);
    if (!existsSync(from)) {
      missing.push(source);
      continue;
    }
    const to = path.resolve(stageDir, destination);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
  if (missing.length > 0) {
    throw new Error(
      `these declared resources do not exist, so the build would ship broken:\n  ${missing.join('\n  ')}`
    );
  }
  return declaredResources().length + 1;
}

function directorySize(directory) {
  let total = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) total += statSync(full).size;
    }
  };
  walk(directory);
  return total;
}

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main() {
  if (!existsSync(tauriCli)) {
    throw new Error(`the Tauri CLI is missing at ${tauriCli} — run \`npm install\``);
  }

  // 1. Typecheck and bundle the frontend. These assets are embedded in the
  //    executable, so this must run before the Rust build.
  step('typecheck', tscBin, ['--noEmit', '--pretty', 'false']);
  step('frontend', viteBin, ['build']);
  // 2. Produce the backend payload (bundle + self-contained executable) that
  //    the app launches as a sidecar.
  step('backend payload', viteBin, ['build', '--config', 'vite.server.config.ts']);
  step('backend executable', path.join(root, 'scripts', 'build-server-sea.mjs'), []);

  // 3. Compile the shell and skip packaging entirely. `beforeBuildCommand` is
  //    blanked in the overlay config so steps 1-2 are not repeated here.
  step('tauri build (no installer)', tauriCli, [
    'build',
    '--config',
    'src-tauri/tauri.nobundle.conf.json'
  ]);

  const staged = stage();
  const size = directorySize(stageDir);

  console.log('\n=== fast build ready ===');
  console.log(`  folder : ${stageDir}`);
  console.log(`  run    : ${path.join(stageDir, STAGED_EXECUTABLE)}`);
  console.log(`  files  : ${staged}`);
  console.log(`  size   : ${megabytes(size)}`);
  console.log(`  data   : ${dataDir()}  (persistent — builds never touch it)`);
  console.log(memoryServiceReport());
  console.log('For the shipping installer, run `npm run build:release`.');
}

/**
 * The memory service is a Python sidecar with its own dependencies, and a build
 * never touches it. Say whether this machine can actually start it, instead of
 * leaving the next 503 to be rediscovered from `backend.log`.
 */
function memoryServiceReport() {
  const venv = path.join(dataDir(), '.venv-memory');
  if (existsSync(venv)) return `  memory : ${venv} found — the Python memory service can start`;
  return [
    `  memory : no interpreter at ${venv}`,
    '           until one exists, the packaged app answers 503 on /api/memory/*',
    '           and /api/chat/history. Create it once (survives reinstalls):',
    `           robocopy .venv-memory "${venv}" /E /MT:16`,
    '           …or set SHIRO_PYTHON to an interpreter that has the dependencies.'
  ].join('\n');
}

try {
  main();
} catch (error) {
  console.error(`\n[build:fast] failed: ${error.message}`);
  process.exit(1);
}
