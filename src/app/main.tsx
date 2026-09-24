import ReactDOM from 'react-dom/client';
import type { ComponentType } from 'react';
import { useUiTheme } from './settings/useUiTheme';
import '../ui/styles.css';
import '../ui/companion-theme.css';
import { installBrowserRuntimeLogging } from './logging/browserRuntimeLogging';
import { ensureApiBase } from './network/apiBase';

installBrowserRuntimeLogging();

async function loadRootApp(): Promise<ComponentType> {
  const view = new URLSearchParams(window.location.search).get('view');
  const page = currentPageName();
  if (view === 'desktop-menu') return (await import('../ui/DesktopMenu')).DesktopMenuPage;
  if (view === 'debug' || page === 'debug') return (await import('../ui/App')).App;
  switch (page) {
    case 'emotion-test':
      return (await import('../ui/emotion-test/EmotionTestPage')).EmotionTestPage;
    case 'realtime-test':
      return (await import('../ui/realtime/RealtimeTestPage')).RealtimeTestPage;
    case 'ws-monitor':
      return (await import('../ui/ws-monitor/WsMonitorPage')).WsMonitorPage;
    case 'desktop':
      return (await import('../ui/DesktopPet')).DesktopPet;
    case 'chat':
      return (await import('../ui/test-pages/ChatTestPage')).ChatTestPage;
    case 'memory-test':
      return (await import('../ui/memory-test/MemoryTestPage')).MemoryTestPage;
    case 'soul-test':
      return (await import('../ui/test-pages/SoulStateTestPage')).SoulStateTestPage;
    case 'setup':
      return (await import('./provisioning/SetupWizard')).SetupWizard;
    default:
      break;
  }
  if (/^vrma?-editor$/.test(page)) return (await import('../ui/VrmaSegmentPage')).VrmaSegmentPage;
  return (await import('../ui/UserInterfaceApp')).UserInterfaceApp;
}

/**
 * Page identity is the last path segment with its extension stripped, so a shell
 * keeps its route wherever it lives: `/chat`, `/chat.html` and
 * `/pages/chat.html` all resolve to `chat`. Every secondary page lives
 * in `pages/` (only `index.html` and `pages.html` stay at the root), so the
 * extension-less forms rely on the dev server's SPA fallback and on the packaged
 * asset protocol, which answers unknown paths with `index.html`.
 */
function currentPageName(): string {
  const segments = window.location.pathname.split('/').filter(Boolean);
  return (segments.pop() ?? '').replace(/\.html?$/i, '');
}

async function main() {
  // Resolve the backend origin before the first render. A page that mounts and
  // immediately calls `/api/*` must already know whether it is talking to the
  // page origin (development) or to the sidecar's loopback port (packaged);
  // guessing wrong returns `index.html` instead of JSON.
  await ensureApiBase().catch(() => undefined);
  const RootApp = await loadRootApp();
  function ThemedApp() {
    useUiTheme();
    return <RootApp />;
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<ThemedApp />);
}

void main();
