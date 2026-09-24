import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockAudio() {
  const sources: Array<{
    buffer: unknown;
    onended: (() => void) | null;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const context = {
    state: 'running',
    destination: {},
    decodeAudioData: vi.fn(async (data: ArrayBuffer) => ({ data })),
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    close: vi.fn(),
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null as unknown,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn()
      };
      sources.push(source);
      return source;
    })
  };
  const constructor = vi.fn(function () {
    return context;
  });
  vi.stubGlobal('AudioContext', constructor);
  const fetch = vi.fn(async (_url: string) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal('fetch', fetch);
  return { sources, context, constructor, fetch };
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('resident head touch audio', () => {
  it('preloads and decodes all sounds once and starts directly from memory after idle', async () => {
    vi.useFakeTimers();
    const { sources, context, constructor, fetch } = mockAudio();
    const { createHeadTouchFeedback } = await import('./headTouchAudio');
    const feedback = createHeadTouchFeedback();
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(fetch.mock.calls.map((args) => args[0])).toContain('/assets/fx/iron-basin-hit.wav');
    await feedback.ready;
    expect(context.decodeAudioData).toHaveBeenCalledTimes(7);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    feedback.play();
    expect(sources[0].start).toHaveBeenCalledOnce();
    expect(feedback.isPlaying()).toBe(true);
    sources[0].onended?.();
    expect(feedback.isPlaying()).toBe(false);

    vi.advanceTimersByTime(120_000);
    feedback.play();
    expect(sources[1].buffer).toBe(sources[0].buffer);
    expect(sources[1].start).toHaveBeenCalledOnce();
    vi.mocked(Math.random).mockReturnValue(0);
    feedback.play(); // The rare MP3 is resident too.
    expect(sources[2].start).toHaveBeenCalledOnce();
    feedback.playProtected();
    expect(sources[3].start).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(7);
    expect(constructor).toHaveBeenCalledOnce();
    feedback.dispose();
  });

  it('retains the bank across remounts and only stops playback owned by the disposed stage', async () => {
    const { sources, context, fetch } = mockAudio();
    const { createHeadTouchFeedback } = await import('./headTouchAudio');
    const first = createHeadTouchFeedback();
    const second = createHeadTouchFeedback();
    await first.ready;
    first.play();
    second.play();
    first.dispose();
    expect(sources[0].stop).toHaveBeenCalledOnce();
    expect(sources[1].stop).not.toHaveBeenCalled();
    expect(second.isPlaying()).toBe(true);
    expect(context.close).not.toHaveBeenCalled();
    const remounted = createHeadTouchFeedback();
    remounted.playProtected();
    expect(sources[2].start).toHaveBeenCalledOnce();
    expect(remounted.isPlaying()).toBe(false); // Metal impact does not animate speech.
    expect(fetch).toHaveBeenCalledTimes(7);
    second.dispose();
    remounted.dispose();
  });

  it('resumes a suspended context and cancels pending playback when its stage is disposed', async () => {
    const { sources, context } = mockAudio();
    context.state = 'suspended';
    const { createHeadTouchFeedback } = await import('./headTouchAudio');
    const feedback = createHeadTouchFeedback();
    feedback.play();
    expect(context.resume).toHaveBeenCalledOnce();
    feedback.dispose();
    await feedback.ready;
    await Promise.resolve();
    expect(sources).toHaveLength(0);
  });
});
