import { isModelArchive } from './modelArchive';

/**
 * URLs for imported models, plus the one piece of knowledge a URL cannot carry.
 *
 * `VrmModelLoader.load` is handed nothing but a URL, and every caller builds
 * that URL the same way — `URL.createObjectURL` over a record read back from the
 * imported-model store. A VRM blob is self-contained, so the URL is enough. A
 * packed PMX folder is not: the textures inside it can only be found by name,
 * and the loader has to be told they exist before it walks the materials.
 *
 * Registering the container here keeps that difference out of every call site.
 * The alternative — encoding "this is an archive" into the URL itself — would
 * make the loader parse a string to learn something it could have been told, and
 * would leave no way to reach the bytes without re-fetching them.
 *
 * The map is per window, which is the right scope: the pet window, the chat
 * window and the settings window each hold their own blob URLs and each read
 * their own records, so none of them can see another's keys.
 */

const archives = new Map<string, Blob>();

export interface ImportedModelUrl {
  url: string;
  /** Revokes the URL and drops the container it referenced. */
  dispose(): void;
}

/**
 * Turns an imported model record's bytes into a loadable URL.
 *
 * A packed folder is registered as well as converted, so `resolveModelArchive`
 * can hand it back when the loader asks. A single-file VRM is not: registering
 * it would keep a 20 MiB blob alive for nothing.
 */
export function createImportedModelUrl(blob: Blob): ImportedModelUrl {
  const url = URL.createObjectURL(blob);
  if (isModelArchive(blob)) archives.set(url, blob);
  return {
    url,
    dispose() {
      archives.delete(url);
      URL.revokeObjectURL(url);
    }
  };
}

/** The packed model folder behind `url`, when the loader is given an imported one. */
export function resolveModelArchive(url: string): Blob | undefined {
  return archives.get(url);
}
