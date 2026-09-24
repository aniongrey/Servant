import type { LipSyncSource, VisemeWeights, WLipSyncEngine } from 'three-vrm-lip-sync';

/**
 * Audio-driven mouth motion for the desktop character, backed by
 * [three-vrm-lip-sync](https://github.com/vlapky/three-vrm-lip-sync) and its
 * `wlipsync` engine (WASM + AudioWorklet MFCC vowel classification, a port of
 * uLipSync). Language independent: no phoneme data, no speech recognition.
 *
 * It is integrated through the library's *lower-level* API — `WLipSyncEngine`
 * plus its source factory — rather than through its `VRMLipSync` facade,
 * because both things the facade owns already have an owner here:
 * `audioPlayback.ts` plays the TTS audio, and `VrmStage` writes expressions
 * from one render loop. Taking the engine alone keeps those two owners intact;
 * what the facade adds on top (viseme naming, smoothing, releasing the mouth
 * while silent) comes from the engine's own smoothed weights, and the release
 * half is `updateLipSync` falling back to zero.
 *
 * The analyser is strictly additive. It never plays, pauses or reroutes audio
 * unless it can prove the routed graph is alive, every failure degrades to
 * `null` so the caller keeps its previous behaviour, and playback never waits
 * on it: the element plays through the same code path whether or not an
 * analyser is attached.
 *
 * Requires a secure context (`localhost` or HTTPS) for the AudioWorklet; the
 * packaged windows load from the Tauri asset protocol and the dev server from
 * `127.0.0.1`, so both qualify.
 */

/** `AudioContext.setSinkId()` exists in Chromium but not in the DOM types yet. */
type SinkRoutableAudioContext = AudioContext & { setSinkId?(sinkId: string): Promise<void> };

/** The parts of the library this module uses, once its bundle has loaded. */
interface LoadedAnalyzer {
  readonly engine: WLipSyncEngine;
  readonly createMediaElementSource: (context: AudioContext, element: HTMLMediaElement) => LipSyncSource;
}

interface AnalyzerGraph {
  readonly context: SinkRoutableAudioContext;
  /** Null until the worklet module and its WASM are up, or forever after a failure. */
  analyzer: LoadedAnalyzer | null;
  /** Live taps; the render loop only trusts weights while at least one is attached. */
  taps: number;
  /** Sink already pushed to the context, so routing is applied once per change. */
  appliedSinkId: string | null;
}

/**
 * Handle on one analysed utterance. Detaching is all a caller does with it: the
 * element stays the playback owner, so `start`/`stop` of the underlying library
 * source are deliberately never called (`audioPlayback.ts` owns those).
 */
export interface VisemeAnalyzerTap {
  /**
   * Resolves once the analyser graph can be heard on the requested output
   * device — the caller awaits it in the same slot where it used to await the
   * element's own `setSinkId`. Never rejects: a routing failure must not be
   * able to silence a spoken line.
   */
  readonly ready: Promise<void>;
  detach(): void;
}

let graph: AnalyzerGraph | null = null;
/** Latched once the page is known to be unable to analyse audio at all. */
let unavailableReason: string | null = null;

/**
 * Creates the analysis context and starts loading the worklet. Idempotent, and
 * cheap when nothing ends up using it: an idle graph is one AudioContext.
 *
 * Nothing waits on this. The first utterance can well start before the worklet
 * is ready and then simply plays without an analyser — awaiting it here would
 * delay the first sound instead, which is the one thing speech may not do.
 */
export function prepareVisemeAnalyzer(): void {
  if (graph || unavailableReason) return;

  const context = createAudioContext();
  if (!context) {
    unavailableReason = 'AudioContext 不可用';
    warnUnavailable(unavailableReason);
    return;
  }

  const created: AnalyzerGraph = { context, analyzer: null, taps: 0, appliedSinkId: null };
  graph = created;
  void loadAnalyzer(context)
    .then((analyzer) => {
      if (graph !== created) {
        analyzer.engine.dispose();
        return;
      }
      created.analyzer = analyzer;
    })
    .catch((cause: unknown) => {
      if (graph !== created) return;
      graph = null;
      unavailableReason = describeError(cause);
      warnUnavailable(unavailableReason);
    });
}

/**
 * Resumes the analysis context from a user gesture. Autoplay policy keeps a
 * fresh context suspended, and a suspended context is the one case where
 * attaching would mute the audio element, so this is what turns lip sync on for
 * a window that has not been clicked yet.
 */
export function unlockVisemeAnalyzer(): void {
  const active = graph;
  if (!active || active.context.state === 'running') return;
  void active.context.resume().catch((cause: unknown) => {
    console.warn('[lipSync] 无法恢复音频上下文的运行状态', cause);
  });
}

/**
 * Routes an audio element through the analyser. Returns null — and leaves the
 * element completely untouched — when the mouth would have to be paid for with
 * audio: no engine yet, a context that is not running (would mute the element),
 * or a selected output device the context cannot be routed to (would play the
 * line on the wrong speakers). `createMediaElementSource` reroutes the element
 * permanently, so all of that is checked before the element is touched.
 */
export function attachVisemeAnalyzerTo(
  element: HTMLMediaElement,
  outputDeviceId: string
): VisemeAnalyzerTap | null {
  const active = graph;
  const analyzer = active?.analyzer;
  if (!active || !analyzer) return null;
  if (active.context.state !== 'running') {
    // Suspended means the window has not seen a gesture yet. Nudge it on every
    // utterance so the analysis switches itself on as soon as one arrives,
    // without making the current line wait for it.
    unlockVisemeAnalyzer();
    return null;
  }
  if (outputDeviceId && typeof active.context.setSinkId !== 'function') return null;

  let source: LipSyncSource;
  try {
    source = analyzer.createMediaElementSource(active.context, element);
  } catch (cause: unknown) {
    console.error('[lipSync] 无法把音频元素接入分析图，本句不做口型同步', cause);
    return null;
  }

  // The engine node is analysis-only (it produces no output), so the element
  // has to be connected to the destination as well to stay audible.
  source.node.connect(analyzer.engine.input);
  source.node.connect(active.context.destination);
  active.taps += 1;

  return {
    ready: applyOutputDevice(active, outputDeviceId),
    detach() {
      active.taps = Math.max(0, active.taps - 1);
      try {
        source.node.disconnect();
      } catch (cause: unknown) {
        console.warn('[lipSync] 断开音频元素失败', cause);
      }
    }
  };
}

/**
 * Current viseme weights, or null when nothing is being analysed — no tap, no
 * engine, or a page that cannot analyse at all. Null is the caller's signal to
 * fall back to its own mouth motion, so it must not be conflated with "silent":
 * a live analysis of silence legitimately returns all zeros, which is what
 * closes the mouth at the end of a line.
 */
export function readLiveVisemeWeights(): VisemeWeights | null {
  const active = graph;
  if (!active?.analyzer || active.taps === 0) return null;
  return active.analyzer.engine.weights;
}

/**
 * Loaded lazily, and that is not just tidiness: `wlipsync` declares
 * `class extends AudioWorkletNode` at module scope, so importing it eagerly
 * throws at import time in any page without AudioWorkletNode — and this module
 * is reached from the TTS playback path, where such a throw would take speech
 * down with it instead of only the mouth. A dynamic import puts that failure
 * inside the `catch` below, where the answer is simply "no mouth animation".
 */
async function loadAnalyzer(context: AudioContext): Promise<LoadedAnalyzer> {
  const library = await import('three-vrm-lip-sync');
  const engine = await library.WLipSyncEngine.create(context);
  return { engine, createMediaElementSource: library.createMediaElementSource };
}

/**
 * Pushes the selected output device onto the context. With a tap attached the
 * context renders the audio, so the element's own `setSinkId` no longer applies
 * and routing has to happen here instead. Cached per device: a change takes
 * effect on the next utterance rather than mid-line.
 */
function applyOutputDevice(active: AnalyzerGraph, outputDeviceId: string): Promise<void> {
  const context = active.context;
  if (!context.setSinkId || active.appliedSinkId === outputDeviceId) return Promise.resolve();

  active.appliedSinkId = outputDeviceId;
  return context.setSinkId(outputDeviceId).catch((cause: unknown) => {
    // Forget the attempt so the next utterance retries instead of silently
    // keeping a device the user has already changed away from.
    active.appliedSinkId = null;
    console.warn(`[lipSync] 输出设备切换失败（${outputDeviceId || '默认设备'}）`, cause);
  });
}

function createAudioContext(): SinkRoutableAudioContext | null {
  const AudioContextConstructor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!AudioContextConstructor) return null;

  try {
    return new AudioContextConstructor({ latencyHint: 'interactive' });
  } catch (cause: unknown) {
    console.warn('[lipSync] 音频上下文创建失败', cause);
    return null;
  }
}

function warnUnavailable(reason: string): void {
  console.warn(`[lipSync] ${reason}：口型回退为程序化动作`);
}

function describeError(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return String(cause);
}
