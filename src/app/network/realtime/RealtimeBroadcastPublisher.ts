import { RealtimeGatewayClient } from './RealtimeGatewayClient.ts';

let publisherClient: RealtimeGatewayClient | undefined;

/**
 * Shared one-way publisher for clients that only push commands to the gateway
 * (status pings, voice broadcasts, tool results). Keeps a single lazily
 * created connection per page and retries once the gateway is ready.
 */
export function publishRealtimeCommand(feature: string, action: string, payload: unknown): void {
  const client = publisherClient ?? (publisherClient = new RealtimeGatewayClient());
  if (client.sendCommand(feature, action, payload)) return;
  client.connect();
  let timeout: number | undefined;
  const offReady = client.onReady(() => {
    if (timeout !== undefined) window.clearTimeout(timeout);
    offReady();
    client.sendCommand(feature, action, payload);
  });
  timeout = window.setTimeout(offReady, 8_000);
}
