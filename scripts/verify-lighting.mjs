import { chromium } from 'playwright';
import { preview } from 'vite';
import assert from 'node:assert/strict';

const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 } });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const modelId = process.argv[2] ?? 'mmd:blue-fish-mmd/蓝色大肥鱼1.12';
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.routeWebSocket('**', socket => socket.close());
  await context.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  if (/\.vrm$/i.test(modelId)) {
    await context.route('**/assets/character/TestModel.vrm', route => route.fulfill({ path: modelId, contentType: 'model/gltf-binary' }));
  }
  await context.addInitScript((modelId) => {
    // Keep rendered pixels available for the test's readback between stage frames.
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, options) {
      return getContext.call(this, kind, kind.startsWith('webgl') ? { ...options, preserveDrawingBuffer: true } : options);
    };
    localStorage.setItem('codex-list.vrmModelSelection.v1', modelId);
    localStorage.setItem('servant.characterProfiles.v1', JSON.stringify([{ id: 'main', name: '光照测试', avatarId: '', characterCardId: 'builtin', voiceId: '', vrmId: 'main', isMain: true, createdAt: 1 }]));
    localStorage.setItem('servant.meetings.v1', JSON.stringify([{ id: 'light-test', title: '光照测试', goal: '', participants: ['main'], messages: [], queue: [], status: 'active', mode: 'manual', conclusions: [], tasks: [], summary: '', updatedAt: 1 }]));
    localStorage.setItem('servant.meetingDesktopCast.v1', 'light-test');
  }, modelId);
  const page = await context.newPage();
  await page.goto(server.resolvedUrls.local[0] + 'pages/desktop.html');
  await page.locator('.vrmStageRoot[aria-busy=false]').waitFor({ timeout: 60000 });
  await page.locator('.character-entry-circle[data-active=true]').waitFor({ state: 'hidden' });
  await page.mouse.move(640, 865); // Wake the fading toolbar before clicking it.
  await page.getByRole('button', { name: '灯光', exact: true }).click();
  await page.getByRole('button', { name: '调整整个舞台光照…' }).click();

  const brightness = () => page.evaluate(async () => {
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    return new Promise(resolve => requestAnimationFrame(() => {
      const source = document.querySelector('.desktop-stage-canvas');
      const canvas = document.createElement('canvas');
      canvas.width = source.width; canvas.height = source.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let total = 0, count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 240) {
        total += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3; count++;
      }
      resolve({ mean: total / Math.max(1, count), count });
    }));
  });
  if (process.argv.includes('--unlit')) {
    assert.equal(await page.getByRole('button', { name: '强制光线影响：关' }).getAttribute('aria-pressed'), 'false');
    await page.getByRole('button', { name: '明亮室内', exact: true }).click();
    const unlitBright = await brightness();
    await page.getByRole('button', { name: '夜景', exact: true }).click();
    const unlitDark = await brightness();
    assert.ok(Math.abs(unlitBright.mean - unlitDark.mean) < 3, 'default unlit appearance must ignore lighting');
    await page.getByRole('button', { name: '强制光线影响：关' }).click();
    await page.locator('.vrmStageRoot[aria-busy=true]').waitFor();
    await page.locator('.vrmStageRoot[aria-busy=false]').waitFor({ timeout: 60000 });
    await page.locator('.character-entry-circle[data-active=true]').waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: '明亮室内', exact: true }).click();
  const bright = await brightness();
  await page.getByRole('button', { name: '夜景', exact: true }).click();
  const dark = await brightness();
  assert.ok(bright.count > 1000 && dark.count > 1000, 'a real model must be rendered');
  assert.ok(bright.mean > dark.mean * 1.15, `${modelId} lighting must change pixels: ${JSON.stringify({ bright, dark })}`);
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('servant.stageScene.v1')).lighting?.mainLightIntensity === 1.1);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('servant.stageScene.v1')).lighting.mainLightIntensity), 1.1);
  if (process.argv.includes('--unlit')) {
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('servant.stageScene.v1')).lighting.forceUnlitLighting), true);
    await page.getByRole('button', { name: '调整整个舞台光照…' }).click();
    await page.getByRole('button', { name: '强制光线影响：开' }).click();
    await page.locator('.vrmStageRoot[aria-busy=true]').waitFor();
    await page.locator('.vrmStageRoot[aria-busy=false]').waitFor({ timeout: 60000 });
    await page.locator('.character-entry-circle[data-active=true]').waitFor({ state: 'hidden' });
    const restoredUnlit = await brightness();
    assert.ok(restoredUnlit.mean > dark.mean * 1.15, `turning the switch off must restore unlit appearance: ${JSON.stringify({ restoredUnlit, dark })}`);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.locator('.vrmStageRoot[aria-busy=true]').waitFor();
    await page.locator('.vrmStageRoot[aria-busy=false]').waitFor({ timeout: 60000 });
    await page.locator('.character-entry-circle[data-active=true]').waitFor({ state: 'hidden' });
    assert.ok((await brightness()).mean < bright.mean / 1.15, 'cancel must restore forced lighting');
  }
  console.log('PASS lighting live preview and save', modelId, JSON.stringify({ bright, dark }));
} finally {
  await browser.close();
  server.httpServer.closeAllConnections();
  await server.close();
}
