import { useCallback, useEffect, useState } from 'react';
import { fetchGptSovitsHealth, fetchGptSovitsState } from '../../app/network/gptSovitsStudio';
import type { GptSovitsHealth, GptSovitsProfile } from '../../app/network/gptSovitsContract';

/**
 * Role presets of the local GPT-SoVITS, plus whether 9880 answers.
 *
 * Kept as a hook instead of a component because the voice settings and the
 * debug panel render the same choice in two different layouts — the markup
 * differs, the fact that "the role list lives in the backend" does not.
 */
export interface GptSovitsRoles {
  profiles: GptSovitsProfile[];
  health: GptSovitsHealth | null;
  error: string;
  loading: boolean;
  reload: () => void;
}

export function useGptSovitsRoles(enabled: boolean): GptSovitsRoles {
  const [profiles, setProfiles] = useState<GptSovitsProfile[]>([]);
  const [health, setHealth] = useState<GptSovitsHealth | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setProfiles([]);
      setHealth(null);
      setError('');
      return;
    }
    let disposed = false;
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([fetchGptSovitsState(controller.signal), fetchGptSovitsHealth(controller.signal)])
      .then(([state, healthResult]) => {
        if (disposed) return;
        setProfiles(state.profiles ?? []);
        setHealth(healthResult);
        setError('');
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : '无法读取 GPT-SoVITS 角色配置');
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [enabled, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { profiles, health, error, loading, reload };
}
