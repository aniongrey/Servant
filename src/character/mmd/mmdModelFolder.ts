import { isMmdTextureFile, type TextureMap } from '@yohawing/three-mmd-loader/three';
import {
  asTextureBlob,
  packModelArchive,
  unpackModelArchive,
  type ModelArchiveEntry
} from '../vrm/modelArchive';
import type { MmdModelSource } from './MmdCharacter';

/**
 * PMX model folders, as the app sees them.
 *
 * A PMX is authored as a folder: the model file sits at the top and everything
 * it references — `toon2.png` beside it, `textures/*.png` below it — is found by
 * the paths spelled into its material table. So "import a PMX" really means
 * "import the folder around it, then load the model with its textures supplied
 * by hand" (the loader has no URL to resolve them against).
 *
 * Both halves live here: turning a picked folder into one stored record, and
 * turning that record back into something `loadMmdCharacter` can consume.
 */

const MMD_MODEL_PATTERN = /\.(pmx|pmd)$/i;

/** A picked folder, ready to be saved as one imported-model record. */
export interface MmdFolderModel {
  /** The model file's own name, which is what the library lists. */
  name: string;
  /** The packed folder, carrying the model and every texture it needs. */
  blob: Blob;
}

/**
 * The models sitting directly in the picked folder.
 *
 * Depth is the point: a folder holding one model keeps it at the top, while
 * `motions/` and `textures/` sit below — so a PMX found in a subfolder is a
 * different model's file or a bundled extra, not the one being imported. Files
 * nested deeper are still packed, as texture sources.
 */
export function findFolderModels(files: readonly File[]): File[] {
  return files
    .filter((file) => MMD_MODEL_PATTERN.test(file.name) && !relativePathOf(file).includes('/'))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Packs each model of a picked folder into its own container.
 *
 * Every container carries the folder's texture files, but not its sibling models:
 * a folder with two PMX files is two importable models sharing one texture set,
 * and copying each other's model bytes into both records would double the
 * storage for no gain. Files that are neither a model nor a texture — readmes,
 * `.vmd` motions — are dropped for the same reason.
 */
export async function packFolderModels(files: readonly File[]): Promise<MmdFolderModel[]> {
  const models = findFolderModels(files);
  if (!models.length) {
    throw new Error('所选文件夹里没有 PMX / PMD 文件（模型需位于该文件夹的第一层）');
  }

  const resources: ModelArchiveEntry[] = [];
  for (const file of files) {
    if (MMD_MODEL_PATTERN.test(file.name)) continue;
    const path = relativePathOf(file);
    if (!isMmdTextureFile({ name: path })) continue;
    resources.push({ path, data: new Uint8Array(await file.arrayBuffer()) });
  }

  return Promise.all(
    models.map(async (model) => {
      const entry: ModelArchiveEntry = {
        path: relativePathOf(model),
        data: new Uint8Array(await model.arrayBuffer())
      };
      return { name: model.name, blob: packModelArchive([entry, ...resources]) };
    })
  );
}

/** Unpacks a stored folder into what the MMD loader needs. */
export async function readMmdModelSource(blob: Blob): Promise<MmdModelSource> {
  const entries = await unpackModelArchive(blob);
  const model = findModelEntry(entries);
  if (!model) throw new Error('模型容器里没有 PMX / PMD 文件');
  return { model: model.data, textures: createMmdTextureMap(entries, model.path) };
}

/**
 * Texture lookup for a model loaded from bytes.
 *
 * The loader reads a material's texture path straight out of the PMX and looks
 * it up here before falling back to resolving it against the model URL — which
 * does not exist for an imported model. Keys therefore have to cover every shape
 * that path can take: the path as packed (`textures/_01.png`), the path relative
 * to the model file, and the bare file name, since PMX files in the wild use all
 * three interchangeably.
 */
export function createMmdTextureMap(
  entries: readonly ModelArchiveEntry[],
  modelPath: string
): TextureMap {
  const directory = modelPath.includes('/') ? modelPath.slice(0, modelPath.lastIndexOf('/') + 1) : '';
  const map: TextureMap = {};
  for (const entry of entries) {
    if (entry.path === modelPath) continue;
    const blob = asTextureBlob(entry.data);
    const relative =
      directory && entry.path.startsWith(directory) ? entry.path.slice(directory.length) : entry.path;
    map[entry.path] = blob;
    map[relative] = blob;
    map[entry.path.slice(entry.path.lastIndexOf('/') + 1)] = blob;
  }
  return map;
}

/** The folder-relative path of a picked file, with the picked folder itself removed. */
function relativePathOf(file: File): string {
  const raw = (file.webkitRelativePath || file.name).replace(/\\/g, '/').replace(/^\/+/, '');
  const separator = raw.indexOf('/');
  return separator === -1 ? raw : raw.slice(separator + 1);
}

function findModelEntry(entries: readonly ModelArchiveEntry[]): ModelArchiveEntry | undefined {
  const models = entries.filter((entry) => MMD_MODEL_PATTERN.test(entry.path));
  return models.find((entry) => !entry.path.includes('/')) ?? models[0];
}
