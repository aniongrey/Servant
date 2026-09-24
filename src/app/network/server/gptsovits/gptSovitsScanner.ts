import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { GptSovitsScanResult, GptSovitsWeightEntry } from '../../gptSovitsContract.ts';

/**
 * Weight scanner for a GPT-SoVITS install root.
 *
 * Two independent sources, both deliberately shallow:
 *
 * 1. **Trained weights** — every directory *directly* under the root whose name
 *    starts with `GPT` or `SoVITS` is a weight container. That covers the
 *    official `GPT_weights_v*` / `SoVITS_weights_v*` as well as anything the user
 *    renamed them to. Only the files directly inside such a directory are read
 *    (one level, never recursing), so a huge install cannot slow the scan down.
 *    GPT-SoVITS always writes GPT weights as `.ckpt` and SoVITS weights as `.pth`,
 *    so the extension alone decides the kind.
 * 2. **Pretrained base models** — `GPT_SoVITS/pretrained_models`, listed by
 *    official Chinese alias exactly like the WebUI (`config.py::get_weights_names`).
 *
 * There is intentionally no unbounded/fallback walk: a root that points somewhere
 * unexpected must not mix unrelated `.ckpt`/`.pth` files (torch caches, other
 * projects) into the picker. What *is* tolerated is an off-by-one root — see
 * {@link candidateRoots}. That corrects *where we aim*, never how deep we read.
 */

/** A weight container is any root child whose name starts with one of these. */
const WEIGHT_DIR_PREFIXES = ['GPT', 'SoVITS'] as const;

/** Which side of the GPT/SoVITS pair an extension belongs to. */
const WEIGHT_EXTENSIONS: Readonly<Record<string, 'gpt' | 'sovits'>> = {
  '.ckpt': 'gpt',
  '.pth': 'sovits'
};

/** Version suffixes the official installer ships, used only for picker grouping. */
const KNOWN_VERSION_SUFFIXES = ['v1', 'v2', 'v2Pro', 'v2ProPlus', 'v3', 'v4'];

const PRETRAINED_DIR = ['GPT_SoVITS', 'pretrained_models'];
const MAX_PRESET_DEPTH = 4;

/** Official Chinese aliases, matched against paths relative to `pretrained_models`. */
const PRESET_ALIASES: ReadonlyArray<readonly [string, string, 'gpt' | 'sovits']> = [
  ['s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt', '不训练直接推v1底模！', 'gpt'],
  ['gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt', '不训练直接推v2底模！', 'gpt'],
  ['s1v3.ckpt', '不训练直接推v3底模！', 'gpt'],
  ['s2G488k.pth', '不训练直接推v1底模！', 'sovits'],
  ['gsv-v2final-pretrained/s2G2333k.pth', '不训练直接推v2底模！', 'sovits'],
  ['s2Gv3.pth', '不训练直接推v3底模！', 'sovits'],
  ['gsv-v4-pretrained/s2Gv4.pth', '不训练直接推v4底模！', 'sovits'],
  ['v2Pro/s2Gv2Pro.pth', '不训练直接推v2Pro底模！', 'sovits'],
  ['v2Pro/s2Gv2ProPlus.pth', '不训练直接推v2ProPlus底模！', 'sovits']
];

const VERSION_ORDER = ['底模', 'v1', 'v2', 'v2Pro', 'v2ProPlus', 'v3', 'v4', '其它'];
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

/**
 * Filenames that look like training artifacts rather than a loadable weight.
 * Beside the real GPT/SoVITS pair a training run also emits discriminators,
 * vocoders and speaker-verification models that must not be offered as a voice.
 */
const JUNK_WEIGHT_PREFIXES = [
  's2d', // SoVITS discriminator
  'vocoder',
  'sv.',
  'sv_',
  'dvae',
  'encoder',
  'decoder',
  'predictor',
  'wd.',
  'ar_',
  'optimizer',
  'pytorch_model',
  'aug'
];

/**
 * Everything a scan produces for one directory. The public result wraps this with
 * the root bookkeeping, so a candidate root can be scanned and inspected before
 * we commit to it.
 */
interface WeightInventory {
  gpt: GptSovitsWeightEntry[];
  sovits: GptSovitsWeightEntry[];
  missing: string[];
}

interface WeightDirectory {
  /** Directory name as it appears on disk, used verbatim in `label`. */
  name: string;
  absolute: string;
  /** The `GPT` / `SoVITS` prefix that made it a weight container. */
  prefix: (typeof WEIGHT_DIR_PREFIXES)[number];
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function isLikelyWeight(fileName: string): boolean {
  const lowered = fileName.toLowerCase();
  return !JUNK_WEIGHT_PREFIXES.some((prefix) => lowered.startsWith(prefix));
}

function readDirectory(directory: string) {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function matchesWeightPrefix(name: string): boolean {
  const lowered = name.toLowerCase();
  return WEIGHT_DIR_PREFIXES.some((prefix) => lowered.startsWith(prefix.toLowerCase()));
}

/** Sorted direct children of `directory`, as absolute paths. */
function childDirectories(directory: string): string[] {
  return readDirectory(directory)
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => collator.compare(left, right));
}

/**
 * Root children whose name starts with `GPT` / `SoVITS`, sorted so callers get a
 * stable order. One `readdir`, no recursion — the rule is intentionally that flat.
 */
function listWeightDirectories(root: string): WeightDirectory[] {
  const directories: WeightDirectory[] = [];
  for (const entry of readDirectory(root)) {
    if (!entry.isDirectory() || !matchesWeightPrefix(entry.name)) continue;
    const lowered = entry.name.toLowerCase();
    const prefix = WEIGHT_DIR_PREFIXES.find((candidate) => lowered.startsWith(candidate.toLowerCase()))!;
    directories.push({ name: entry.name, absolute: path.join(root, entry.name), prefix });
  }
  return directories.sort((left, right) => collator.compare(left.name, right.name));
}

/**
 * Version tag of a weight directory, only used to group the studio picker.
 * The unsuffixed official pair (`GPT_weights` / `SoVITS_weights`) is v1; a
 * directory that merely starts with `GPT`/`SoVITS` but isn't an official name
 * (e.g. `GPT_outputs`) lands in `其它`.
 */
function versionOfWeightDir(dirName: string): string {
  const suffix = /^(?:gpt|sovits)_weights(?:_(.+))?$/i.exec(dirName)?.[1];
  if (suffix === undefined) return '其它';
  if (!suffix) return 'v1';
  const known = KNOWN_VERSION_SUFFIXES.find(
    (candidate) => candidate.toLowerCase() === suffix.toLowerCase()
  );
  return known ?? '其它';
}

/** Files directly inside one weight container — no descent, extension decides the kind. */
function scanWeightDirectory(directory: WeightDirectory, out: WeightInventory): void {
  const version = versionOfWeightDir(directory.name);
  for (const entry of readDirectory(directory.absolute)) {
    if (!entry.isFile()) continue;
    const kind = WEIGHT_EXTENSIONS[path.extname(entry.name).toLowerCase()];
    if (!kind || !isLikelyWeight(entry.name)) continue;
    const rel = `${directory.name}/${entry.name}`;
    out[kind].push({
      name: path.basename(entry.name, path.extname(entry.name)),
      label: rel,
      file: entry.name,
      version,
      path: path.join(directory.absolute, entry.name),
      dir: directory.name,
      preset: false,
      rel
    });
  }
}

function presetMeta(relativeToPreset: string): { alias: string; kind: 'gpt' | 'sovits' } | null {
  const lowered = relativeToPreset.toLowerCase();
  for (const [rel, alias, kind] of PRESET_ALIASES) {
    if (lowered === rel.toLowerCase()) return { alias, kind };
  }
  const fileName = lowered.split('/').pop();
  for (const [rel, alias, kind] of PRESET_ALIASES) {
    if (rel.split('/').pop()!.toLowerCase() === fileName) return { alias, kind };
  }
  return null;
}

function scanPretrained(
  directory: string,
  root: string,
  out: WeightInventory,
  depth: number
): void {
  if (depth > MAX_PRESET_DEPTH) return;
  for (const entry of readDirectory(directory)) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scanPretrained(absolute, root, out, depth + 1);
      continue;
    }
    const extension = path.extname(entry.name).toLowerCase();
    if (extension !== '.ckpt' && extension !== '.pth') continue;
    const relativeToPreset = toPosix(path.relative(path.join(root, ...PRETRAINED_DIR), absolute));
    // Anything without an official alias is a training artifact (s2D discriminators,
    // vocoder.pth, sv/ speaker verification) and must not show up as a voice.
    const meta = presetMeta(relativeToPreset);
    if (!meta) continue;
    out[meta.kind].push({
      name: meta.alias,
      label: relativeToPreset,
      file: entry.name,
      version: '底模',
      path: absolute,
      preset: true,
      alias: meta.alias,
      rel: toPosix(path.relative(root, absolute))
    });
  }
}

/**
 * The directories worth aiming the scan at, in priority order.
 *
 * Typing the repo root is the only thing that *should* be required, but pointing
 * at the inner `GPT_SoVITS`, at one single weight folder, or at the folder that
 * merely *contains* the repo are all easy mistakes — and the reported symptom was
 * exactly "扫描不到模型". So a wrong root may be corrected by **one level**, up or
 * down, and only when that correction actually yields weights.
 */
function candidateRoots(root: string): string[] {
  const candidates = [root];
  const parent = path.dirname(root);
  if (parent && parent !== root && existsSync(parent)) candidates.push(parent);
  const children = childDirectories(root);
  // Only unambiguous when there is a single child to descend into.
  if (children.length === 1) candidates.push(children[0]);
  return candidates;
}

/** Scans one directory and returns its sorted, self-contained inventory. */
function scanInstallRoot(root: string): WeightInventory {
  const inventory: WeightInventory = { gpt: [], sovits: [], missing: [] };

  scanPretrained(path.join(root, ...PRETRAINED_DIR), root, inventory, 0);

  const discovered = listWeightDirectories(root);
  const seenPrefixes = new Set(discovered.map((directory) => directory.prefix));
  for (const directory of discovered) scanWeightDirectory(directory, inventory);
  // Told apart from "found the containers but they are empty": the UI can hint
  // that the directory is probably not a GPT-SoVITS install at all.
  for (const prefix of WEIGHT_DIR_PREFIXES) {
    if (!seenPrefixes.has(prefix)) inventory.missing.push(`${prefix}*`);
  }

  const rank = (version: string) => {
    const index = VERSION_ORDER.indexOf(version);
    return index === -1 ? 99 : index;
  };
  const byVersionThenLabel = (left: GptSovitsWeightEntry, right: GptSovitsWeightEntry) =>
    rank(left.version) - rank(right.version) || collator.compare(left.label, right.label);
  inventory.gpt.sort(byVersionThenLabel);
  inventory.sovits.sort(byVersionThenLabel);
  return inventory;
}

export function scanGptSovitsModels(root: string): GptSovitsScanResult {
  const result: GptSovitsScanResult = { gpt: [], sovits: [], root: root || '', missing: [] };
  if (!root) {
    result.error = '尚未设置安装目录';
    return result;
  }
  if (!existsSync(root)) {
    result.error = '安装目录不存在';
    return result;
  }

  const [typed, ...alternatives] = candidateRoots(root);
  let scanned = scanInstallRoot(typed);
  let scanRoot = typed;
  if (scanned.gpt.length === 0 && scanned.sovits.length === 0) {
    for (const alternative of alternatives) {
      const inventory = scanInstallRoot(alternative);
      if (inventory.gpt.length + inventory.sovits.length > 0) {
        scanned = inventory;
        scanRoot = alternative;
        break;
      }
    }
  }

  result.gpt = scanned.gpt;
  result.sovits = scanned.sovits;
  result.missing = scanned.missing;
  // Reported only when the typed root had to be corrected, so the UI can say so
  // instead of silently scanning a directory the user never chose.
  if (scanRoot !== root) result.scanRoot = scanRoot;
  return result;
}
