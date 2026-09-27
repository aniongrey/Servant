import { useCallback, useState } from 'react';
import {
  deleteVoiceEntry,
  loadVoiceLibrary,
  saveVoiceLibrary,
  upsertVoiceEntry,
  type LocalVoiceEntry,
  type LocalVoiceInput
} from '../../ai/tts/localVoiceLibrary';

/**
 * The saved voices of the voice settings.
 *
 * Local storage is written by the two mutators rather than by an effect, so
 * merely opening the panel never rewrites what is on disk.
 */
export function useLocalVoiceLibrary() {
  const [entries, setEntries] = useState<LocalVoiceEntry[]>(loadVoiceLibrary);

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
