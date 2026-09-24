import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VisemeAnalyzerTap } from './lipSync/visemeAnalyzer';

const state = vi.hoisted(() => ({
  outputDeviceId: '',
  tap: null as VisemeAnalyzerTap | null
}));

vi.mock('../voice/VoiceSettings', () => ({
  loadVoiceSettings: () => ({ outputDeviceId: state.outputDeviceId })
}));
vi.mock('./lipSync/visemeAnalyzer', () => ({
  attachVisemeAnalyzerTo: () => state.tap
}));

import { playAudioBytes } from './audioPlayback';

/**
 * Playback and the viseme analyser share one element, and the sharing has to be
 * invisible: an element routed through the analyser graph is rendered by that
 * context, so the element's own `setSinkId` must stop being used — otherwise a
 * user with a selected output device gets their speech on the wrong one, which
 * is exactly the kind of bug nobody hears in a test run.
 */
class FakeAudio {
  static last: FakeAudio | undefined;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  duration = 3;
  played = false;
  readonly sinkIds: string[] = [];

  constructor() {
    FakeAudio.last = this;
  }

  play(): Promise<void> {
    this.played = true;
    return Promise.resolve();
  }

  pause(): void {}

  removeAttribute(): void {}

  setSinkId(sinkId: string): Promise<void> {
    this.sinkIds.push(sinkId);
    return Promise.resolve();
  }
}

beforeEach(() => {
  FakeAudio.last = undefined;
  state.outputDeviceId = '';
  state.tap = null;
  vi.stubGlobal('Audio', FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('routes the output device through the element when nothing analyses the line', async () => {
  state.outputDeviceId = 'speaker-2';

  const playback = startPlayback();
  const audio = await startedAudio();

  expect(audio.sinkIds).toEqual(['speaker-2']);
  finishAudio(audio);
  await playback;
});

it('hands output routing to the analyser and releases the element when the line ends', async () => {
  state.outputDeviceId = 'speaker-2';
  const detach = vi.fn();
  state.tap = { ready: Promise.resolve(), detach };

  const playback = startPlayback();
  const audio = await startedAudio();

  // The graph renders the audio now: a leftover element sink would fight it.
  expect(audio.sinkIds).toEqual([]);
  expect(detach).not.toHaveBeenCalled();

  finishAudio(audio);
  await playback;

  expect(detach).toHaveBeenCalledOnce();
});

it('settles routing before the first sound instead of cutting it off', async () => {
  let releaseRouting!: () => void;
  state.tap = {
    ready: new Promise<void>((resolve) => {
      releaseRouting = resolve;
    }),
    detach: vi.fn()
  };

  const playback = startPlayback();
  await Promise.resolve();
  await Promise.resolve();

  expect(FakeAudio.last?.played).toBe(false);

  releaseRouting();
  const audio = await startedAudio();
  finishAudio(audio);
  await playback;
});

function startPlayback(): Promise<void> {
  return playAudioBytes({
    bytes: new Uint8Array([1, 2, 3]),
    mediaType: 'audio/mpeg',
    signal: new AbortController().signal
  });
}

async function startedAudio(): Promise<FakeAudio> {
  await vi.waitFor(() => expect(FakeAudio.last?.played).toBe(true));
  return FakeAudio.last as FakeAudio;
}

function finishAudio(audio: FakeAudio): void {
  audio.onended?.();
}
