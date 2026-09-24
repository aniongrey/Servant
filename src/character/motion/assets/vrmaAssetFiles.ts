import { toServedAssetUrl } from '../../../app/utils/servedAssetUrl';

/**
 * The single place that knows where the bundled VRMA clips live.
 *
 * `public/assets/motions/vrma/` is flat by contract: one directory, one clip per
 * file, and the file name is the clip's pinyin id — `daiji` = 待机, `sikao` = 思考,
 * `huishou` = 挥手. `name` is the identifier every other layer speaks: the keys of
 * `vrma-segments.json`, the `vrma` field of the action configs, the file list
 * `/api/vrma-files` returns, and the value `ActionLoader` turns into a URL. Add a
 * clip by dropping the file in and rebuilding — there is no registry to edit.
 *
 * The clips are not tracked by Git (`.gitignore` keeps every `[Vv][Rr][Mm][Aa]/`
 * directory out of the repository), so the glob below is the whole inventory.
 */
export interface BundledVrmaClip {
  /** Path relative to `public/assets/motions`, e.g. `vrma/daiji.vrma`. */
  name: string;
  /** File name without the extension, e.g. `daiji`. */
  id: string;
  /** Fetchable URL, e.g. `/assets/motions/vrma/daiji.vrma`. */
  url: string;
}

// `import.meta.glob` only accepts a literal pattern, so the path cannot be
// factored into a constant even though `name` below derives from the same string.
const bundledVrmaModuleUrls = import.meta.glob('/public/assets/motions/vrma/*.vrma', {
  eager: true,
  import: 'default',
  query: '?url'
}) as Record<string, string>;

export const bundledVrmaClips: BundledVrmaClip[] = Object.entries(bundledVrmaModuleUrls)
  .map(([modulePath, moduleUrl]) => {
    const name = modulePath.replace(/^\/public\/assets\/motions\//, '');
    return {
      name,
      id: name.replace(/^.*\//, '').replace(/\.vrma$/i, ''),
      url: toServedAssetUrl(moduleUrl)
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name));

/** The neutral standing clip the debug combination actions fall back to. */
export const VRMA_IDLE_CLIP_NAME = 'vrma/daiji.vrma';
