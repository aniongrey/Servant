import type { VoiceTarget } from './VoiceInputProtocol';

export const voiceDraftKey = (target: VoiceTarget) =>
  `servant.voice-draft.${JSON.stringify([target.page, target.sessionId, target.characterId])}`;
export function readVoiceDraft(key: string): { text: string; received: string[] } {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value && typeof value.text === 'string' && Array.isArray(value.received))
      return { text: value.text, received: value.received.filter((id: unknown) => typeof id === 'string') };
  } catch {
    /* Ignore invalid draft data without affecting other conversations. */
  }
  return { text: '', received: [] };
}
export function writeVoiceDraft(key: string, text: string, resultId?: string) {
  const draft = readVoiceDraft(key);
  if (resultId && !draft.received.includes(resultId)) draft.received.push(resultId);
  localStorage.setItem(key, JSON.stringify({ text, received: draft.received }));
}
