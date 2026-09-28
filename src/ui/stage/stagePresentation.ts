import type { PersonalityMood } from '../../ai/llm/types';

/**
 * 舞台（Galgame）上「这一句在演什么」的展示词表。
 *
 * 两件事必须一起看：
 *
 * - **表情**（`emotion`，LLM 直接给的 `PersonalityMood`）——和 `moodPresentation.ts`
 *   共用同一组取值，这里只加中文名。`neutral` 是「没有表情」，按约定**不显示**，
 *   否则几乎每句旁边都挂一个「平静」，反而把真正的情绪淹了。
 * - **动作**（`shortAction`，词表在 `shortActionVocabulary.ts`）——这是身体动作，
 *   与表情是两层，所以两个 chip 会同时出现（例如「开心 · 比划」）。
 *
 * 词表是**穷举**的：`shortAction` 的 id 全部来自 `full-body-motion-config.json`，
 * 漏一个就会在界面上露出英文 id。新增动作时同步补这里，
 * `stagePresentation.test.ts` 会拿配置里的键来核对。
 */
export const EMOTION_LABELS: Record<PersonalityMood, string> = {
  neutral: '',
  happy: '开心',
  curious: '好奇',
  concerned: '担心',
  angry: '生气',
  sad: '难过',
  shy: '害羞'
};

/**
 * 动作 id → 中文名。
 *
 * 名字取动作本身的名字（「点头」「摇头」），不是它的用途分类——界面上旁边已经
 * 有表情在说明情绪了，动作这边只要说清「身体在干嘛」。
 */
export const ACTION_LABELS: Record<string, string> = {
  idle_soft: '待机',
  listen_focus: '倾听',
  think_small: '思索',
  hand_explain: '比划',
  hand_present: '介绍',
  nod_small: '点头',
  shake_head_small: '摇头',
  head_tilt: '歪头',
  wave_small: '挥手',
  happy_small: '雀跃',
  shy_small: '扭捏',
  surprise_small: '一惊',
  sigh_soft: '叹气',
  look_away: '别开脸',
  shrug_small: '耸肩',
  agree_soft: '认可',
  angry: '发火',
  excited: '兴奋',
  arguing: '争辩',
  backflip: '后空翻',
  servantComing: '起身'
};

/** 表情的中文名；`neutral` 与未知取值返回空串，调用方据此决定不渲染。 */
export function emotionLabel(mood: PersonalityMood | string | undefined): string {
  if (!mood) return '';
  return EMOTION_LABELS[mood as PersonalityMood] ?? '';
}

/** 动作的中文名；词表外的 id 原样返回，方便开发期一眼看出漏登记了哪个。 */
export function actionLabel(action: string | undefined): string {
  if (!action) return '';
  return ACTION_LABELS[action] ?? action;
}

/**
 * 每种情绪一句的过场音效。
 *
 * 全部复用 `public/assets/fx/` 里已有的角色语气词（`ei`=欸、`en`=嗯、`no`=不、
 * `uhe`=呜欸、`yeah`、`hihii`=嘻嘻、`heheuh`=嘿嘿）。挑的时候按实测响度分档
 * （`ffmpeg -af volumedetect`）：
 *
 * | 文件 | 平均响度 | 适合的情绪 |
 * | --- | --- | --- |
 * | `yeah`  | -20.0 dB（最响） | 兴奋、开心 |
 * | `uhe`   | -28.0 dB         | 惊讶、为难（峰值最高，有起伏） |
 * | `no`    | -30.2 dB         | 生气、否定 |
 * | `hihii` | -32.9 dB         | 害羞、偷笑 |
 * | `en`    | -33.9 dB（最轻最平） | 温和的应答 |
 *
 * 这样配比单看名字更靠谱：情绪越强响度越高，不会出现「生气」比「害羞」还小声。
 *
 * `neutral` 刻意留空：平静的一句话不该发出任何提示音。
 */
export const EMOTION_SOUND_URLS: Record<PersonalityMood, string | null> = {
  neutral: null,
  happy: '/assets/fx/cute/25girlhuuuu.wav',
  curious: '/assets/fx/cute/26girlwou.wav',
  concerned: '/assets/fx/cute/14uiii.wav',
  angry: '/assets/fx/cute/4bio.wav',
  sad: '/assets/fx/cute/28girleu.wav',
  shy: '/assets/fx/cute/21girlehei.wav'
};

/** 情绪过场音效暂时关闭；保留映射，之后需要恢复时再启用。 */
export function emotionSoundUrl(_mood: PersonalityMood | string | undefined): string | null {
  return null;
}
