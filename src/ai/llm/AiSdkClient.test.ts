import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  parseChatToolCall,
  parsePrioritizedAssistantOutput,
  sanitizeAssistantSpeech,
  validateAssistantIntent
} from './AiSdkClient';
import { defaultReplyShortActionId } from '../../character/motion/reply/shortActionVocabulary';

describe('main-model tool calls', () => {
  it('accepts one complete available tool call', () => {
    expect(
      parseChatToolCall('<tool_call>{"name":"web-search","arguments":{"query":"香港天气"}}</tool_call>', [
        { name: 'web-search', description: 'search', arguments: '{}' }
      ])
    ).toEqual({ name: 'web-search', arguments: { query: '香港天气' } });
    expect(() =>
      parseChatToolCall('<tool_call>{"name":"web-search","arguments":{}}', [
        { name: 'web-search', description: 'search', arguments: '{}' }
      ])
    ).toThrow('不完整');
  });
});

describe('assistant speech normalization', () => {
  it('appends the enabled character prompt to the system prompt', () => {
    const prompt = buildSystemPrompt(
      {
        id: 'shiro',
        displayName: '白',
        identity: '数字生命',
        traits: [],
        speakingStyle: [],
        boundaries: [],
        defaultEmotion: 'neutral',
        additionalPrompt: '每次只说一句。'
      },
      {
        mood: 'neutral',
        energy: 0.5,
        engagement: 0.5,
        lastInteractionAt: 0,
        recentTopics: [],
        frozen: false
      }
    );

    expect(prompt).toContain('<additional-prompt>\n每次只说一句。\n</additional-prompt>');
    expect(prompt).toContain('replies 只包含第二段及后续段落');
  });

  it('cuts the first two complete JSON objects without waiting for the full reply', () => {
    const speech = '{这里也有右大括号}';
    const first = JSON.stringify({ speech });
    const parameters = JSON.stringify({ emotion: 'happy', intensity: 0.7, shortAction: 'happy_small' });
    expect(parsePrioritizedAssistantOutput(`${first.slice(0, -1)}`)).toEqual({});
    expect(parsePrioritizedAssistantOutput(first)).toEqual({ firstSpeech: speech });
    expect(parsePrioritizedAssistantOutput(first + parameters)).toEqual({
      firstSpeech: speech,
      firstParameters: { emotion: 'happy', intensity: 0.7, shortAction: 'happy_small' }
    });
  });

  it('normalizes unsupported first-segment parameters without blocking delivery', () => {
    expect(
      parsePrioritizedAssistantOutput(
        '{"speech":"想什么？"}{"emotion":"unknown","intensity":2,"shortAction":"idle"}'
      )
    ).toEqual({
      firstSpeech: '想什么？',
      firstParameters: { emotion: 'neutral', intensity: 1, shortAction: defaultReplyShortActionId }
    });
  });

  it('repairs a curly quote used at the first JSON speech boundary', () => {
    const raw =
      '{"speech":"哼，本大帝才没有在偷懒呢！”}{"emotion":"shy","intensity":0.8,"shortAction":"look_away"}' +
      '{"replies":[{"speech":"哼，本大帝才没有在偷懒呢！","emotion":"shy","intensity":0.8,"shortAction":"look_away"}],"soulEvent":"chat","memories":[]}';
    expect(parsePrioritizedAssistantOutput(raw, true).intent!.replies![0]!).toEqual({
      speech: '哼，本大帝才没有在偷懒呢！',
      emotion: 'shy',
      intensity: 0.8,
      shortAction: 'look_away'
    });
  });

  it('prepends the prioritized first reply to later reply segments', () => {
    const raw = [
      { speech: '第一段。' },
      { emotion: 'happy', intensity: 0.7, shortAction: 'happy_small' },
      {
        replies: [
          { speech: '第二段。', emotion: 'curious', intensity: 0.5, shortAction: 'agree_soft' }
        ],
        soulEvent: 'chat',
        memories: []
      }
    ]
      .map((value) => JSON.stringify(value))
      .join('');
    expect(parsePrioritizedAssistantOutput(raw, true).intent?.replies).toEqual([
      { speech: '第一段。', emotion: 'happy', intensity: 0.7, shortAction: 'happy_small' },
      { speech: '第二段。', emotion: 'curious', intensity: 0.5, shortAction: 'agree_soft' }
    ]);
  });

  it('accepts a merged first segment followed by later replies', () => {
    const raw =
      '{"speech":"你这家伙到底想怎么样？","emotion":"annoyed","intensity":0.7,"shortAction":"sigh_soft"}' +
      ',{"replies":[{"speech":"还要再问一次吗？","emotion":"angry","intensity":0.8,"shortAction":"shake_head_small"}]}';

    expect(parsePrioritizedAssistantOutput(raw)).toEqual({
      firstSpeech: '你这家伙到底想怎么样？',
      firstParameters: { emotion: 'neutral', intensity: 0.7, shortAction: 'sigh_soft' }
    });
    expect(parsePrioritizedAssistantOutput(raw, true).intent?.replies).toEqual([
      { speech: '你这家伙到底想怎么样？', emotion: 'neutral', intensity: 0.7, shortAction: 'sigh_soft' },
      { speech: '还要再问一次吗？', emotion: 'angry', intensity: 0.8, shortAction: 'shake_head_small' }
    ]);
  });

  it('strips invented inline performance tags from speech', () => {
    // Paired invented tags drop together with their stage direction content.
    expect(sanitizeAssistantSpeech('要是再磨蹭……<message>手叉腰，身体微微前倾</message>')).toBe(
      '要是再磨蹭……'
    );
    expect(sanitizeAssistantSpeech('台词<hand_explain>叉腰并挑眉</hand_explain>继续说话。')).toBe(
      '台词继续说话。'
    );
    // A stray unclosed marker is stripped but keeps the speech after it.
    expect(
      sanitizeAssistantSpeech(
        '要是再磨蹭……<hand_explain>我就只给你表演这个“后空翻失败”的样子了哦！哈哈哈哈！'
      )
    ).toBe('要是再磨蹭……我就只给你表演这个“后空翻失败”的样子了哦！哈哈哈哈！');
    // The user-reported mixed case cleans up completely.
    expect(
      sanitizeAssistantSpeech(
        '要是再磨蹭……<message>手叉腰，身体微微前倾</message><hand_explain>我就只给你表演这个“后空翻失败”的样子了哦！哈哈哈哈！'
      )
    ).toBe('要是再磨蹭……我就只给你表演这个“后空翻失败”的样子了哦！哈哈哈哈！');
    // Truncated half-open tags from streaming are dropped as well.
    expect(sanitizeAssistantSpeech('台词<option')).toBe('台词');
    // Ordinary text that merely contains angle brackets stays untouched.
    expect(sanitizeAssistantSpeech('1<2 且 3>2，没问题。')).toBe('1<2 且 3>2，没问题。');
  });

  it('keeps every reply segment and assigns one validated short action to each', () => {
    const intent = validateAssistantIntent({
      replies: [
        { speech: '咦？', shortAction: 'stunned' },
        { speech: '原来如此。', shortAction: 'agree_soft' },
        { speech: '这个不会被当成动作。', shortAction: 'delete_everything' }
      ],
      soulEvent: 'chat',
      emotion: 'curious',
      intensity: 0.5,
      memories: []
    });

    // `stunned` 属于已从 LLM 词表移除的旧语义动作，`delete_everything` 不存在；
    // 两者都回落到默认组合动作。
    expect(intent.replies.map(({ shortAction }) => shortAction)).toEqual([
      defaultReplyShortActionId,
      'agree_soft',
      defaultReplyShortActionId
    ]);
    expect(intent.speech).toBe('咦？\n原来如此。\n这个不会被当成动作。');
  });

  it('does not truncate long replies', () => {
    const speech = '长'.repeat(500);
    expect(
      validateAssistantIntent({
        speech,
        emotion: 'neutral',
        intensity: 0.5,
        memories: []
      }).speech
    ).toBe(speech);
  });

  it('does not render stray metadata inside the chat bubble', () => {
    const raw =
      '诶？！去中作？那是干什么的中作？世界的预言还没完成吗？不许丢下奥丁大人不管！要是世界终结的时候你不见了……哼哼，神也会惩罚你的！快点回来陪我！","action":"pointing","emotion":"concerned';
    expect(sanitizeAssistantSpeech(raw)).toBe(
      '诶？！去中作？那是干什么的中作？世界的预言还没完成吗？不许丢下奥丁大人不管！要是世界终结的时候你不见了……哼哼，神也会惩罚你的！快点回来陪我！'
    );
    expect(
      validateAssistantIntent({
        speech: raw,
        emotion: 'concerned',
        intensity: 0.8,
        memories: []
      }).speech
    ).not.toContain('action');
  });

  it('accepts only the three LLM-owned soul event classifications', () => {
    expect(
      validateAssistantIntent({ speech: '哼。', soulEvent: 'belittle', emotion: 'angry', intensity: 0.8 })
        .soulEvent
    ).toBe('belittle');
    expect(
      validateAssistantIntent({ speech: '嗯。', soulEvent: 'ignored', emotion: 'neutral', intensity: 0.2 })
        .soulEvent
    ).toBe('chat');
  });
});
