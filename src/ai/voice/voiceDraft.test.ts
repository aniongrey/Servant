import { afterEach, expect, it, vi } from 'vitest';
import { readVoiceDraft, voiceDraftKey, writeVoiceDraft } from './voiceDraft';

afterEach(() => vi.unstubAllGlobals());
it('keeps target drafts separate and remembers delivered utterances across reloads', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, text: string) => storage.set(key, text)
  });
  const a = voiceDraftKey({ page: 'meeting', sessionId: 'a', characterId: 'alice', label: 'Alice' });
  const b = voiceDraftKey({ page: 'desktop', sessionId: 'a', characterId: 'alice', label: 'Alice' });
  writeVoiceDraft(a, '手动草稿 你好', 'utterance-1');
  expect(readVoiceDraft(b).text).toBe('');
  writeVoiceDraft(a, '修改后的草稿');
  expect(readVoiceDraft(a)).toEqual({ text: '修改后的草稿', received: ['utterance-1'] });
  writeVoiceDraft(a, '', 'utterance-1');
  expect(readVoiceDraft(a)).toEqual({ text: '', received: ['utterance-1'] });
});
