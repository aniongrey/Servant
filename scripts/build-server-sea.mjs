#!/usr/bin/env node
/**
 * Turns the built backend bundle into a self-contained executable using Node's
 * single-executable-application support.
 *
 * The packaged app has no Node runtime on the user's machine, so the backend
 * must ship as a real binary. `npm run server:build` already inlined every
 * dependency into `src-tauri/binaries/shiro-server.mjs`; this step welds that
 * bundle into a copy of the Node binary itself.
 *
 * Output: `src-tauri/binaries/shiro-server[.exe]` — the file
 * `src-tauri/src/backend_server.rs` looks for first.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Sentinel fuse embedded in the Node binary that postject replaces with the blob. */
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const binariesDir = path.join(root, 'src-tauri', 'binaries');
const bundlePath = path.join(binariesDir, 'shiro-server.cjs');
const outputPath = path.join(
  binariesDir,
  `shiro-server${process.platform === 'win32' ? '.exe' : ''}`
);
const blobPath = path.join(binariesDir, 'shiro-server.blob');
const configPath = path.join(binariesDir, 'sea-config.json');
const postjectCli = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');

function run(command, args) {
  const result = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.write(result);
}

function main() {
  if (!existsSync(bundlePath)) {
    throw new Error(`missing ${bundlePath} — run \`npm run server:build\` first`);
  }
  if (!existsSync(postjectCli)) {
    throw new Error('postject is not installed — run `npm install`');
  }
  mkdirSync(binariesDir, { recursive: true });

  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        main: bundlePath,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  console.log('[sea] generating the application blob');
  run(process.execPath, ['--experimental-sea-config', configPath]);

  console.log('[sea] copying the Node runtime');
  rmSync(outputPath, { force: true });
  copyFileSync(process.execPath, outputPath);

  if (process.platform === 'darwin') {
    // A signed binary rejects the injected blob; the signature is restored below.
    console.log('[sea] stripping the existing signature');
    execFileSync('codesign', ['--remove-signature', outputPath], { stdio: 'inherit' });
  }

  console.log('[sea] injecting the blob');
  run(process.execPath, [
    postjectCli,
    outputPath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    SEA_FUSE
  ]);

  if (process.platform === 'darwin') {
    console.log('[sea] re-signing');
    execFileSync('codesign', ['--sign', '-', outputPath], { stdio: 'inherit' });
  }

  console.log(`[sea] wrote ${outputPath}`);
  for (const stale of [blobPath, configPath]) rmSync(stale, { force: true });
}

try {
  main();
} catch (error) {
  console.error(`[sea] failed: ${error.message}`);
  if (error.stderr) process.stderr.write(String(error.stderr));
  process.exit(1);
}
