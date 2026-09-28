import { describe, expect, it, vi } from 'vitest';
import type { SpeechRecognitionCallbacks, SpeechRecognizer } from '../stt/speechRecognitionTypes';
import { VoiceInputRuntime } from './VoiceInputRuntime';
import { defaultVoiceSettings, normalizeVoiceSettings, type VoiceSettings } from './VoiceSettings';
import {
  isVoiceCommand,
  selectVoiceEndpoint,
  type VoiceEndpoint,
  type VoiceEvent,
  type VoiceTarget
} from './VoiceInputProtocol';

const target: VoiceTarget = {
  page: 'meeting',
  sessionId: 'meeting-a',
  characterId: 'alice',
  label: '陪玩 · Alice'
};
const endpoint = (id = 'a', focused = true, t = target): VoiceEndpoint => ({
  id,
  focused,
  target: t,
  updatedAt: 1000
});

async function setup(patch: Partial<VoiceSettings> = {}) {
  let now = 1000;
  let callbacks: SpeechRecognitionCallbacks = { onTranscript: () => {}, onError: () => {} };
  let started = false;
  const recognizer: SpeechRecognizer = {
    isSupported: () => true,
    isReady: () => true,
    preload: async () => {},
    listen: async () => '',
    startContinuous: vi.fn((next) => {
      callbacks = next;
      started = false;
    }),
    finishCurrentUtterance: vi.fn(() => {
      if (started) callbacks.onSpeechEnd?.();
      return started;
    }),
    pauseCapture: vi.fn(),
    abort: vi.fn(),
    destroy: vi.fn()
  };
  const events: VoiceEvent[] = [];
  const settings = { ...defaultVoiceSettings, backgroundEnabled: false, ...patch };
  const runtime = new VoiceInputRuntime(
    recognizer,
    settings,
    (event) => events.push(structuredClone(event)),
    () => now
  );
  await runtime.preload();
  runtime.register(endpoint());
  await runtime.activate();
  return {
    runtime,
    recognizer,
    events,
    settings,
    get callbacks() {
      return callbacks;
    },
    start: () => {
      started = true;
      callbacks.onStarted?.();
      callbacks.onSpeechStart?.();
    },
    finish: (text = '你好') => {
      callbacks.onTranscript(text, true);
      callbacks.onEnd?.();
    },
    advance: (ms: number) => {
      now += ms;
      runtime.tick();
    }
  };
}

describe('shared voice input', () => {
  it('defaults to draft-only, muted during playback, with automatic background routing', () => {
    expect(normalizeVoiceSettings({})).toMatchObject({
      autoSend: false,
      muteWhileSpeaking: true,
      interruptOnSpeech: true,
      backgroundEnabled: true
    });
    expect(isVoiceCommand({ type: 'endpoint', endpoint: { ...endpoint(), target: { page: 'other' } } })).toBe(
      false
    );
  });

  it('a quick release cancels pending startup and ignores late callbacks', async () => {
    const s = await setup();
    s.runtime.press();
    const old = s.callbacks;
    s.runtime.release();
    expect(s.runtime.state.phase).toBe('idle');
    old.onStarted?.();
    old.onTranscript('迟到', true);
    expect(s.runtime.state.phase).toBe('idle');
    expect(s.runtime.state.pending).toEqual([]);
    expect(s.recognizer.abort).toHaveBeenCalled();
  });

  it('repeat press cannot toggle recording; release always finalizes even under 250 ms', async () => {
    const s = await setup();
    s.runtime.press();
    s.start();
    s.runtime.press();
    s.advance(50);
    s.runtime.release();
    s.finish();
    expect(s.recognizer.startContinuous).toHaveBeenCalledOnce();
    expect(s.runtime.state.phase).toBe('idle');
    expect(s.events.filter((event) => event.type === 'result')).toMatchObject([
      { result: { text: '你好', autoSend: false } }
    ]);
  });

  it('locks one utterance to its original window while the next press uses new focus', async () => {
    const s = await setup();
    s.runtime.press();
    s.start();
    s.runtime.register(endpoint('a', false));
    s.runtime.register(endpoint('b', true, { ...target, page: 'desktop' }));
    s.runtime.release();
    s.finish();
    expect(s.runtime.state.pending[0].endpointId).toBe('a');
    s.runtime.press();
    s.start();
    s.runtime.release();
    s.finish('第二句');
    expect(s.runtime.state.pending[1].endpointId).toBe('b');
  });

  it('routes background PTT only to the available live target', async () => {
    const s = await setup({ backgroundEnabled: true, autoSend: true });
    s.runtime.register(endpoint('a', false));
    s.runtime.press();
    s.start();
    s.runtime.release();
    s.finish();
    expect(s.runtime.state.pending[0]).toMatchObject({ endpointId: 'a', autoSend: true });
    s.runtime.leave('a');
    s.runtime.press();
    expect(s.recognizer.startContinuous).toHaveBeenCalledOnce();
    expect(s.runtime.state.error).toContain('没有有效');
  });

  it('does not start without an eligible target or reuse stale focus', async () => {
    const s = await setup();
    s.runtime.register(endpoint('a', false));
    s.runtime.press();
    expect(s.recognizer.startContinuous).not.toHaveBeenCalled();
    expect(selectVoiceEndpoint([endpoint()], false, 8000)).toBeUndefined();
  });

  it('retains a result when the original page changes conversations, and recovery never sends', async () => {
    const s = await setup({ autoSend: true });
    s.runtime.press();
    s.start();
    s.runtime.release();
    s.runtime.register(endpoint('a', true, { ...target, sessionId: 'meeting-b' }));
    s.finish();
    expect(s.events.filter((e) => e.type === 'result')).toHaveLength(0);
    const id = s.runtime.state.pending[0].id;
    s.runtime.recover('a', id);
    expect(s.events.at(-1)).toMatchObject({
      type: 'result',
      result: { autoSend: false, target: { sessionId: 'meeting-b' } }
    });
    s.runtime.ack('other', id);
    expect(s.runtime.state.pending).toHaveLength(1);
    s.runtime.ack('a', id);
    expect(s.runtime.state.pending).toHaveLength(0);
  });

  it('pauses free mic for all playing characters, but PTT can interrupt and take over', async () => {
    const s = await setup({ inputMode: 'realtime' });
    s.runtime.playback('alice', true);
    s.runtime.playback('bob', true);
    expect(s.runtime.state.phase).toBe('paused');
    s.runtime.playback('alice', false);
    expect(s.runtime.state.phase).toBe('paused');
    s.runtime.press();
    s.start();
    expect(s.runtime.state.phase).toBe('recording');
    expect(s.events.some((e) => e.type === 'interrupt' && e.target.sessionId === target.sessionId)).toBe(
      true
    );
    s.runtime.release();
    s.finish();
    s.runtime.tick();
    expect(s.runtime.state.phase).toBe('paused');
    s.runtime.playback('bob', false);
    expect(s.runtime.state.phase).toBe('initializing');
  });

  it('free speech interrupts before the transcript, without requiring auto-send', async () => {
    const s = await setup({ inputMode: 'realtime', muteWhileSpeaking: false });
    s.runtime.playback('alice', true);
    s.start();
    expect(s.events.some((e) => e.type === 'interrupt')).toBe(true);
    expect(s.runtime.state.pending).toHaveLength(0);
  });

  it('losing foreground without background permission ends capture as draft', async () => {
    const s = await setup({ autoSend: true });
    s.runtime.press();
    s.start();
    s.runtime.register(endpoint('a', false));
    s.finish();
    expect(s.runtime.state.pending[0].autoSend).toBe(false);
  });

  it('stops realtime capture on focus loss during decoding without discarding the submitted sentence', async () => {
    const s = await setup({ inputMode: 'realtime', autoSend: true });
    s.start();
    s.callbacks.onSpeechEnd?.();
    s.runtime.register(endpoint('a', false));
    expect(s.recognizer.pauseCapture).toHaveBeenCalledOnce();
    s.finish();
    expect(s.runtime.state.pending[0]).toMatchObject({ text: '你好', autoSend: false });
  });

  it('caps held recording and revokes automatic sending when the setting is switched off', async () => {
    const s = await setup({ autoSend: true, backgroundEnabled: true });
    s.runtime.press();
    s.start();
    s.advance(60_000);
    s.finish();
    expect(s.runtime.state.pending[0].autoSend).toBe(false);
    s.runtime.register(endpoint());
    s.runtime.press();
    s.start();
    s.runtime.configure({ ...s.settings, autoSend: false });
    s.runtime.release();
    s.finish();
    expect(s.runtime.state.pending[1].autoSend).toBe(false);
  });

  it('stop prevents global hotkeys from restarting until explicitly activated', async () => {
    const s = await setup();
    s.runtime.stop();
    s.runtime.press();
    expect(s.recognizer.startContinuous).not.toHaveBeenCalled();
    await s.runtime.activate();
    s.runtime.press();
    expect(s.recognizer.startContinuous).toHaveBeenCalledOnce();
  });
});

describe('automatic voice destination', () => {
  it('prefers the focused page, otherwise Galgame then Meeting then Chat; skips stale and closed endpoints', () => {
    const chat = endpoint('chat', false, { ...target, page: 'chat' });
    const meeting = endpoint('meeting', false);
    const stage = endpoint('stage', false, { ...target, page: 'desktop' });
    expect(selectVoiceEndpoint([chat, meeting, stage], true, 1000)?.id).toBe('stage');
    expect(selectVoiceEndpoint([chat, meeting], true, 1000)?.id).toBe('meeting');
    expect(selectVoiceEndpoint([chat], true, 1000)?.id).toBe('chat');
    expect(selectVoiceEndpoint([chat, { ...meeting, focused: true }, stage], true, 1000)?.id).toBe('meeting');
    expect(selectVoiceEndpoint([chat, { ...stage, updatedAt: -6000 }], true, 1000)?.id).toBe('chat');
    expect(selectVoiceEndpoint([chat, meeting, stage], false, 1000)).toBeUndefined();
  });

  it('activation loads the model and arms PTT without a separate preload step', async () => {
    const s = await setup();
    s.runtime.stop();
    s.runtime.state.ready = false;
    await s.runtime.activate();
    s.runtime.press();
    s.start();
    expect(s.runtime.state).toMatchObject({ ready: true, enabled: true, phase: 'recording' });
    s.runtime.release();
    s.finish();
    expect(s.runtime.state.phase).toBe('idle');
  });
});
