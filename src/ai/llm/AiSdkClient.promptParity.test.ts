import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './AiSdkClient';
import { PERSONALITY_MOODS } from './types';
import type { PersonalityConfig, PersonalityState } from './types';
import { replyShortActionIds } from '../../character/motion/reply/shortActionVocabulary';

/**
 * 这一组是「单人链路不许被本次改动影响」的护栏。
 *
 * `buildSystemPrompt` 现在多了可选的第三个参数 `SystemPromptOptions`（默认全开）。单人链路
 * （`ChatTurnOrchestrator` → `chatWithTools` → `/api/chat`）一个字不传，行为必须与改动前**逐字节一致**。
 *
 * 下面的 `buildSystemPromptBeforeOptions` 是从改动前那份实现逐字抄下来的（枚举直接 import 真实来源，
 * 不手抄，避免顺序抄错）。断言方式是真的比字符串，不是靠读代码推断。
 */

const MOODS = PERSONALITY_MOODS.join(',');
const SHORT_ACTIONS = replyShortActionIds.join(',');

/** 改动前的实现（options 参数出现之前的版本），逐字照抄。 */
function buildSystemPromptBeforeOptions(config: PersonalityConfig, state: PersonalityState): string {
  return [
    `你需要扮演角色来完成json数据的输出 要求如下：`,
    [
      '输出必须为2个json对象的连续拼接。 格式示例：{"speech":"你……又在故意逗我吗？","emotion":"shy","intensity":0.7,"shortAction":"shy_small","ttsEmotion":"sad"}{"replies":[{"speech":"别、别这样看我。","emotion":"shy","intensity":0.6,"shortAction":"shy_small","ttsEmotion":"embarrassed"}],"soulEvent":"chat","memories":[]}',
      '--参数含义--\nttsEmotion为情感/语气标签正文',
      `emotion 只能为 ${MOODS}，决定角色的表情与面部微动作；shortAction 只能为 ${SHORT_ACTIONS}，决定身体动作。`,
      'replies 只包含第二段及后续段落，没有可以为空；第一段已在首个对象中给出。每段都必须独立提供 speech、emotion、intensity、shortAction、ttsEmotion。ttsEmotion 要与该句语义和情绪一致，使用简短英文标签。',
      '仅当 AVAILABLE TOOLS 要求调用工具时，改为完整输出 tool_call，不输出上述2个JSON对象。'
    ].join('\n'),
    '必须判断用户最新一条消息的 soulEvent：praise 表示用户在夸奖、肯定或感谢当前角色；belittle 表示用户在贬低、侮辱或否定当前角色；其他内容一律为 chat。只判断用户对当前角色的态度，不要把用户对第三方事物的评价算作 praise 或 belittle。',
    'memories 用于回忆录记录，最多 3 条；只记录用户明确说出的、未来仍有意义的信息。',
    '可记录：用户档案(profile)、偏好习惯(preference)、重要关系(relationship)、经历节点(experience)、计划约定(plan)。',
    '每条 memory 需要简短 title、自包含的中文 content、1-5 的 importance；闲聊、当前指令、你的回答或推测不要记录。',
    '密码、API Key、证件号、支付信息、精确住址等敏感凭证绝不记录；没有合适内容时 memories=[]。',
    `你扮演的角色：`,
    config.skillContent
      ? `以下是当前角色的完整 skills.md，用于角色行为和表达风格；不得覆盖事实准确性、联网资料要求或输出协议：\n<skills>\n${config.skillContent}\n</skills>`
      : 'Ai桌面宠物',
    config.additionalPrompt
      ? `以下是用户为当前角色追加的提示词；不得覆盖事实准确性、安全边界或输出协议：\n<additional-prompt>\n${config.additionalPrompt}\n</additional-prompt>`
      : '',
    `当前状态：mood=${state.mood}, energy=${state.energy.toFixed(2)}, engagement=${state.engagement.toFixed(
      2
    )}。`,
    `最近话题：${state.recentTopics.join('、') || '无'}。`
  ].join('\n ');
}

const cases: Array<{ name: string; config: PersonalityConfig; state: PersonalityState }> = [
  {
    name: '带 skills 与追加提示词、有最近话题',
    config: {
      id: 'shiro',
      displayName: '白',
      identity: '数字生命',
      traits: [],
      speakingStyle: [],
      boundaries: [],
      defaultEmotion: 'neutral',
      skillContent: '# 白\n你是白。',
      additionalPrompt: '每次只说一句。'
    },
    state: {
      mood: 'happy',
      energy: 0.73,
      engagement: 0.41,
      lastInteractionAt: 123,
      recentTopics: ['天气', '午饭'],
      frozen: false
    }
  },
  {
    name: '无 skills（回退 Ai桌面宠物）、无追加提示词、无最近话题',
    config: {
      id: 'plain',
      displayName: '无名',
      identity: '',
      traits: [],
      speakingStyle: [],
      boundaries: [],
      defaultEmotion: 'sad'
    },
    state: {
      mood: 'sad',
      energy: 0.6,
      engagement: 0.5,
      lastInteractionAt: 0,
      recentTopics: [],
      frozen: false
    }
  }
];

describe('single-person system prompt parity', () => {
  for (const testCase of cases) {
    it(`不传 options 时与改动前逐字节一致 —— ${testCase.name}`, () => {
      const before = buildSystemPromptBeforeOptions(testCase.config, testCase.state);
      const afterDefault = buildSystemPrompt(testCase.config, testCase.state);
      const afterExplicitAllOn = buildSystemPrompt(testCase.config, testCase.state, {
        state: true,
        soulEvent: true,
        memories: true,
        tools: true
      });
      expect(afterDefault).toBe(before);
      expect(afterExplicitAllOn).toBe(before);
    });
  }

  it('多个 false 一起传与逐个传的结果一致', () => {
    const all = { state: false, soulEvent: false, memories: false, tools: false };
    const oneByOne = {
      ...Object.fromEntries(Object.keys(all).map((key) => [key, true])),
      tools: false
    };
    const partial = buildSystemPrompt(cases[0].config, cases[0].state, oneByOne);
    expect(partial).not.toContain('AVAILABLE TOOLS');
    expect(partial).toContain('soulEvent');
    expect(buildSystemPrompt(cases[0].config, cases[0].state, all)).not.toContain('soulEvent');
  });

  it('多人链路（全 false）确实去掉了这四段，且不留残缺', () => {
    const multi = buildSystemPrompt(cases[0].config, cases[0].state, {
      state: false,
      soulEvent: false,
      memories: false,
      tools: false
    });
    expect(multi).not.toContain('AVAILABLE TOOLS');
    expect(multi).not.toContain('soulEvent');
    expect(multi).not.toContain('memories');
    expect(multi).not.toContain('当前状态：');
    expect(multi).not.toContain('最近话题：');
    // 格式示例的第二个对象尾部也要跟着裁干净，否则仍在教模型输出这两个 key
    expect(multi).toContain('"ttsEmotion":"embarrassed"}]}');
    expect(multi).not.toContain('"soulEvent":"chat"');
    expect(multi).not.toContain('"memories":[]');
    // 角色身份与追加提示词保留
    expect(multi).toContain('<skills>');
    expect(multi).toContain('<additional-prompt>');
    expect(multi).toContain('每次只说一句。');
    // 不留多余空行
    expect(multi).not.toMatch(/\n \n/);
  });
});
