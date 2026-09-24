import type { AiSdkClient } from '../llm/AiSdkClient';
import type { ChatMessage } from '../llm/types';
import { completeDailyMemory, loadPendingDailyMessages, recordExtractedMemories } from './MemoryClient';

const BATCH_SIZE = 100;

export async function runDailyMemoryJob(
  llm: AiSdkClient,
  signal?: AbortSignal,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
): Promise<void> {
  const pending = await loadPendingDailyMessages(timezone);
  if (pending.completed) return;
  const messages: ChatMessage[] = pending.messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.content,
    createdAt: new Date(message.created_at).getTime()
  }));
  for (let offset = 0; offset < messages.length; offset += BATCH_SIZE) {
    const candidates = await llm.extractDailyMemories(messages.slice(offset, offset + BATCH_SIZE), signal);
    await recordExtractedMemories(candidates);
  }
  await completeDailyMemory(pending.date);
}
