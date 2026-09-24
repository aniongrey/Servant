import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { characterSkillApi } from './characterSkillApi';

describe('character skill API', () => {
  let server: Server | undefined;
  let directory: string | undefined;
  let defaults: string | undefined;
  afterEach(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve()))
      );
    if (directory) await rm(directory, { recursive: true, force: true });
    if (defaults) await rm(defaults, { recursive: true, force: true });
  });
  async function start() {
    directory = await mkdtemp(path.join(os.tmpdir(), 'servant-skill-test-'));
    defaults = await mkdtemp(path.join(os.tmpdir(), 'servant-skill-default-'));
    const defaultSkill = path.join(defaults, 'skills.md');
    await writeFile(defaultSkill, '# 默认角色\n');
    const plugin = characterSkillApi(directory, defaultSkill);
    plugin.configureServer({
      middlewares: {
        use: (handler) => {
          server = createServer((request, response) =>
            handler(request, response, () => {
              response.statusCode = 404;
              response.end();
            })
          );
        }
      }
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server!.address() as { port: number }).port}/api/character-skill`;
  }
  it('imports, selects, persists and deletes cards without reading the old single-card store', async () => {
    const url = await start();
    await writeFile(
      path.join(directory!, 'skill.json'),
      JSON.stringify({ fileName: 'old.md', markdown: '# 旧卡' })
    );
    expect(await (await fetch(url)).json()).toEqual({
      id: 'builtin',
      fileName: 'skills.md',
      markdown: '# 默认角色\n'
    });
    expect(
      (await fetch(url, { headers: { Origin: 'http://tauri.localhost' } })).headers.get(
        'access-control-allow-origin'
      )
    ).toBe('http://tauri.localhost');
    const saved = { fileName: 'alice.md', markdown: '# Alice\n' };
    const imported = await (
      await fetch(`${url}/library`, { method: 'POST', body: JSON.stringify(saved) })
    ).json();
    const id = imported.activeId;
    expect(imported.cards).toHaveLength(2);
    expect(await (await fetch(url)).json()).toEqual({ ...saved, id });
    await fetch(`${url}/library`, { method: 'PUT', body: JSON.stringify({ id: 'builtin' }) });
    expect((await (await fetch(url)).json()).id).toBe('builtin');
    await fetch(`${url}/library`, { method: 'PUT', body: JSON.stringify({ id }) });
    const persisted = JSON.parse(await readFile(path.join(directory!, 'library.json'), 'utf8'));
    expect(persisted.activeId).toBe(id);
    expect((await fetch(`${url}/library/builtin`, { method: 'DELETE' })).status).toBe(400);
    const deleted = await (await fetch(`${url}/library/${id}`, { method: 'DELETE' })).json();
    expect(deleted.activeId).toBe('builtin');
    expect(deleted.cards).toHaveLength(1);
  });
  it('rejects invalid content and cross-origin writes', async () => {
    const url = await start();
    expect((await fetch(`${url}/library`, { method: 'POST', body: '{}' })).status).toBe(400);
    expect((await fetch(`${url}/library`, { method: 'PUT', body: '{"id":"missing"}' })).status).toBe(400);
    expect(
      (
        await fetch(`${url}/library`, {
          method: 'POST',
          headers: { Origin: 'https://unrelated.example' },
          body: JSON.stringify({ fileName: 'x.md', markdown: '# x' })
        })
      ).status
    ).toBe(403);
  });
  it('keeps both cards when imports arrive concurrently', async () => {
    const url = await start();
    const responses = await Promise.all(
      ['a', 'b'].map((name) =>
        fetch(`${url}/library`, {
          method: 'POST',
          body: JSON.stringify({ fileName: `${name}.md`, markdown: `# ${name}` })
        })
      )
    );
    expect(responses.every((response) => response.ok)).toBe(true);
    const library = await (await fetch(`${url}/library`)).json();
    expect(library.cards.map((card: { fileName: string }) => card.fileName).sort()).toEqual([
      'a.md',
      'b.md',
      'skills.md'
    ]);
  });
});
