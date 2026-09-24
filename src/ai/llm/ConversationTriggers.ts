const REMINDER_KEYWORD = /(?:叫我|提醒我)/;
const SCHEDULER_CANDIDATE = /(?:提醒|叫我|闹钟|分钟后|小时后|明天|后天|每天|每周)/;
const SCHEDULER_MANAGE_TRIGGER =
  /(?:有哪些|列出|查看|取消|删除|修改|改成|停用|启用).{0,16}(?:提醒|闹钟)|(?:提醒|闹钟).{0,16}(?:有哪些|列表|取消|删除|修改|改成|停用|启用)/;
const SCHEDULER_NEGATION = /(?:不要|不用|别|无需|不必)\s*(?:再\s*)?(?:叫我|提醒我)/;
const SCHEDULER_META_CONTEXT =
  /(?:叫我|提醒我).{0,24}(?:闹钟|功能|能力|设置|规则|触发器|正则|关键词)/;
const SCHEDULER_STATEMENT_CONTEXT = /(?:已经|刚刚|刚才|之前|曾经|正在).{0,8}(?:叫我|提醒我)/;
const WEB_SEARCH_COMMAND = /(?:搜索|搜一下|查一下|查询|联网(?:查询|搜索)|网上(?:查|搜))/;

/** Explicit reminder commands must execute a scheduler tool, never receive a pretend confirmation. */
export function requiresSchedulerTool(text: string): boolean {
  const normalized = text.trim();
  if (
    !normalized ||
    SCHEDULER_NEGATION.test(normalized) ||
    SCHEDULER_META_CONTEXT.test(normalized) ||
    SCHEDULER_STATEMENT_CONTEXT.test(normalized)
  ) {
    return false;
  }
  return REMINDER_KEYWORD.test(normalized) || SCHEDULER_MANAGE_TRIGGER.test(normalized) || /(?:设|定).{0,8}闹钟/.test(normalized);
}

/** Trigger selection only. Natural-language time parsing belongs to the LLM tool-parameter call. */
export function shouldUseSchedulerTool(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || SCHEDULER_NEGATION.test(normalized) || SCHEDULER_META_CONTEXT.test(normalized) || SCHEDULER_STATEMENT_CONTEXT.test(normalized)) return false;
  return requiresSchedulerTool(normalized) || SCHEDULER_CANDIDATE.test(normalized);
}

/** Explicit web-search commands must execute the search tool before answering. */
export function requiresWebSearchTool(text: string): boolean {
  return WEB_SEARCH_COMMAND.test(text.trim());
}
