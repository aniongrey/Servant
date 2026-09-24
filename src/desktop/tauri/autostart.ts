/**
 * Login-startup entry, owned by the desktop shell.
 *
 * The shell answers with the state the OS actually ended up in, so callers can
 * trust the returned value over the one they asked for. It also reports whether
 * this build can own an entry at all: a development build is handed its pages
 * by the dev server, so an entry it registered would open an empty window at
 * login. Outside Tauri there is no entry to manage and the helper resolves to
 * `null`.
 */
export interface AutoStartOutcome {
  /** False when this build cannot own a login entry; `reason` says why. */
  supported: boolean;
  /** Why not, when `supported` is false; empty otherwise. Meant for the user. */
  reason: string;
  /** Whether a login entry exists now — not an echo of the request. */
  enabled: boolean;
}

export function isAutoStartAvailable(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/**
 * Serialized write: a fast on/off toggle must not let an older request land
 * after a newer one, which would leave the OS entry contradicting the switch.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export function writeAutoStart(enabled: boolean): Promise<AutoStartOutcome | null> {
  const next = writeQueue.then(
    () => runWrite(enabled),
    () => runWrite(enabled)
  );
  writeQueue = next.catch(() => undefined);
  return next;
}

async function runWrite(enabled: boolean): Promise<AutoStartOutcome | null> {
  if (!isAutoStartAvailable()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<AutoStartOutcome>('set_autostart', { enabled });
}
