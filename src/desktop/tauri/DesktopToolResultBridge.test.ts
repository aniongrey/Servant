import { describe, expect, it } from 'vitest';
import { toToolResultSpeechEvent } from './DesktopToolResultBridge';

describe('toToolResultSpeechEvent', () => {
  it('keeps successful raw web-search results out of desktop TTS', () => {
    const event = toToolResultSpeechEvent(
      {
        type: 'tool-result',
        requestId: 'search-1',
        tool: 'web-search',
        action: 'run',
        success: true,
        speech: '查询完成了。',
        content: { query: '天气', results: [{ title: '不会朗读的正文', url: 'https://example.com' }] }
      },
      100
    );
    expect(event).toBeUndefined();
  });

  it('still sends tool failures to desktop TTS', () => {
    expect(
      toToolResultSpeechEvent(
        {
          type: 'tool-result',
          requestId: 'search-2',
          tool: 'web-search',
          action: 'run',
          success: false,
          speech: '联网查询失败了。'
        },
        100
      )
    ).toMatchObject({ speech: '联网查询失败了。' });
  });
});
