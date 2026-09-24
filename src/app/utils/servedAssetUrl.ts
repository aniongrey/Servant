/**
 * `default-character.json` names a bundled asset by the path the page serves it
 * from (`/assets/character/x.vrm`), while `import.meta.glob` reports the same
 * file as `/public/assets/character/x.vrm` — a path that only exists in the dev
 * server, and percent-encodes non-ASCII names. Normalizing to the served form
 * keeps bundled-asset lookups working in dev, in `vite preview` and in the
 * packaged app, where `dist/` only holds `/assets/...`.
 *
 * Lives here rather than next to the VRM models so that every asset domain (VRM,
 * VRMA, …) can share one implementation without importing another domain.
 */
export function toServedAssetUrl(url: string): string {
  let path = url;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Not percent-encoded — keep the raw path.
  }
  return path.replace(/^\/public(?=\/)/, '');
}
