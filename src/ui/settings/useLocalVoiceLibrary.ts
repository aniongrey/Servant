import { useCallback, useEffect, useState } from 'react';
import {
  deleteVoiceEntry,
  loadVoiceLibrary,
  saveVoiceLibrary,
  TTS_VOICE_LIBRARY_STORAGE_KEY,
  upsertVoiceEntry,
  syncGptSovitsVoices,
  type ExternalVoicePreset,
  type LocalVoiceEntry,
  type LocalVoiceInput
} from '../../ai/tts/localVoiceLibrary';

/**
 * The saved voices of the voice settings.
 *
 * Remote voices are edited locally; saved GPT-SoVITS roles are reconciled only
 * after a successful load, so a loading or failed request cannot erase entries.
 */
export function useLocalVoiceLibrary(roles?: readonly ExternalVoicePreset[]) {
  const [entries, setEntries] = useState<LocalVoiceEntry[]>(loadVoiceLibrary);

  useEffect(() => {
    if (roles) setEntries(syncGptSovitsVoices(roles));
  }, [roles]);

  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === null || event.key === TTS_VOICE_LIBRARY_STORAGE_KEY) {
        setEntries(loadVoiceLibrary());
      }
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);

  const commit = useCallback((next: LocalVoiceEntry[]) => {
    saveVoiceLibrary(next);
    setEntries(next);
  }, []);
  const saveEntry = useCallback(
    (input: LocalVoiceInput) => commit(upsertVoiceEntry(entries, input)),
    [commit, entries]
  );
  const removeEntry = useCallback((id: string) => commit(deleteVoiceEntry(entries, id)), [commit, entries]);

  return { entries, saveEntry, removeEntry };
}
