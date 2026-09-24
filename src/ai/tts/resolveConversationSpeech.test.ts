import { describe, expect, it, vi } from 'vitest';
import { getSpokenReplySegments } from './resolveConversationSpeech';

const replies = [
  { speech: '你好。', emotion: 'happy' as const, intensity: 0.6, shortAction: 'hesitate' },
  { speech: '我有点难过。', emotion: 'sad' as const, intensity: 0.7, shortAction: 'small_happy' }
];

describe('conversation read-aloud text', () => {
  it('uses display speech directly when no TTS adaptation is needed', async () => {
    const translator = { translateSpeechSegments: vi.fn() };

    await expect(getSpokenReplySegments(translator, replies, 'zh')).resolves.toEqual([
      { ...replies[0], spokenText: '你好。' },
      { ...replies[1], spokenText: '我有点难过。' }
    ]);
    expect(translator.translateSpeechSegments).not.toHaveBeenCalled();
  });

  it('uses one secondary LLM request for every message segment', async () => {
    const translator = {
      translateSpeechSegments: vi.fn().mockResolvedValue(['Hello.', '[sobbing] I feel sad.'])
    };

    await expect(getSpokenReplySegments(translator, replies, 'en', 'fish-s2')).resolves.toEqual([
      { ...replies[0], spokenText: 'Hello.' },
      { ...replies[1], spokenText: '[sobbing] I feel sad.' }
    ]);
    expect(translator.translateSpeechSegments).toHaveBeenCalledOnce();
    expect(translator.translateSpeechSegments).toHaveBeenCalledWith(
      ['你好。', '我有点难过。'],
      'en',
      'fish-s2',
      undefined
    );
  });

  it('uses the secondary LLM for Chinese emotion markup without translating language', async () => {
    const translator = { translateSpeechSegments: vi.fn() };

    await getSpokenReplySegments(
      translator,
      replies.map((reply, index) => ({ ...reply, ttsEmotion: index ? '失望地说' : '开心地说' })),
      'zh',
      'doubao-2'
    );
    expect(translator.translateSpeechSegments).not.toHaveBeenCalled();
  });

  it('falls back when conversion output is incomplete', async () => {
    await expect(
      getSpokenReplySegments(
        { translateSpeechSegments: vi.fn().mockResolvedValue(['Hello.']) },
        replies,
        'en'
      )
    ).resolves.toMatchObject([{ spokenText: 'Hello.' }, { spokenText: '我有点难过。' }]);
    await expect(
      getSpokenReplySegments(
        { translateSpeechSegments: vi.fn().mockResolvedValue(['', '我有点难过。']) },
        replies,
        'en'
      )
    ).resolves.toMatchObject([{ spokenText: '你好。' }, { spokenText: '我有点难过。' }]);
  });

  it('keeps cancellation protection around the secondary request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      getSpokenReplySegments(
        { translateSpeechSegments: vi.fn() },
        replies,
        'en',
        undefined,
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
