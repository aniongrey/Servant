import { isTauriDesktop } from './navigation';

/**
 * Native directory picker, owned by the desktop shell.
 *
 * It answers with a decision instead of throwing, because "the user cancelled"
 * and "this host has no native dialog" are both ordinary outcomes for a page
 * that also runs in a plain browser tab — and the caller needs to tell them
 * apart to decide whether to say anything at all.
 */
export type DirectoryPick =
  | { kind: 'picked'; path: string }
  | { kind: 'cancelled' }
  /** No native dialog in this host — a browser preview, not a desktop window. */
  | { kind: 'unavailable' }
  | { kind: 'failed'; message: string };

export interface DirectoryPickOptions {
  title?: string;
  /** Suggested starting location. A hint only — see {@link pickDirectory}. */
  defaultPath?: string;
}

export async function pickDirectory(options: DirectoryPickOptions = {}): Promise<DirectoryPick> {
  if (!isTauriDesktop()) return { kind: 'unavailable' };
  try {
    return await showDialog(options.defaultPath, options.title);
  } catch (error) {
    // Windows refuses to open the dialog when the suggested location does not
    // exist — the normal state on a first run, before anything was downloaded.
    // Drop the hint and ask again rather than reporting a dead end the user can
    // do nothing about.
    if (!options.defaultPath) return { kind: 'failed', message: describe(error) };
    try {
      return await showDialog(undefined, options.title);
    } catch (retryError) {
      return { kind: 'failed', message: describe(retryError) };
    }
  }
}

async function showDialog(
  defaultPath: string | undefined,
  title: string | undefined
): Promise<DirectoryPick> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    directory: true,
    multiple: false,
    ...(title ? { title } : {}),
    ...(defaultPath ? { defaultPath } : {})
  });
  return typeof picked === 'string' && picked.trim()
    ? { kind: 'picked', path: picked }
    : { kind: 'cancelled' };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
