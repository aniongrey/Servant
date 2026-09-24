import { describe, expect, it } from 'vitest';
import { buildRealtimeWebSocketUrlCandidates } from './RealtimeGatewayClient';

describe('buildRealtimeWebSocketUrlCandidates', () => {
  it('prefers the page-origin gateway and falls back to the local gateway port', () => {
    expect(
      buildRealtimeWebSocketUrlCandidates('http://127.0.0.1:4173/pages/realtime-test.html')
    ).toEqual([
      'ws://127.0.0.1:4173/api/realtime/ws',
      'ws://127.0.0.1:5174/api/realtime/ws'
    ]);
    expect(buildRealtimeWebSocketUrlCandidates('http://localhost:5173/pages/desktop.html')).toEqual([
      'ws://localhost:5173/api/realtime/ws',
      'ws://127.0.0.1:5174/api/realtime/ws'
    ]);
    // LAN clients reach the gateway through the same origin as the page.
    expect(buildRealtimeWebSocketUrlCandidates('http://192.168.1.5:5173/pages/desktop.html')).toEqual([
      'ws://192.168.1.5:5173/api/realtime/ws',
      'ws://127.0.0.1:5174/api/realtime/ws'
    ]);
  });

  it('uses the same-origin secure gateway for hosted deployments', () => {
    expect(buildRealtimeWebSocketUrlCandidates('https://servant.example/pages/desktop.html')).toEqual([
      'wss://servant.example/api/realtime/ws',
      'ws://127.0.0.1:5174/api/realtime/ws'
    ]);
  });

  it('ranks the packaged Tauri gateway port ahead of the dev port', () => {
    expect(
      buildRealtimeWebSocketUrlCandidates('http://tauri.localhost/pages/desktop.html', 5174, 49152)
    ).toEqual(['ws://127.0.0.1:49152/api/realtime/ws', 'ws://127.0.0.1:5174/api/realtime/ws']);
    expect(
      buildRealtimeWebSocketUrlCandidates('tauri://localhost/pages/desktop.html', 5174, 49152)
    ).toEqual(['ws://127.0.0.1:49152/api/realtime/ws', 'ws://127.0.0.1:5174/api/realtime/ws']);
  });

  it('ranks the packaged backend ahead of the Tauri gateway', () => {
    // The packaged page lives on `tauri.localhost`, so no page-relative
    // candidate can reach the backend. Only the sidecar's absolute URL can,
    // and it must win over the Tauri gateway, which serves a subset of the
    // realtime features (no chat turns).
    expect(
      buildRealtimeWebSocketUrlCandidates(
        'http://tauri.localhost/pages/desktop.html',
        5174,
        49152,
        'ws://127.0.0.1:51234/api/realtime/ws'
      )
    ).toEqual([
      'ws://127.0.0.1:51234/api/realtime/ws',
      'ws://127.0.0.1:49152/api/realtime/ws',
      'ws://127.0.0.1:5174/api/realtime/ws'
    ]);
  });

  it('keeps the tauri dev webview on its page-origin gateway first', () => {
    expect(
      buildRealtimeWebSocketUrlCandidates('http://localhost:5173/pages/desktop.html', 5174, 49152)
    ).toEqual([
      'ws://localhost:5173/api/realtime/ws',
      'ws://127.0.0.1:49152/api/realtime/ws',
      'ws://127.0.0.1:5174/api/realtime/ws'
    ]);
  });

  it('deduplicates candidates and handles missing page urls', () => {
    expect(buildRealtimeWebSocketUrlCandidates(undefined)).toEqual([
      'ws://127.0.0.1:5174/api/realtime/ws'
    ]);
    expect(buildRealtimeWebSocketUrlCandidates('http://127.0.0.1:5174/app')).toEqual([
      'ws://127.0.0.1:5174/api/realtime/ws'
    ]);
  });
});
