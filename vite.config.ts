import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CROSS_ORIGIN_ISOLATION_HEADERS } from './vite.shared.ts';

const PUBLIC_ASSETS_MODULE = 'virtual:servant-public-assets';
const RESOLVED_PUBLIC_ASSETS_MODULE = `\0${PUBLIC_ASSETS_MODULE}`;

function publicAssetsModule() {
  const listFiles = (directory: string, extensions: Set<string>): string[] => {
    const absolute = path.resolve('public', directory);
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(relative, extensions);
      return extensions.has(path.extname(entry.name).toLowerCase()) ? [`/public/${relative}`] : [];
    });
  };

  return {
    name: 'servant-public-assets',
    resolveId(id: string) {
      return id === PUBLIC_ASSETS_MODULE ? RESOLVED_PUBLIC_ASSETS_MODULE : null;
    },
    load(id: string) {
      if (id !== RESOLVED_PUBLIC_ASSETS_MODULE) return null;
      const vrma = listFiles('assets/motions/vrma', new Set(['.vrma']));
      const character = listFiles('assets/character', new Set(['.vrm', '.pmx', '.pmd']));
      return `export const bundledVrmaPaths = ${JSON.stringify(vrma)};\nexport const bundledCharacterPaths = ${JSON.stringify(character)};`;
    }
  };
}

/**
 * UI config: the dev server and the frontend bundle.
 *
 * It deliberately knows nothing about the backend. Vite treats every static
 * import of the config as a config dependency, so a config that imported
 * `apiModules.ts` would restart the whole dev server — dropping the HMR state
 * and every open WebSocket — on each edit to a backend file. Backend code is
 * the thing being iterated on most, so it must not be able to reach this graph.
 *
 * Where `/api/*` is served instead:
 * - development: `scripts/dev.mjs` runs the real backend on {@link DEV_BACKEND_PORT}
 *   and this config proxies to it (see `server.proxy` below);
 * - `vite preview`: `vite.preview.config.ts` mounts the API modules in-process;
 * - packaged app: the `servant-server` sidecar, reached through `apiBase.ts`.
 */
const DEV_BACKEND_PORT = Number.parseInt(process.env.SERVANT_DEV_BACKEND_PORT ?? '5174', 10);

/**
 * Every secondary page lives in `pages/`; the repository root keeps only
 * `index.html` (the app shell) and `pages.html` (the navigation page). All 16
 * secondary pages are real rollup inputs, including the four shells the Tauri
 * windows load by name — `desktop`, `chat`, `settings`, `debug` — because
 * `desktop_windows.rs` asks the asset protocol for those exact files.
 */
const pageEntry = (name: string) => path.resolve(process.cwd(), 'pages', `${name}.html`);

const SECONDARY_PAGES = [
  'chat-tool-debug',
  'chat',
  'magic-circle-demo',
  'meeting',
  'voice',
  'debug',
  'desktop',
  'emotion-test',
  'gpt-sovits',
  'interaction-test',
  'live-test',
  'llm-latency-test',
  'memory-test',
  'micro-dynamics-test',
  'realtime-test',
  'setup',
  'settings',
  'soul-test',
  'ws-monitor'
] as const;

export default defineConfig({
  plugins: [react(), publicAssetsModule()],
  build: {
    rollupOptions: {
      input: {
        pages: path.resolve(process.cwd(), 'pages.html'),
        app: path.resolve(process.cwd(), 'index.html'),
        ...Object.fromEntries(SECONDARY_PAGES.map((name) => [name, pageEntry(name)]))
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: CROSS_ORIGIN_ISOLATION_HEADERS,
    // `ws: true` carries the realtime gateway too, so a page opened on the dev
    // server reaches `chat.turn` / `action.voice` / `web.search` as well as the
    // plain HTTP API.
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${DEV_BACKEND_PORT}`,
        changeOrigin: false,
        ws: true
      }
    }
  },
  preview: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
