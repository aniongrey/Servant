/**
 * 一段台词「文字铺完」需要多久——舞台打字机与多人对话窗口共用这一份算法。
 *
 * 为什么需要第二处实现：舞台那边是逐帧 `setTimeout` 揭示，多人对话窗口这边没有
 * 打字机，却要回答同一个问题——「这一轮回复结束了没有」。两处如果用不同的速度，
 * 就会出现「文字还在爬、状态已经变回待命」或者反过来的错位，所以时长算一次、
 * 两处都读它。
 */

/** 每字最短停留：再快就没有「逐字」的可读感了。 */
export const TYPEWRITER_MIN_MS_PER_CHAR = 18;
/** 每字最长停留：再慢会让人以为卡住了，长句宁可提前铺完。 */
export const TYPEWRITER_MAX_MS_PER_CHAR = 90;
/** 换行、句末标点多停一拍，读起来更像有节奏的对话。 */
export const PAUSE_AFTER_PUNCTUATION_MS = 180;
const PAUSE_CHARS = /[。！？…，、；：!?.,;:]/;

/** 单个字（含其后的标点停顿）要停留多久。 */
export function typewriterStepMs(text: string, index: number, durationMs = 0): number {
  const characters = Array.from(text);
  const perChar = Math.min(
    TYPEWRITER_MAX_MS_PER_CHAR,
    Math.max(TYPEWRITER_MIN_MS_PER_CHAR, durationMs / Math.max(1, characters.length))
  );
  return perChar + (PAUSE_CHARS.test(characters[index] ?? '') ? PAUSE_AFTER_PUNCTUATION_MS : 0);
}

/**
 * 整段文字铺完所需的总时长。
 *
 * 与打字机逐字 `setTimeout` 的行为保持一致：它先等第一个字，再一个字一个字地等，
 * 所以总时长是「每个字那一步」的和，而不是 `字数 × 每字`。
 */
export function typewriterTotalMs(text: string, durationMs = 0): number {
  const characters = Array.from(text);
  let total = 0;
  for (let index = 0; index < characters.length; index += 1) total += typewriterStepMs(text, index, durationMs);
  return total;
}
