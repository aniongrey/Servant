import { expect, it, vi } from 'vitest';
import { voiceInputTransport } from './voiceInputTransport';

const native = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const validate = (name: string) => {
    if (!/^[A-Za-z0-9_:/-]+$/.test(name)) throw new Error(`Invalid Tauri event name: ${name}`);
  };
  const emit = async (name: string, payload: unknown) => {
    validate(name);
    listeners.get(name)?.({ payload });
  };
  return {
    listen: async (name: string, callback: (event: { payload: unknown }) => void) => {
      validate(name);
      listeners.set(name, callback);
      return () => { listeners.delete(name); };
    },
    emit,
    emitTo: async (target: string, name: string, payload: unknown) => {
      if (target !== 'voice') throw new Error('Voice command sent to wrong window');
      await emit(name, payload);
    }
  };
});
vi.mock('../../desktop/tauri/navigation', () => ({ isTauriDesktop: () => true }));
vi.mock('@tauri-apps/api/event', () => native);

it('connects native pages to the voice host using valid Tauri events in both directions', async () => {
  const commands = vi.fn();
  const events = vi.fn();
  const host = await voiceInputTransport(true, commands);
  const client = await voiceInputTransport(false, events);
  try {
    client.send({ type: 'press', id: 'meeting' });
    client.send({ type: 'release', id: 'meeting' });
    expect(commands.mock.calls).toEqual([
      [{ type: 'press', id: 'meeting' }],
      [{ type: 'release', id: 'meeting' }]
    ]);
    host.send({ type: 'stopped' });
    expect(events).toHaveBeenCalledWith({ type: 'stopped' });
  } finally {
    client.close();
    host.close();
  }
});
