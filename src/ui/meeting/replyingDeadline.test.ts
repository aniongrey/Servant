import { describe, expect, it } from 'vitest';
import { typewriterTotalMs } from '../stage/typewriterTiming';

/**
 * 「正在回复…」该挂多久。
 *
 * 这条逻辑在 `MeetingPage` 的 `markReplying` 里——它把每条消息的打字机时长串起来
 * 累加，得到「文字全部铺完」的时刻。这里把这个算法单独钉住，因为它是这次修复的
 * 核心：**状态的存活时间必须由文字决定，而不是由语音播完决定**。
 */
function replyingDeadlineMs(messages: readonly { text: string; estimatedDurationMs?: number }[]): number {
  return messages.reduce((total, message) => total + typewriterTotalMs(message.text, message.estimatedDurationMs ?? 0), 0);
}

describe('meeting replying deadline', () => {
  it('adds up every message rather than taking only the last one', () => {
    // 一轮回复可能有四五段。只算最后一段会让状态在中间就消失，界面显得「还没说完就停了」。
    const messages = [
      { text: '第一段。', estimatedDurationMs: 1200 },
      { text: '第二段稍微长一点点。', estimatedDurationMs: 2400 },
      { text: '第三段。', estimatedDurationMs: 900 }
    ];
    const total = replyingDeadlineMs(messages);
    expect(total).toBeGreaterThan(typewriterTotalMs(messages[0].text, 1200));
    expect(total).toBeGreaterThan(typewriterTotalMs(messages[1].text, 2400));
    expect(total).toBe(
      messages.reduce((sum, message) => sum + typewriterTotalMs(message.text, message.estimatedDurationMs), 0)
    );
  });

  it('still finishes promptly when the speaker goes silent and text is short', () => {
    // 语音合成慢（例如 GPT-SoVITS 冷启动十几秒）时，状态必须跟着短文字很快结束，
    // 而不是陪着音频一起等——这正是原来那个 bug 的来源。
    const total = replyingDeadlineMs([{ text: '嗯。', estimatedDurationMs: 20_000 }]);
    expect(total).toBeLessThan(1000);
  });

  it('is zero for an empty batch so nothing is scheduled', () => {
    expect(replyingDeadlineMs([])).toBe(0);
  });
});
