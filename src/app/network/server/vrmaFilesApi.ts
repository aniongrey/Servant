import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { MiddlewareHost } from './httpMiddleware.ts';
import { apiPathOf, sendJson } from './httpMiddleware.ts';
import { readOnlyFile, type ProjectPaths } from './projectPaths.ts';

export const VRMA_FILES_API = '/api/vrma-files';
export const VRMA_ASSETS_DIRECTORY = 'public/assets/motions';
// The bundled clips live flat in `public/assets/motions/vrma/`, so depth 1 is all
// that is needed. The limit is kept one level higher so that parking a few clips in
// a subfolder exposes them instead of silently hiding them.
export const VRMA_MAX_DIRECTORY_DEPTH = 2;

/** Lists the `.vrma` clips available to the motion editor. */
export function vrmaFilesApi(paths: ProjectPaths) {
  const configure = (server: MiddlewareHost) => {
    server.middlewares.use(async (request, response, next) => {
      if (apiPathOf(request) !== VRMA_FILES_API) {
        next();
        return;
      }
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'VRMA files only supports GET' });
        return;
      }
      try {
        const files: string[] = [];
        const scan = async (
          directory: string,
          relativeDirectory: string,
          depth: number
        ): Promise<void> => {
          const entries = await readdir(directory, { withFileTypes: true });
          for (const entry of entries) {
            const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
            if (entry.isFile() && entry.name.toLowerCase().endsWith('.vrma')) files.push(relative);
            else if (entry.isDirectory() && depth < VRMA_MAX_DIRECTORY_DEPTH)
              await scan(path.join(directory, entry.name), relative, depth + 1);
          }
        };
        await scan(readOnlyFile(paths, VRMA_ASSETS_DIRECTORY), '', 0);
        files.sort((a, b) => a.localeCompare(b));
        sendJson(response, 200, { files, maxDirectoryDepth: VRMA_MAX_DIRECTORY_DEPTH });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : 'Failed to scan VRMA files'
        });
      }
    });
  };
  return { name: 'vrma-files-api', configureServer: configure, configurePreviewServer: configure };
}
