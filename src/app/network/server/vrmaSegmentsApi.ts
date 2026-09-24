import type { MiddlewareHost } from './httpMiddleware.ts';
import { apiPathOf, isRecord, readRequestText, sendJson } from './httpMiddleware.ts';
import { readMutableFile, writeMutableFile, type ProjectPaths } from './projectPaths.ts';
import { updateVrmaSegment } from '../updateVrmaSegment.ts';
import type { VrmaSegmentConfig, VrmaSegment } from '../../../character/motion/assets/vrmaSegments.ts';
import {
  findEmotionSegment,
  type EmotionDefinition
} from '../../../character/motion/actions/emotionConfig.ts';

export const VRMA_SEGMENTS_API = '/api/vrma-segments';
export const VRMA_SEGMENTS_FILE = 'src/character/motion/assets/vrma-segments.json';
export const FULL_BODY_MOTION_CONFIG_FILE =
  'src/character/motion/assets/actions/full-body-motion-config.json';

export const VALID_VRMA_SEGMENT_PARTS = [
  'Root',
  'LowerBody',
  'Torso',
  'Head',
  'LeftArm',
  'RightArm',
  'Face'
] as const;

/** Editor endpoint for named sub-clips inside a `.vrma` file. */
export function vrmaSegmentsApi(paths: ProjectPaths) {
  const configure = (server: MiddlewareHost) => {
    server.middlewares.use(async (request, response, next) => {
      if (apiPathOf(request) !== VRMA_SEGMENTS_API) {
        next();
        return;
      }
      try {
        const config = JSON.parse(await readMutableFile(paths, VRMA_SEGMENTS_FILE)) as Record<
          string,
          unknown[]
        >;
        if (request.method === 'GET') {
          sendJson(response, 200, config);
          return;
        }
        if (request.method === 'DELETE') {
          const body = JSON.parse(await readRequestText(request, 256 * 1024)) as {
            vrma?: unknown;
            index?: unknown;
          };
          const index = typeof body.index === 'number' ? body.index : NaN;
          if (
            typeof body.vrma !== 'string' ||
            !Number.isInteger(index) ||
            !Array.isArray(config[body.vrma]) ||
            index < 0 ||
            index >= config[body.vrma].length
          ) {
            sendJson(response, 400, { error: 'Invalid VRMA segment index' });
            return;
          }
          const removed = config[body.vrma][index] as VrmaSegment;
          const actions = JSON.parse(await readMutableFile(paths, FULL_BODY_MOTION_CONFIG_FILE));
          const emotionActions = (actions.emotion ?? {}) as Record<
            string,
            { vrma: EmotionDefinition['vrma'] }
          >;
          const references = Object.entries(emotionActions).filter(
            ([, action]) => findEmotionSegment(action.vrma, config as VrmaSegmentConfig) === removed
          );
          if (references.length) {
            sendJson(response, 409, {
              error: `请先重新绑定 emotion：${references.map(([id]) => id).join('、')}`
            });
            return;
          }
          config[body.vrma].splice(index, 1);
          if (config[body.vrma].length === 0) delete config[body.vrma];
          await writeMutableFile(paths, VRMA_SEGMENTS_FILE, `${JSON.stringify(config, null, 2)}\n`);
          sendJson(response, 200, { ok: true });
          return;
        }
        if (!['POST', 'PUT'].includes(request.method ?? '')) {
          sendJson(response, 405, { error: 'Only GET, POST, PUT and DELETE are supported' });
          return;
        }
        const body = JSON.parse(await readRequestText(request, 1024 * 1024)) as {
          vrma?: unknown;
          start?: unknown;
          end?: unknown;
          description?: unknown;
          parts?: unknown;
          loop?: unknown;
          index?: number;
          original?: VrmaSegment;
        };
        const start = typeof body.start === 'number' ? body.start : NaN;
        const end = typeof body.end === 'number' ? body.end : NaN;
        const loop = body.loop as { mode?: unknown; blendFrames?: unknown } | undefined;
        const loopValid =
          loop === undefined ||
          (isRecord(loop) &&
            ['none', 'repeat', 'pingpong', 'blend'].includes(String(loop.mode)) &&
            (loop.mode !== 'blend' || (Number.isInteger(loop.blendFrames) && Number(loop.blendFrames) >= 0)));
        if (
          typeof body.vrma !== 'string' ||
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 0 ||
          end < start ||
          typeof body.description !== 'string' ||
          !Array.isArray(body.parts) ||
          body.parts.length === 0 ||
          !body.parts.every((part) =>
            (VALID_VRMA_SEGMENT_PARTS as readonly string[]).includes(String(part))
          ) ||
          !loopValid
        ) {
          sendJson(response, 400, { error: 'Invalid VRMA segment' });
          return;
        }
        const list = Array.isArray(config[body.vrma]) ? config[body.vrma] : [];
        const replacement = {
          start,
          end,
          description: body.description.trim(),
          parts: body.parts as VrmaSegment['parts'],
          ...(loop ? { loop } : {})
        } as VrmaSegment;
        if (request.method === 'PUT') {
          const previousSegments = await readMutableFile(paths, VRMA_SEGMENTS_FILE);
          const actions = JSON.parse(await readMutableFile(paths, FULL_BODY_MOTION_CONFIG_FILE));
          let updated;
          try {
            updated = updateVrmaSegment(
              config as VrmaSegmentConfig,
              actions,
              body.vrma,
              body.index!,
              body.original!,
              replacement
            );
          } catch (error) {
            sendJson(response, 409, { error: String(error) });
            return;
          }
          await writeMutableFile(paths, VRMA_SEGMENTS_FILE, `${JSON.stringify(updated.segments, null, 2)}\n`);
          try {
            await writeMutableFile(
              paths,
              FULL_BODY_MOTION_CONFIG_FILE,
              `${JSON.stringify(updated.actions, null, 2)}\n`
            );
          } catch (error) {
            await writeMutableFile(paths, VRMA_SEGMENTS_FILE, previousSegments);
            throw error;
          }
          sendJson(response, 200, { ok: true, segments: updated.segments });
          return;
        }
        list.push(replacement);
        config[body.vrma] = list;
        await writeMutableFile(paths, VRMA_SEGMENTS_FILE, `${JSON.stringify(config, null, 2)}\n`);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : 'Failed to save VRMA segment'
        });
      }
    });
  };
  return {
    name: 'vrma-segments-api',
    configureServer: configure,
    configurePreviewServer: configure
  };
}
