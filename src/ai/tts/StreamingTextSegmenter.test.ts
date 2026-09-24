import { describe, expect, it } from 'vitest';
import { splitFirstSentence, StreamingTextSegmenter } from './StreamingTextSegmenter';

describe('StreamingTextSegmenter', () => {
  it('splits only the first completed sentence from a multi-sentence reply', () => {
    expect(splitFirstSentence('先说这一句。后面还有两句！最后一句。')).toEqual({
      firstSentence: '先说这一句。',
      remainder: '后面还有两句！最后一句。'
    });
    expect(splitFirstSentence('还没有完整标点')).toBeUndefined();
  });

  it('emits a completed sentence before the full response arrives', () => {
    const segmenter = new StreamingTextSegmenter();

    expect(segmenter.push('你好，我是')).toEqual([]);
    expect(segmenter.push('你好，我是小艾。接下来')).toEqual(['你好，我是小艾。']);
    expect(segmenter.flush('你好，我是小艾。接下来一起工作吧')).toEqual(['接下来一起工作吧']);
  });

  it('does not repeat text from cumulative streaming updates', () => {
    const segmenter = new StreamingTextSegmenter();

    expect(segmenter.push('第一句。')).toEqual(['第一句。']);
    expect(segmenter.push('第一句。第二句。')).toEqual(['第二句。']);
    expect(segmenter.flush('第一句。第二句。')).toEqual([]);
  });

  it('uses a soft break when an unfinished sentence exceeds the V1 limit', () => {
    const segmenter = new StreamingTextSegmenter({ maxChars: 12, minSoftBreakChars: 6 });

    expect(segmenter.push('这是一个比较长的句子，需要提前开口')).toEqual(['这是一个比较长的句子，']);
    expect(segmenter.flush()).toEqual(['需要提前开口']);
  });
});
