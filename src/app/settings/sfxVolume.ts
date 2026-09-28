import { loadUiPreferences } from './uiPreferences';

/**
 * 全局音效（SFX）播放器。
 *
 * 为什么不是 `new Audio(url)` 各播各的：全局音量必须**在播放的那一刻**读，
 * 而且设置窗口和桌面舞台是两个 webview——滑块动一下要立刻影响正在响的那只角色。
 * 所以音量走一个模块级缓存 + `storage` 监听，而不是把值当参数在组件树里传。
 *
 * 采样按 URL 缓存成 `AudioBuffer`，同一句情绪音连续触发不会重复解码；
 * 解码好的 buffer 只是「原料」，每次播放仍然新建一个 `AudioBufferSourceNode`
 * 并接上一条 `GainNode`——那样音量改了，正在响的声音也会跟着变。
 */

let context: AudioContext | undefined;
let masterGain: GainNode | undefined;
let volume = loadUiPreferences().sfxVolume;
let listening = false;

const buffers = new Map<string, Promise<AudioBuffer | null>>();
const pending = new Set<AudioBufferSourceNode>();

function ensureListening(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  // 设置窗口保存后，这里立刻跟上，无需重开舞台。
  window.addEventListener('storage', (event) => {
    if (!event.key || event.key === 'codex-list.uiPreferences.v1') volume = loadUiPreferences().sfxVolume;
  });
}

/** 当前生效的音效音量（0~1）。读取方只做展示用，播放路径内部自己会取。 */
export function currentSfxVolume(): number {
  return volume;
}

export function setSfxVolumeForPreview(next: number): void {
  volume = Math.min(1, Math.max(0, next));
  if (masterGain) masterGain.gain.value = volume;
}

/** 浏览器要求播放必须由用户手势打开；越早调用越不容易吃到静音策略。 */
export function unlockSfx(): void {
  ensureListening();
  const node = ensureGraph();
  if (node && node.state !== 'running') void node.resume().catch(() => undefined);
}

function ensureGraph(): AudioContext | undefined {
  if (context) return context;
  if (typeof AudioContext === 'undefined') return undefined;
  try {
    context = new AudioContext({ latencyHint: 'interactive' });
    masterGain = context.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(context.destination);
  } catch {
    context = undefined;
    masterGain = undefined;
  }
  return context;
}

function loadBuffer(url: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(url);
  if (cached) return cached;
  const request = (async () => {
    const node = ensureGraph();
    if (!node) return null;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await node.decodeAudioData(await response.arrayBuffer());
    } catch (error) {
      console.error(`Unable to load sound effect: ${url}`, error);
      return null;
    }
  })();
  buffers.set(url, request);
  return request;
}

/**
 * 播一次音效。`url` 为空或音量拉到 0 时静默返回——调用方不必自己判空，
 * 情绪为 `neutral` 时不播就是走这条路。
 */
export function playSfx(url: string | null | undefined, options: { volume?: number } = {}): void {
  if (!url || volume <= 0) return;
  ensureListening();
  const node = ensureGraph();
  if (!node || !masterGain) return;
  void (async () => {
    await (node.state === 'running' ? undefined : node.resume().catch(() => undefined));
    const buffer = await loadBuffer(url);
    if (!buffer || volume <= 0) return;
    const source = node.createBufferSource();
    source.buffer = buffer;
    const gain = node.createGain();
    // 每条音效还能再叠一个相对音量（打字音比情绪音轻一些），最终仍乘全局音量。
    gain.gain.value = Math.min(1, Math.max(0, options.volume ?? 1));
    source.connect(gain);
    gain.connect(masterGain as GainNode);
    pending.add(source);
    source.onended = () => {
      pending.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  })();
}

/** 立刻掐掉所有正在响的音效（打断发言、关舞台时用）。 */
export function stopAllSfx(): void {
  for (const source of pending) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // 已经自然结束的源再 stop 会抛，忽略即可。
    }
    source.disconnect();
  }
  pending.clear();
}

/** 舞台卸载时释放；下一次需要会重新建图。 */
export function disposeSfx(): void {
  stopAllSfx();
  buffers.clear();
  void context?.close().catch(() => undefined);
  context = undefined;
  masterGain = undefined;
}
