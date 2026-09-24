import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural guard for the rule that decides whether the packaged app works.
 *
 * The backend is a sidecar on a random loopback port once packaged, while the
 * page origin belongs to Tauri's asset protocol. A page-relative `/api/*` fetch
 * is therefore answered with the SPA's `index.html`, and `response.json()` dies
 * with `Unexpected token '<'`. Nothing throws at the call site — the UI just
 * spins — so the mistake survives review, the dev server (where relative URLs
 * are correct) and every end-to-end test that talks to the backend directly.
 * It has shipped twice: once for the chat/LLM path, once with the character
 * card stuck on "正在从服务端加载角色卡…".
 *
 * Rather than trusting reviewers to remember, this test asserts that every
 * frontend file pairing `fetch(` with an `/api/` path routes through
 * `backendFetch` (or `createGlobalNetworkFetch` when it also has to relay
 * third-party requests).
 */

const sourceRoot = path.resolve(process.cwd(), 'src');

/**
 * Backend-side code shares the `src/` tree but runs in Node, where relative
 * `/api/*` paths never happen and the resolver is meaningless.
 */
const backendOnly = [
  path.join('app', 'network', 'server'),
  'server',
  path.join('app', 'network', 'memoryServiceApi.ts')
];

/** The resolver layer itself: these define the rule instead of following it. */
const exemptFiles = [
  path.join('app', 'network', 'apiBase.ts'),
  path.join('app', 'network', 'backendFetch.ts'),
  path.join('app', 'network', 'globalNetworkFetch.ts')
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

function isBackendOnly(relative: string): boolean {
  return backendOnly.some((prefix) => relative === prefix || relative.startsWith(`${prefix}${path.sep}`));
}

describe('frontend API call sites', () => {
  it('route every /api/* fetch through the backend-aware transport', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(sourceRoot)) {
      const relative = path.relative(sourceRoot, file);
      if (isBackendOnly(relative) || exemptFiles.includes(relative)) continue;

      const source = readFileSync(file, 'utf8');
      if (!source.includes('fetch(') || !/['"`]\/api\//.test(source)) continue;

      if (!source.includes('backendFetch') && !source.includes('createGlobalNetworkFetch')) {
        offenders.push(relative);
      }
    }

    expect(
      offenders,
      'these files call the backend without resolving the sidecar origin; ' +
        'use `backendFetch(path)` from src/app/network/backendFetch.ts'
    ).toEqual([]);
  });

  it('keeps the character card on the backend-aware transport', () => {
    // The regression that motivated the rule above. Kept as its own case so a
    // failure names the user-visible symptom instead of a file list.
    const source = readFileSync(
      path.resolve(sourceRoot, 'ai', 'personality', 'CharacterSkill.ts'),
      'utf8'
    );
    expect(source).toMatch(/backendFetch\(/);
    expect(source).not.toMatch(/await fetch\(/);
  });
});
