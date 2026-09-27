// Isolated browser checks: real production UI and image storage, no user's settings or LLM calls.
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { avatarImageApi } from '../src/app/network/server/avatarImageApi.ts';

const output = path.resolve('.local/stage-verification');
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 5197, strictPort: true },
  plugins: [avatarImageApi(path.join(output, 'backgrounds'), '/api/stage-backgrounds', 20 * 1024 * 1024)] });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
context.setDefaultTimeout(15000);
const errors = [];
context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
await context.routeWebSocket('**', (socket) => socket.close());
await context.addInitScript(() => {
  window.entrySoundCalls = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (new URL(this.src, location.href).pathname === '/assets/fx/trans.wav') {
      window.entrySoundCalls.push(this.src);
      return Promise.resolve();
    }
    return play.call(this);
  };
});
await context.route('**/api/**', (route) => {
  const url = route.request().url();
  if (url.includes('/api/stage-backgrounds')) return route.continue();
  if (url.includes('/api/character-skill')) return route.fulfill({ json: { cards: [], activeId: 'builtin' } });
  return route.fulfill({ status: 404, json: { error: 'Isolated UI verification' } });
});
await context.addInitScript(() => {
  if (location.origin !== 'http://127.0.0.1:5197') return;
  if (localStorage.getItem('stage-test-seeded')) return;
  localStorage.setItem('stage-test-seeded', 'true');
  const profiles = ['main', 'guest', 'visitor'].map((id, index) => ({ id, name: ['主角色', '同伴', '来客'][index], isMain: index === 0, vrmId: 'main', avatarId: 'default', voiceId: '', characterCardId: 'builtin', createdAt: Date.now() }));
  localStorage.setItem('servant.characterProfiles.v1', JSON.stringify(profiles));
  localStorage.setItem('servant.meetings.v1', JSON.stringify([{ id: 'stage-test', title: '樱花树下的约定', goal: '', participants: ['main', 'guest'], messages: [{ id: 'hello', senderId: 'main', text: '今天也一起在这里度过吧。', createdAt: Date.now() }], queue: [], status: 'active', mode: 'manual', conclusions: [], tasks: [], summary: '', updatedAt: Date.now() }]));
  localStorage.setItem('servant.meetingDesktopCast.v1', 'stage-test');
});
try {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5197/pages/desktop.html');
  await page.getByRole('navigation', { name: '舞台工具栏' }).waitFor();
  console.log('Stage mounted');
  await page.locator('.desktop-cast-actor').first().waitFor();
  await page.locator('.desktop-cast-actor .vrmStageRoot[aria-busy=false]').first().waitFor();
  assert.deepEqual(await page.evaluate(() => window.entrySoundCalls), [], 'automatic desktop loading must not play summon audio');
  const summon = await context.newPage();
  await summon.goto('http://127.0.0.1:5197/pages/magic-circle-demo.html');
  const summonButton = summon.getByRole('button', { name: /召唤角色/ });
  await summonButton.waitFor();
  assert.deepEqual(await summon.evaluate(() => window.entrySoundCalls), []);
  await summonButton.click();
  assert.equal(await summon.evaluate(() => window.entrySoundCalls.length), 1, 'explicit summon must still play its audio once');
  await summon.close();
  console.log('PASS entry audio: automatic model loading is silent; explicit summon plays once');
  if (!process.argv.includes('--entry-audio-only')) {
  await page.getByRole('button', { name: '背景', exact: true }).click();
  await page.getByRole('button', { name: '城市夜色', exact: true }).click();
  assert.match(await page.locator('.galgame-background').getAttribute('style'), /stage-night/);
  await page.locator('input[type=file]').setInputFiles('public/assets/backgrounds/sakura-settings-1080p.png');
  await page.getByRole('button', { name: 'sakura-settings-1080p.png', exact: true }).waitFor();
  assert.match(await page.locator('.galgame-background').getAttribute('style'), /stage-backgrounds/);
  await page.getByRole('button', { name: '布局', exact: true }).click();
  await page.getByRole('button', { name: '半身', exact: true }).click();
  await page.getByLabel('场景名称', { exact: true }).fill('测试场景');
  await page.getByRole('button', { name: '保存当前场景', exact: true }).click();
  await page.getByRole('button', { name: '画面复位', exact: true }).click();
  await page.getByRole('button', { name: '测试场景', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('servant.stageScene.v1')).layout.main?.zoom === 3.5);
  await page.getByRole('button', { name: '灯光', exact: true }).click();
  await page.getByRole('button', { name: '调整整个舞台光照…', exact: true }).click();
  await page.getByRole('button', { name: '夜景', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('servant.stageScene.v1')).lighting), null);
  await page.getByRole('button', { name: '调整整个舞台光照…', exact: true }).click();
  await page.getByRole('button', { name: '夜景', exact: true }).click();
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('servant.stageScene.v1')).lighting?.mainLightIntensity === 1.1);
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.keyboard.press('h');
  await page.getByRole('button', { name: '显示界面 · H', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'stage.png') });
  await page.reload();
  await page.getByRole('navigation', { name: '舞台工具栏' }).waitFor();
  assert.match(await page.locator('.galgame-background').getAttribute('style'), /stage-backgrounds/);
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await page.getByRole('button', { name: '隐藏同伴', exact: true }).click();
  assert.equal(await page.locator('[data-character-id=guest]').evaluate((element) => getComputedStyle(element).display), 'none');
  await page.getByRole('button', { name: '显示同伴', exact: true }).click();
  const meetingPage = await context.newPage();
  await meetingPage.goto('http://127.0.0.1:5197/pages/meeting.html');
  await meetingPage.getByRole('button', { name: '收起 Galgame 舞台', exact: true }).waitFor();
  await page.locator('.galgame-character-row').filter({ hasText: '来客' }).getByRole('button', { name: '邀请', exact: true }).click();
  await page.locator('[data-character-id=visitor]').waitFor();
  await page.locator('.galgame-character-row').filter({ hasText: '来客' }).getByRole('button', { name: '移出', exact: true }).click();
  await page.locator('[data-character-id=visitor]').waitFor({ state: 'detached' });
  console.log('Background, scene, light and visibility checks passed');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存纯净舞台截图', exact: true }).click();
  await (await downloaded).saveAs(path.join(output, 'capture.png'));
  const settings = await context.newPage();
  await settings.goto('http://127.0.0.1:5197/pages/settings.html?section=character-settings');
  await settings.getByRole('button', { name: '调整灯光…', exact: true }).click();
  await settings.getByRole('dialog', { name: '灯光与外观' }).waitFor();
  await settings.locator('.lighting-preview .vrmStageRoot[aria-busy=false]').waitFor();
  await settings.screenshot({ path: path.join(output, 'lighting.png') });
  await settings.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('PASS stage UI: backgrounds/upload, scene save/restore, lighting cancel/apply, hide/recover UI, actor visibility, screenshot, settings preview');
  }
} finally {
  await browser.close();
  server.httpServer.closeAllConnections();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
process.exit(0);
