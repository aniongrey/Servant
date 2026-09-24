import ReactDOM from 'react-dom/client';
import { DesktopPet } from '../ui/DesktopPet';
import { useUiTheme } from './settings/useUiTheme';
import '../ui/styles.css';
import '../ui/companion-theme.css';
import { installBrowserRuntimeLogging } from './logging/browserRuntimeLogging';
import { ensureApiBase } from './network/apiBase';

installBrowserRuntimeLogging();

async function main() {
  // Same handshake as `main.tsx`: the pet window drives TTS, the realtime
  // gateway and the desktop-character API, so it must know whether `/api/*`
  // belongs to the page origin (development) or to the sidecar's loopback port
  // (packaged) before the first of those effects runs.
  await ensureApiBase().catch(() => undefined);
  function DesktopApp() {
    useUiTheme();
    return <DesktopPet />;
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<DesktopApp />);
}

void main();
