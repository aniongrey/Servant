/**
 * Resolves files inside a provisioned resource directory.
 *
 * Downloaded models live in a directory the user chose, which the webview has no
 * URL for: in the packaged app the page is served by Tauri's asset protocol from
 * the install directory, so a file that is not part of the bundle is simply
 * unreachable from the browser. The backend is therefore the only way the
 * sherpa-onnx worker can fetch a model the user downloaded — hence this module.
 *
 * Roots are searched in the order `provisioningStore.resourceRoots()` returns:
 * the download root first, then the manifest's mirrors, then the per-user shared
 * model roots. That one rule covers four cases at once:
 *
 * 1. a downloaded model wins over any older copy;
 * 2. files no repository carries (the Silero VAD models come from the sherpa-onnx
 *    release, not from the SenseVoice repo) resolve from the bundled runtime;
 * 3. a model that predates the configurable download root still loads;
 * 4. a model another Servant build on this machine downloaded still loads — the
 *    worker asks this route, not the filesystem, so a shared root is only useful
 *    if the route searches it.
 */

import { statSync } from 'node:fs';
import path from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.onnx': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

export function contentTypeOf(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Splits a request path into safe segments.
 *
 * Returns `null` for anything that could escape a resource directory. The check
 * is an allow-list rather than a `..` filter so URL-encoded separators
 * (`%2e%2e%2f`, which Node hands over still encoded) cannot smuggle a traversal
 * past it either.
 */
export function safeRelativeSegments(requestPath: string): string[] | null {
  const segments = requestPath.split('/');
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') return null;
    if (segment.includes('\\')) return null;
  }
  return segments;
}

export interface ResolvedAsset {
  absolutePath: string;
  sizeBytes: number;
  contentType: string;
  /** Which root answered — surfaced for diagnostics. */
  root: string;
}

/**
 * Locates `requestPath` under the first root that has it. Returns `null` when it
 * is absent everywhere, or when the request tried to escape a root.
 */
export function resolveResourceAsset(roots: readonly string[], requestPath: string): ResolvedAsset | null {
  const segments = safeRelativeSegments(requestPath);
  if (!segments) return null;

  for (const root of roots) {
    const base = path.resolve(root);
    const candidate = path.join(base, ...segments);
    // Defence in depth on top of `safeRelativeSegments`.
    if (candidate !== base && !candidate.startsWith(base + path.sep)) return null;
    try {
      const info = statSync(candidate);
      if (info.isFile()) {
        return {
          absolutePath: candidate,
          sizeBytes: info.size,
          contentType: contentTypeOf(candidate),
          root: base
        };
      }
    } catch {
      // Missing in this root; try the next one.
    }
  }
  return null;
}
