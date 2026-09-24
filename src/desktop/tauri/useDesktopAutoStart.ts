import { useEffect, useRef, useState } from 'react';
import { isAutoStartAvailable, writeAutoStart } from './autostart';

/**
 * Keeps the single OS login-startup entry in sync with the stored preference.
 *
 * It runs on mount as well as on every toggle, and always writes: writing is
 * idempotent, and re-writing on mount is what repairs an entry left pointing at
 * a previous install path instead of silently never launching the app. The state
 * the shell reports back is adopted, which keeps the switch honest when a write
 * is rejected — and the shell is also the only side that can tell whether the
 * build it belongs to can own an entry at all, so a refusal arrives the same way
 * and turns the switch off rather than leaving it on with nothing behind it.
 */
export function useDesktopAutoStart(enabled: boolean, onChange: (enabled: boolean) => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  /**
   * Why this build cannot own a login entry; empty while it can. A page served
   * by the dev server and a page served from the bundle look identical from
   * here, so only the shell can answer this.
   */
  const [refusal, setRefusal] = useState('');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!isAutoStartAvailable()) return;
    let disposed = false;
    setPending(true);
    setError('');
    void writeAutoStart(enabled)
      .then((outcome) => {
        if (disposed || outcome === null) return;
        setRefusal(outcome.supported ? '' : outcome.reason);
        // Adopt what the OS holds: a rejected write, or a build that cannot own
        // an entry at all, must not leave the switch claiming otherwise.
        if (outcome.enabled !== enabled) onChangeRef.current(outcome.enabled);
      })
      .catch((cause) => {
        if (!disposed) setError(toMessage(cause));
      })
      .finally(() => {
        if (!disposed) setPending(false);
      });
    return () => {
      disposed = true;
    };
  }, [enabled]);

  return {
    available: isAutoStartAvailable() && refusal === '',
    pending,
    error,
    reason: refusal
  };
}

function toMessage(cause: unknown): string {
  if (typeof cause === 'string') return cause;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
