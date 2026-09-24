#!/usr/bin/env node
/**
 * End-to-end check that a running Shiro instance can actually hold a conversation.
 *
 * A `200` on `/api/ollama/tags` proves the backend is reachable; it does not
 * prove the thing the user cares about, which is that a message typed into the
 * chat page comes back as a reply. That path crosses the page, the realtime
 * gateway, the turn orchestrator, the LLM provider and the memory service — the
 * exact chain that used to break with `Unexpected token '<'`.
 *
 * Two targets, because the app reaches the backend two different ways:
 *
 *   npm run verify:chat
 *     Drives the real chat page in a browser. Use for `npm run dev`, `vite
 *     preview`, or any deployment that serves the UI and `/api/*` on one origin.
 *     Override the target with `SHIRO_VERIFY_URL`.
 *
 *   SHIRO_VERIFY_BACKEND=http://127.0.0.1:5199 npm run verify:chat
 *     Talks to `/api/*` and the realtime socket directly, no browser. Use for a
 *     packaged sidecar, whose loopback port serves the API but not the UI (the
 *     UI lives in the Tauri webview on `tauri.localhost`).
 *
 * Both finish by asserting a non-empty assistant reply.
 */
import { chromium } from 'playwright';
import WebSocket from 'ws';

const PROMPT = process.env.SHIRO_VERIFY_PROMPT ?? '用一句话打个招呼，不要用表情。';
const REPLY_TIMEOUT_MS = Number.parseInt(process.env.SHIRO_VERIFY_TIMEOUT_MS ?? '90000', 10);
const backendBase = process.env.SHIRO_VERIFY_BACKEND?.replace(/\/$/, '');
// `127.0.0.1`, not `localhost`: the dev server binds IPv4 only, and on a machine
// where `localhost` resolves to `::1` first Chromium can sit on a dead socket
// until the navigation times out.
const pageBase = (process.env.SHIRO_VERIFY_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');

/** Minimal shape `validateChatTurnRequest` accepts; the character supplies the rest. */
async function verifyAgainstBackend() {
  console.log(`[verify] backend-only turn against ${backendBase}`);

  const skillResponse = await fetch(`${backendBase}/api/character-skill`);
  if (!skillResponse.ok) throw new Error(`/api/character-skill returned ${skillResponse.status}`);
  const skill = await skillResponse.json();
  if (typeof skill?.id !== 'string' || typeof skill?.markdown !== 'string') {
    throw new Error(`unexpected /api/character-skill shape: ${JSON.stringify(skill).slice(0, 200)}`);
  }
  // Deliberately not the parsed config the UI sends. `validateChatTurnRequest`
  // only requires these fields to be present, and the whole character definition
  // travels in `skillContent`, so the reply comes from the real shipped
  // `skills.md`. Prompt fidelity is what the page-driven mode above covers;
  // this mode exists to prove the packaged backend completes a turn at all.
  const personality = {
    id: skill.id,
    displayName: skill.id,
    identity: '',
    traits: [],
    speakingStyle: [],
    boundaries: [],
    defaultEmotion: 'neutral',
    skillContent: skill.markdown
  };

  const tags = await (await fetch(`${backendBase}/api/ollama/tags`)).json();
  const model = tags?.models?.[0]?.name;
  if (!model) throw new Error('the backend reached no LLM through /api/ollama/tags');

  // The gateway broadcasts every `chat.text` event to every open socket — there
  // is no subscribe command. Frames are buffered rather than awaited because a
  // turn can start emitting before the POST that creates it has responded.
  const socket = new WebSocket(`${backendBase.replace(/^http/, 'ws')}/api/realtime/ws`);
  const frames = [];
  let socketError;
  socket.on('message', (raw) => {
    try {
      frames.push(JSON.parse(String(raw)));
    } catch {
      /* not a protocol frame */
    }
  });
  socket.on('error', (error) => {
    socketError = error;
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  const accepted = await fetch(`${backendBase}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: { id: `verify-${Date.now()}-u`, role: 'user', text: PROMPT, createdAt: Date.now() },
      llmConfig: { provider: 'ollama', model, apiKey: '', temperature: 0.7 },
      personality,
      personalityState: {
        mood: 'neutral',
        energy: 0.7,
        engagement: 0.5,
        lastInteractionAt: 0,
        recentTopics: [],
        frozen: false
      },
      soulContext: '',
      webSearchEnabled: false,
      ttsLanguage: 'zh'
    })
  });
  const body = await accepted.json();
  if (accepted.status !== 202 || !body.turnId) {
    throw new Error(`/api/chat returned ${accepted.status}: ${JSON.stringify(body)}`);
  }
  const { turnId } = body;

  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  let cursor = 0;
  let text = '';
  let outcome;
  while (outcome === undefined && Date.now() < deadline) {
    if (socketError) throw socketError;
    for (; cursor < frames.length; cursor += 1) {
      const frame = frames[cursor];
      if (frame?.type !== 'event' || frame.topic !== 'chat.text') continue;
      const event = frame.payload;
      if (event?.turnId !== turnId) continue;
      // Each `turn-segment` carries the whole segment, not a delta.
      if (event.type === 'turn-segment' && typeof event.message?.text === 'string') {
        text += event.message.text;
      } else if (event.type === 'turn-error') {
        outcome = `failed: ${event.message}`;
      } else if (event.type === 'turn-cancelled') {
        outcome = 'cancelled';
      } else if (event.type === 'turn-end') {
        outcome = 'completed';
      }
    }
    if (outcome === undefined) await new Promise((resolve) => setTimeout(resolve, 150));
  }

  socket.close();
  if (outcome === undefined) throw new Error(`no turn-end for ${turnId} within ${REPLY_TIMEOUT_MS}ms`);
  if (outcome !== 'completed') throw new Error(`turn ${turnId} ${outcome}`);

  text = text.trim();
  if (!text) throw new Error('the turn produced no assistant text');
  console.log(`[verify] reply: ${text.slice(0, 200)}`);
  console.log('PASS backend chat turn');
}

/** Drives the real chat page in a browser. */
async function verifyThroughPage() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  const apiFailures = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/') && response.status() >= 400) {
      apiFailures.push(`${response.status()} ${url}`);
    }
  });

  try {
    // `pages/chat.html` is the page that renders the companion chat panel — see
    // the route table at the top of `src/app/main.tsx`. The bare `/chat` path
    // falls through to the settings shell, which has no composer.
    console.log(`[verify] opening ${pageBase}/pages/chat.html`);
    await page.goto(`${pageBase}/pages/chat.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // The composer is a single-line `<input>`, not a textarea, despite holding
    // up to 240 characters.
    const composer = page.locator('input[aria-label="Chat message"]');
    await composer.waitFor({ state: 'visible', timeout: 30_000 });

    const before = await page.locator('article.wechatMessage[data-role="assistant"]').count();

    console.log(`[verify] sending: ${PROMPT}`);
    await composer.fill(PROMPT);
    await page.locator('button.wechatSend').click();

    // The reply streams over the gateway, so the bubble appears before its text
    // does; `typingDots` marks the placeholder and is replaced when the first
    // chunk lands. Waiting on the bubble alone would pass on an empty reply.
    const reply = page
      .locator('article.wechatMessage[data-role="assistant"]')
      .nth(before)
      .locator('p:not(.typingDots)')
      .first();
    await reply.waitFor({ state: 'visible', timeout: REPLY_TIMEOUT_MS });
    const text = (await reply.innerText()).trim();

    if (!text) throw new Error('the assistant bubble stayed empty');
    if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.join(' | ')}`);

    console.log(`[verify] reply: ${text.slice(0, 200)}`);
    console.log('PASS chat round-trip');
    if (apiFailures.length > 0) {
      console.log(`[verify] note: some /api calls failed along the way:\n  ${apiFailures.join('\n  ')}`);
    }
  } finally {
    await browser.close();
  }
}

if (backendBase) await verifyAgainstBackend();
else await verifyThroughPage();

