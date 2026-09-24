import { z } from 'zod';
import type { SchedulerToolInput } from '../../scheduler/SchedulerTypes';
import { normalizeSchedulerToolInput } from '../../scheduler/SchedulerToolInputNormalizer';
import type {
  ChatToolCall,
  ChatToolDefinition,
  ChatToolName
} from './types';
import type { ProcessedConversationInput } from './InputPreprocessor';

const scheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('once'), at: z.number() }),
  z.object({
    type: z.literal('daily'),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59)
  }),
  z.object({
    type: z.literal('weekly'),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59)
  })
]);

const schedulerArguments = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    name: z.string().min(1).max(80),
    schedule: scheduleSchema,
    text: z.string().min(1).max(500)
  }),
  z.object({
    action: z.literal('update'),
    taskId: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    name: z.string().min(1).max(80).optional(),
    schedule: scheduleSchema.optional(),
    text: z.string().min(1).max(500).optional()
  }),
  z.object({
    action: z.literal('remove'),
    taskId: z.string().min(1).optional(),
    query: z.string().min(1).optional()
  }),
  z.object({ action: z.literal('list'), query: z.string().optional() })
]);

const searchArguments = z.object({
  query: z.string().trim().min(2).max(160),
  resolvedQuestion: z.string().trim().min(2).max(300)
});

const definitions: Record<ChatToolName, ChatToolDefinition> = {
  'web-search': {
    name: 'web-search',
    description: '查询当前、会变化或用户明确要求查证的外部信息。普通聊天和已有上下文可回答的问题不要调用。',
    arguments: '{"query":"搜索关键词","resolvedQuestion":"补全指代后的用户问题"}'
  },
  scheduler: {
    name: 'scheduler',
    description: '创建、查询、修改或删除提醒。自然语言时间转换为 once/daily/weekly；once.at 使用 13 位毫秒时间戳。',
    arguments: [
      'add={"action":"add","name":"名称","schedule":{"type":"once","at":毫秒时间戳}|{"type":"daily","hour":0-23,"minute":0-59}|{"type":"weekly","weekdays":[0-6],"hour":0-23,"minute":0-59},"text":"提醒内容"}',
      'update={"action":"update","taskId?":"id","query?":"匹配词","name?":"新名称","schedule?":同上,"text?":"新内容"}',
      'remove={"action":"remove","taskId?":"id","query?":"匹配词"}',
      'list={"action":"list","query?":"筛选词"}'
    ].join('；')
  }
};

export type ValidatedChatToolCall =
  | { name: 'web-search'; arguments: z.infer<typeof searchArguments> }
  | { name: 'scheduler'; arguments: SchedulerToolInput };

export class ChatToolRegistry {
  listAvailable(input: ProcessedConversationInput, webSearchEnabled: boolean): ChatToolDefinition[] {
    const names = new Set(input.toolCandidates);
    // Search remains available for implicit current-information requests; the
    // candidate only supplies a deterministic hint, never a final decision.
    if (webSearchEnabled) names.add('web-search');
    return [...names].filter((name) => name !== 'web-search' || webSearchEnabled).map((name) => definitions[name]);
  }

  validate(call: ChatToolCall, available: readonly ChatToolDefinition[], userText: string): ValidatedChatToolCall {
    if (!available.some(({ name }) => name === call.name)) throw new Error(`工具不可用：${call.name}`);
    if (call.name === 'web-search') {
      return { name: call.name, arguments: searchArguments.parse(call.arguments) };
    }
    const input = schedulerArguments.parse(call.arguments) as SchedulerToolInput;
    return { name: call.name, arguments: normalizeSchedulerToolInput(input, userText) };
  }
}

export function buildAvailableToolsPrompt(tools: readonly ChatToolDefinition[]): string {
  if (tools.length === 0) return '';
  return [
    'AVAILABLE TOOLS',
    ...tools.map((tool) => `- ${tool.name}: ${tool.description}\n  arguments: ${tool.arguments}`),
    '只有确实需要工具时，本轮只能输出完整的 <tool_call>{"name":"工具名","arguments":{...}}</tool_call>，不要同时输出台词、emotion 或 meta。',
    '不需要工具时按正常角色协议直接回复。工具结果会在下一轮上下文中提供，禁止假装工具已经执行。'
  ].join('\n');
}
