import { builtinModules } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Builds the standalone Servant backend (`src/server/index.ts`) into one file that
 * Tauri can launch as a sidecar.
 *
 * Everything except Node built-ins is inlined. The packaged app ships no
 * `node_modules` next to the executable, so a bundle that still imports a
 * dependency would start fine in development and die in the installer — the
 * exact class of drift this build exists to prevent.
 *
 * The output is CommonJS on purpose. Node's single-executable-application
 * support embeds its entry point as CJS and ignores ESM entry points entirely
 * (Node 22 and 24 both fail with `Cannot use import statement outside a
 * module`), so an ESM bundle could never become a standalone executable.
 *
 * Output: `src-tauri/binaries/servant-server.cjs`.
 */
export default defineConfig({
  // Without this Vite copies the whole of `public/` (≈1 GB of models and motion
  // assets) into `outDir`. The backend bundle is a single self-contained file
  // and needs none of it.
  publicDir: false,
  build: {
    outDir: path.resolve(process.cwd(), 'src-tauri/binaries'),
    // The same directory also holds the packaged runtime, so never wipe it.
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    sourcemap: false,
    ssr: path.resolve(process.cwd(), 'src/server/index.ts'),
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
      output: {
        format: 'cjs',
        entryFileNames: 'servant-server.cjs',
        codeSplitting: false
      }
    }
  },
  ssr: {
    noExternal: true,
    target: 'node'
  }
});
