import './studio.css';
import { ensureApiBase, getApiBaseUrl } from '../../app/network/apiBase';

/**
 * Entry point of the GPT-SoVITS studio page.
 *
 * The page itself is a vendored plain-JS prototype (`studio.js`), deliberately
 * left in its own look and feel. What Shiro has to contribute is the backend
 * address: once packaged the API lives on the sidecar's loopback port, so the
 * page must not build `/api/*` URLs against the webview origin. Resolving the
 * base here — before the page runs — is the only integration point it needs.
 */
void (async () => {
  await ensureApiBase();
  (globalThis as { __SHIRO_API_ORIGIN__?: string }).__SHIRO_API_ORIGIN__ = getApiBaseUrl();
  // Vendored page: plain JavaScript on purpose, no types to check here.
  // @ts-ignore -- the studio page is plain JS by design
  await import('./studio.js');
})();
