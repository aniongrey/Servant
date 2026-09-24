const HEAD_TOUCH_SOUND_URLS = [
  '/assets/fx/ei.wav',
  '/assets/fx/en.wav',
  '/assets/fx/no.wav',
  '/assets/fx/uhe.wav',
  '/assets/fx/yeah.wav'
];
const HEAD_TOUCH_SPECIAL_SOUND_URL = '/assets/fx/motoufx.mp3';
const PROTECTED_HEAD_SOUND_URL = '/assets/fx/iron-basin-hit.wav';

// Keep decoded samples and the running context for this page's lifetime, including across stage remounts.
let soundBank:
  | {
      context: AudioContext;
      buffers: Map<string, AudioBuffer>;
      ready: Promise<void>;
    }
  | undefined;

function preloadSounds() {
  if (soundBank) return soundBank;
  const context = new AudioContext({ latencyHint: 'interactive' });
  const buffers = new Map<string, AudioBuffer>();
  const urls = [...HEAD_TOUCH_SOUND_URLS, HEAD_TOUCH_SPECIAL_SOUND_URL, PROTECTED_HEAD_SOUND_URL];
  const ready = Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        buffers.set(url, buffer);
      } catch (error) {
        console.error(`Unable to preload head touch sound: ${url}`, error);
      }
    })
  ).then(() => undefined);
  soundBank = { context, buffers, ready };
  return soundBank;
}

/** Samples are shared; each stage owns only its playback, so disposing one cannot silence another. */
export function createHeadTouchFeedback() {
  const bank = preloadSounds();
  const activeSources = new Set<AudioBufferSourceNode>();
  const activeVoices = new Set<AudioBufferSourceNode>();
  let disposed = false;

  const unlock = () => {
    if (disposed || bank.context.state === 'running') return Promise.resolve();
    return bank.context.resume();
  };
  const start = (url: string, voice: boolean) => {
    if (disposed) return;
    const buffer = bank.buffers.get(url);
    if (!buffer) return;
    const source = bank.context.createBufferSource();
    source.buffer = buffer;
    source.connect(bank.context.destination);
    activeSources.add(source);
    if (voice) activeVoices.add(source);
    source.onended = () => {
      activeSources.delete(source);
      activeVoices.delete(source);
      source.disconnect();
    };
    source.start();
  };
  const play = (url: string, voice: boolean) => {
    if (disposed) return;
    // The normal path creates a source immediately, without fetching, decoding or waiting on a promise.
    if (bank.context.state === 'running' && bank.buffers.has(url)) {
      start(url, voice);
      return;
    }
    void Promise.all([unlock(), bank.ready])
      .then(() => start(url, voice))
      .catch((error) => console.error('Unable to play head touch sound', error));
  };

  return {
    ready: bank.ready,
    unlock,
    play() {
      const url =
        Math.random() < 0.01
          ? HEAD_TOUCH_SPECIAL_SOUND_URL
          : HEAD_TOUCH_SOUND_URLS[Math.floor(Math.random() * HEAD_TOUCH_SOUND_URLS.length)];
      play(url, true);
    },
    playProtected() {
      play(PROTECTED_HEAD_SOUND_URL, false);
    },
    isPlaying() {
      return activeVoices.size > 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const source of activeSources) {
        source.onended = null;
        source.stop();
        source.disconnect();
      }
      activeSources.clear();
      activeVoices.clear();
    }
  };
}
