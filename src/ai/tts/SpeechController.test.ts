import { describe, expect, it, vi } from 'vitest';
import { RuntimeStore } from '../../app/state/RuntimeStore';
import { SpeechController } from './SpeechController';
import { TtsManager } from './TtsManager';

function createSpeech(resolve: (text: string, signal?: AbortSignal) => Promise<string>) {
  const provider = {
    id: 'test',
    isSupported: () => true,
    speak: vi.fn(async (_text: string) => undefined),
    cancel: vi.fn()
  };
  const store = new RuntimeStore();
  const speech = new SpeechController({}, store, 0, new TtsManager(provider, store), resolve);
  return { speech, store, provider };
}

describe('localized fixed speech', () => {
  it('shows display text immediately when streaming with TTS disabled', async () => {
    const store = new RuntimeStore();
    const provider = {
      id: 'disabled',
      isSupported: () => false,
      speak: vi.fn(),
      cancel: vi.fn()
    };
    const speech = new SpeechController({}, store, -1000, new TtsManager(provider, store));
    const turn = speech.startStreaming({ intent: 'conversation_reply' });

    const done = turn.finish('显示中文。', 'translated speech');
    expect(store.getSnapshot().speech).toEqual({
      intent: 'conversation_reply',
      text: '显示中文。',
      speaking: true,
      bubbleVisible: true
    });

    await done;
  });

  it('converts the spoken line and keeps Chinese in the speech bubble', async () => {
    const translate = vi.fn(async () => '頭をなでないで。');
    const { speech, store, provider } = createSpeech(translate);
    await speech.sayLocalizedText('不要摸头。', { intent: 'protect_head' });
    expect(translate).toHaveBeenCalledWith('不要摸头。', expect.any(AbortSignal));
    expect(provider.speak).toHaveBeenCalledWith('頭をなでないで。', expect.any(Object));
    expect(store.getSnapshot().speech).toMatchObject({ text: '不要摸头。', speaking: false });
  });

  it.each(['cancel', 'sayText', 'startStreaming'] as const)(
    'prevents stale translation after %s',
    async (action) => {
      let finish!: (text: string) => void;
      const translate = vi.fn(
        (_text: string, _signal?: AbortSignal) =>
          new Promise<string>((resolve) => {
            finish = resolve;
          })
      );
      const { speech, provider } = createSpeech(translate);
      const pending = speech.sayLocalizedText('旧警告');
      const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      if (action === 'sayText') await speech.sayText('新台词');
      else if (action === 'startStreaming') speech.startStreaming().cancel();
      else speech.cancel();
      finish('古い警告');
      await rejection;
      expect(translate.mock.calls[0][1]?.aborted).toBe(true);
      expect(provider.speak.mock.calls.map(([text]) => text)).not.toContain('古い警告');
    }
  );
});
