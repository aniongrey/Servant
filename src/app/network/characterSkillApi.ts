import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { apiPathOf, applyLocalCors, readRequestText, sendJson } from './server/httpMiddleware.ts';
import { resolveProjectPaths } from './server/projectPaths.ts';

export const CHARACTER_SKILL_API = '/api/character-skill';
const MAX_SKILL_BYTES = 512 * 1024;

interface StoredCharacterSkill {
  fileName: string;
  markdown: string;
}
interface Card extends StoredCharacterSkill {
  id: string;
}
interface Library {
  activeId: string;
  cards: Card[];
}

/** Writable-root-relative home of the card library. */
export const CHARACTER_SKILL_DIRECTORY = '.local/character-skill';
/** Read-only-root-relative path of the bundled default card. */
export const DEFAULT_CHARACTER_SKILL_FILE = 'src/character/state/assets/data/shiro/skills.md';

/**
 * Defaults are resolved against the project roots, never against the working
 * directory: once packaged the CWD is the read-only folder holding the
 * executable, so a missing argument would otherwise read and write there.
 */
export const DEFAULT_CHARACTER_SKILL_DIRECTORY = path.resolve(
  resolveProjectPaths().data,
  CHARACTER_SKILL_DIRECTORY
);

/**
 * The character card library: the active card plus every card the user imported.
 * Card traffic is serialized so concurrent imports cannot clobber each other.
 */
export function characterSkillApi(
  directory = DEFAULT_CHARACTER_SKILL_DIRECTORY,
  defaultSkillPath = path.resolve(resolveProjectPaths().root, DEFAULT_CHARACTER_SKILL_FILE)
) {
  let pending: Promise<void> = Promise.resolve();
  const configure = (server: {
    middlewares: {
      use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
    };
  }) => {
    server.middlewares.use((request, response, next) => {
      const route = apiPathOf(request);
      if (route !== CHARACTER_SKILL_API && !route.startsWith(`${CHARACTER_SKILL_API}/`)) {
        next();
        return;
      }
      pending = pending
        .then(() => handle(request, response, route))
        .catch((error) =>
          sendJson(response, 400, {
            error: error instanceof Error ? error.message : 'Character card request failed'
          })
        );
    });
  };

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    route: string
  ): Promise<void> {
    if (applyLocalCors(request, response)) return;
    const library = await readLibrary();
    if (
      request.method === 'GET' &&
      (route === CHARACTER_SKILL_API || route === `${CHARACTER_SKILL_API}/library`)
    ) {
      sendJson(
        response,
        200,
        route === CHARACTER_SKILL_API
          ? library.cards.find((card) => card.id === library.activeId) ?? null
          : library
      );
      return;
    }
    if (route === `${CHARACTER_SKILL_API}/library` && request.method === 'POST') {
      const skill = validateSkill(JSON.parse(await readRequestText(request, MAX_SKILL_BYTES)));
      const card = { ...skill, id: randomUUID() };
      library.cards.push(card);
      library.activeId = card.id;
    } else if (route === `${CHARACTER_SKILL_API}/library` && request.method === 'PUT') {
      const { id } = JSON.parse(await readRequestText(request, 1024)) as { id?: unknown };
      if (typeof id !== 'string' || (id !== '' && !library.cards.some((card) => card.id === id)))
        throw new Error('角色卡不存在。');
      library.activeId = id;
    } else if (route.startsWith(`${CHARACTER_SKILL_API}/library/`) && request.method === 'DELETE') {
      const id = decodeURIComponent(route.slice(`${CHARACTER_SKILL_API}/library/`.length));
      if (id === 'builtin') throw new Error('内置角色卡不可删除。');
      if (!library.cards.some((card) => card.id === id)) throw new Error('角色卡不存在。');
      library.cards = library.cards.filter((card) => card.id !== id);
      if (library.activeId === id) library.activeId = 'builtin';
    } else {
      sendJson(response, 405, { error: 'Unsupported character card operation' });
      return;
    }
    await writeLibrary(library);
    sendJson(response, 200, library);
  }

  async function readLibrary(): Promise<Library> {
    try {
      const value = JSON.parse(await readFile(path.join(directory, 'library.json'), 'utf8'));
      if (!Array.isArray(value.cards) || typeof value.activeId !== 'string')
        throw new Error('Invalid character card library');
      const cards: Card[] = value.cards.map((card: Card) => {
        if (!card || typeof card.id !== 'string' || !card.id)
          throw new Error('Invalid character card ID');
        return { ...validateSkill(card), id: card.id };
      });
      if (
        new Set(cards.map((card) => card.id)).size !== cards.length ||
        !cards.some((card) => card.id === 'builtin') ||
        (value.activeId !== '' && !cards.some((card) => card.id === value.activeId))
      )
        throw new Error('Invalid character card selection');
      return { activeId: value.activeId, cards };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const library: Library = {
        activeId: 'builtin',
        cards: [
          { id: 'builtin', fileName: 'skills.md', markdown: await readFile(defaultSkillPath, 'utf8') }
        ]
      };
      await writeLibrary(library);
      return library;
    }
  }

  async function writeLibrary(library: Library): Promise<void> {
    await mkdir(directory, { recursive: true });
    const temporaryPath = path.join(directory, `library-${randomUUID()}.tmp`);
    await writeFile(temporaryPath, JSON.stringify(library), 'utf8');
    await rename(temporaryPath, path.join(directory, 'library.json'));
  }

  return { name: 'character-skill-api', configureServer: configure, configurePreviewServer: configure };
}

function validateSkill(value: unknown): StoredCharacterSkill {
  if (!value || typeof value !== 'object') throw new Error('Invalid character skill');
  const { fileName, markdown } = value as Partial<StoredCharacterSkill>;
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 255)
    throw new Error('Invalid character skill file name');
  if (
    typeof markdown !== 'string' ||
    !markdown.trim() ||
    Buffer.byteLength(markdown, 'utf8') > MAX_SKILL_BYTES
  )
    throw new Error('Invalid character skill content');
  return { fileName: fileName.trim(), markdown };
}
