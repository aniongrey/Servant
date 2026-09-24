import fullBody from '../assets/actions/full-body-motion-config.json';

/**
 * 回复动作（主 LLM 的 `shortAction`）的唯一词表：`full-body-motion-config.json` 的
 * `emotion` 组合动作表。提示词、校验、播放三处都从这里取词，不再有第二份清单。
 *
 * 分工：`shortAction` 只驱动身体（`ReplyShortActionRuntime` → `ActionRuntime.play`）；
 * 表情与 B/C 档微动作属于 `emotion`，见 `character/expression/moodPresentation.ts`。
 */
export const replyShortActionIds: readonly string[] = Object.freeze(Object.keys(fullBody.emotion));

/** 词表外的回落值：取配置里的说话动作，保证一定是合法组合动作。 */
export const defaultReplyShortActionId: string =
  fullBody.speaking in fullBody.emotion ? fullBody.speaking : replyShortActionIds[0];

/** 是否为合法 `shortAction` id。 */
export function isReplyShortActionId(id: unknown): id is string {
  return typeof id === 'string' && replyShortActionIds.includes(id);
}

/** 把任意值归一成合法 `shortAction` id：词表外一律回落到默认动作。 */
export function resolveReplyShortActionId(id: unknown): string {
  return isReplyShortActionId(id) ? id : defaultReplyShortActionId;
}
