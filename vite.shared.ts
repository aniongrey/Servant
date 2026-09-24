/**
 * Values shared by the Vite configs.
 *
 * This exists so `vite.preview.config.ts` does not have to import
 * `vite.config.ts` — that would drag the dev server's whole config, vitest
 * included, into the preview process for the sake of two header names.
 */

/**
 * Enables `SharedArrayBuffer`, which the sherpa-onnx WASM build needs for its
 * worker threads. Every server that hands the page its HTML has to send these,
 * or ASR silently degrades to a single thread.
 */
export const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
} as const;
