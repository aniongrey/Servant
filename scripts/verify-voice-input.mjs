// Browser integration check with synthetic ASR. No microphone audio or LLM requests are used.
// Start Vite, then: node scripts/verify-voice-input.mjs http://127.0.0.1:5198
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
try {
  const context = await browser.newContext({ permissions: ['microphone'] });
  await context.route('**/src/ai/stt/SherpaSpeechRecognition.ts*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
    export class SherpaSpeechRecognition {
      preload = async () => {}; isReady = () => true; isSupported = () => true;
      abort() { clearTimeout(this.timer); this.recording = false; this.aborted = true; }
      destroy() { this.abort(); }
      pauseCapture() { this.recording = false; }
      startContinuous(callbacks) {
        this.callbacks = callbacks; this.aborted = false; window.fakeRecognizer = this;
        this.timer = setTimeout(() => { this.recording = true; callbacks.onStarted?.(); if(callbacks.mode === 'manual') callbacks.onSpeechStart?.(); }, 40);
      }
      finishCurrentUtterance() {
        if (!this.recording) { this.abort(); return false; }
        this.recording = false; const cb = this.callbacks; cb.onSpeechEnd?.();
        setTimeout(() => { cb.onTranscript('测试语音', true); cb.onEnd?.(); }, 25); return true;
      }
    }
  `
    })
  );
  await context.route('**/voice-check.html*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `
    <!doctype html><html><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { useVoiceInput } = await import('/src/ui/voice/useVoiceInput.ts');
    const { VoiceInputControls, VoiceMicButton } = await import('/src/ui/voice/VoiceInputControls.tsx');
    window.sent = []; window.interruptions = 0;
    function App() {
      const [input, setInput] = React.useState('');
      const [session, setSession] = React.useState(new URL(location.href).searchParams.get('session') ?? 'a'); window.changeSession = setSession;
      const voice = useVoiceInput({ target: { page: 'meeting', sessionId: session, characterId: 'alice', label: session + ' · Alice' }, input, setInput,
        send: async text => { window.sent.push(text); return true; }, interrupt: () => { window.interruptions++; } });
      window.voice = voice;
      return React.createElement('main', null, React.createElement('input', { 'aria-label': 'draft', value: input, onChange: e => setInput(e.target.value) }), React.createElement(VoiceMicButton, { voice }), React.createElement(VoiceInputControls, { voice }));
    }
    createRoot(document.getElementById('root')).render(React.createElement(App));
    </script></body></html>`
    })
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error('CLIENT', error.message);
  });
  await page.goto(`${base}/voice-check.html`);
  await page
    .waitForFunction(() => window.voice?.state.ready)
    .catch(async (error) => {
      console.error(
        'Host:',
        await page
          .frames()
          .find((frame) => frame.url().includes('/pages/voice.html'))
          ?.locator('body')
          .innerText()
      );
      console.error('Client:', await page.locator('body').innerText());
      throw error;
    });
  assert.equal(await page.getByRole('button', { name: '启动 / 重试语音' }).count(), 0);
  await page.waitForFunction(() => window.voice.state.enabled);
  await page.keyboard.down('Backquote');
  await page.keyboard.up('Backquote');
  await page
    .frames()
    .find((frame) => frame.url().includes('/pages/voice.html'))
    .waitForFunction(() => window.fakeRecognizer?.aborted)
    .catch(async (error) => {
      console.error(
        'QUICK',
        await page.evaluate(() => ({ state: window.voice.state, focus: document.hasFocus() })),
        await page
          .frames()
          .find((frame) => frame.url().includes('/pages/voice.html'))
          .evaluate(() => ({
            status: document.body.innerText,
            fake: window.fakeRecognizer && {
              aborted: window.fakeRecognizer.aborted,
              recording: window.fakeRecognizer.recording
            }
          }))
      );
      throw error;
    });
  await page.waitForFunction(() => window.voice.state.phase === 'idle');
  assert.equal(await page.getByLabel('draft').inputValue(), '');
  const say = async (target = page) => {
    await target.keyboard.down('Backquote');
    await target
      .waitForFunction(() => window.voice.state.phase === 'recording')
      .catch(async (error) => {
        console.error(
          'PTT',
          await target.evaluate(() => ({
            state: window.voice.state,
            focus: document.hasFocus(),
            settings: window.voice.settings
          }))
        );
        throw error;
      });
    await target.keyboard.up('Backquote');
    await target.waitForFunction(() => window.voice.state.phase === 'idle');
  };
  await say();
  await page.waitForFunction(() => document.querySelector('input[aria-label=draft]').value === '测试语音');
  assert.deepEqual(await page.evaluate(() => window.sent), []);
  await page.getByLabel('自动发送', { exact: true }).check();
  await say();
  await page.waitForFunction(
    () => document.querySelector('input[aria-label=draft]').value === '测试语音 测试语音'
  );
  assert.deepEqual(await page.evaluate(() => window.sent), []);
  await page.getByLabel('draft').fill('');
  await say();
  await page.waitForFunction(() => window.sent.length === 1);
  assert.equal(await page.getByLabel('draft').inputValue(), '');
  await page.getByLabel('draft').fill('会话 A 草稿');
  await page.evaluate(() => window.changeSession('b'));
  await page.waitForFunction(() => document.querySelector('input[aria-label=draft]').value === '');
  await page.getByLabel('draft').fill('会话 B 草稿');
  await page.evaluate(() => window.changeSession('a'));
  await page.waitForFunction(() => document.querySelector('input[aria-label=draft]').value === '会话 A 草稿');
  assert.ok(await page.evaluate(() => window.interruptions >= 4));
  await page.getByLabel('自动发送', { exact: true }).uncheck();
  const second = await context.newPage();
  second.on('pageerror', (error) => errors.push(error.message));
  await second.goto(`${base}/voice-check.html?session=b`);
  await second.waitForFunction(() => window.voice?.state.ready);
  await second.getByLabel('draft').fill('');
  await page.bringToFront();
  await page.keyboard.down('Backquote');
  await page.waitForFunction(() => window.voice.state.phase === 'recording');
  await second.bringToFront();
  await page.keyboard.up('Backquote');
  await page.waitForFunction(
    () => document.querySelector('input[aria-label=draft]').value === '会话 A 草稿 测试语音'
  );
  assert.equal(await second.getByLabel('draft').inputValue(), '');
  await say(second);
  await second.waitForFunction(() => document.querySelector('input[aria-label=draft]').value === '测试语音');
  const duplicateHost = await context.newPage();
  await duplicateHost.goto(`${base}/pages/voice.html`);
  assert.equal(await duplicateHost.evaluate(() => !!window.fakeRecognizer), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '.local/voice-input-check.png', fullPage: true });
  await page.close();
  await second.bringToFront();
  await second.getByLabel('draft').fill('');
  // Closing the page owning the hidden host elects the next page's waiting host.
  await say(second);
  await second.waitForFunction(() => document.querySelector('input[aria-label=draft]').value === '测试语音');
  await second.evaluate(() => window.voice.update({ inputMode: 'muted' }));
  await second.waitForFunction(() => !window.voice.state.enabled);
  await second.evaluate(() => window.voice.update({ inputMode: 'push-to-talk' }));
  await second.waitForFunction(() => window.voice.state.enabled);
  await say(second);
  console.log(
    'PASS automatic startup + singleton host + quick release + draft-only + auto-send + existing draft protection + per-session drafts + window routing + host failover + mode resume'
  );
} finally {
  await browser.close();
}
