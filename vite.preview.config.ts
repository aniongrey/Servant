import { defineConfig } from 'vite';
import { createApiModules } from './src/app/network/server/apiModules.ts';
import { CROSS_ORIGIN_ISOLATION_HEADERS } from './vite.shared.ts';

/**
 * Preview config: serves the built `dist/` **and** the backend, in one process.
 *
 * `vite preview` is what the desktop shell connects to under
 * `npm run desktop:serve` / `npm run tauri:fast`, so this is the one place where
 * the API modules have to be mounted in-process — there is no separate backend
 * process in that flow.
 *
 * It lives in its own config on purpose. `vite.config.ts` is imported by the dev
 * server, which watches every module it statically imports as a config
 * dependency; keeping `apiModules.ts` out of that graph is what stops a backend
 * edit from restarting the frontend dev server.
 *
 * Note this does not watch: backend changes need a restart of this command.
 * Use `npm run dev` when iterating on the backend.
 */
export default defineConfig({
  plugins: createApiModules({ installRuntimeLogging: true }).modules,
  preview: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS
  }
});
