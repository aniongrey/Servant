import type { TtsProvider, TtsSpeakOptions } from './types';

type UtteranceFactory = (text: string) => SpeechSynthesisUtterance;

export class BrowserSpeechSynthesisProvider implements TtsProvider {
  readonly id = 'browser_speech_synthesis';
  private readonly pendingCancels = new Set<() => void>();

  constructor(
    private readonly synthesis: SpeechSynthesis | undefined = getBrowserSpeechSynthesis(),
    private readonly createUtterance: UtteranceFactory = createBrowserUtterance,
    private readonly preferredVoiceVendor = '',
    private readonly defaultRate = 1
  ) {}

  isSupported(): boolean {
    return Boolean(this.synthesis);
  }

  speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
    const synthesis = this.synthesis;
    if (!synthesis || !this.isSupported()) {
      return Promise.reject(new Error('Browser speech synthesis is unavailable'));
    }
    if (options.signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    const utterance = this.createUtterance(text);
    utterance.lang = options.lang ?? 'zh-CN';
    utterance.rate = options.rate ?? this.defaultRate;
    utterance.pitch = options.pitch ?? 1;
    utterance.volume = options.volume ?? 1;
    utterance.voice = selectVoice(
      synthesis.getVoices(),
      utterance.lang,
      options.voiceName,
      this.preferredVoiceVendor
    );

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        options.signal?.removeEventListener('abort', abort);
        this.pendingCancels.delete(cancelPending);
        utterance.onstart = null;
        utterance.onend = null;
        utterance.onerror = null;
      };
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const abort = () => {
        synthesis.cancel();
        settle(() => reject(createAbortError()));
      };
      const cancelPending = () => settle(() => reject(createAbortError()));

      utterance.onstart = () => options.onPlaybackStart?.();
      utterance.onend = () => settle(resolve);
      utterance.onerror = (event) => {
        if (event.error === 'canceled' || event.error === 'interrupted') {
          settle(() => reject(createAbortError()));
          return;
        }
        settle(() => reject(new Error(`Browser speech synthesis failed: ${event.error}`)));
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      this.pendingCancels.add(cancelPending);
      synthesis.speak(utterance);
    });
  }

  cancel(): void {
    this.synthesis?.cancel();
    for (const cancelPending of [...this.pendingCancels]) cancelPending();
  }
}

function selectVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
  voiceName?: string,
  preferredVoiceVendor = ''
): SpeechSynthesisVoice | null {
  if (voiceName) {
    const named = voices.find((voice) => voice.name === voiceName);
    if (named) return named;
  }

  const normalizedLang = lang.toLowerCase();
  const language = normalizedLang.split('-')[0];
  const preferredVoices = preferredVoiceVendor
    ? voices.filter((voice) => voice.name.toLowerCase().includes(preferredVoiceVendor.toLowerCase()))
    : [];
  const preferred =
    preferredVoices.find((voice) => voice.lang.toLowerCase() === normalizedLang) ??
    preferredVoices.find((voice) => voice.lang.toLowerCase().startsWith(`${language}-`));
  if (preferred) return preferred;
  return (
    voices.find((voice) => voice.lang.toLowerCase() === normalizedLang) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(`${language}-`)) ??
    null
  );
}

function getBrowserSpeechSynthesis(): SpeechSynthesis | undefined {
  return typeof window === 'undefined' ? undefined : window.speechSynthesis;
}

function createBrowserUtterance(text: string): SpeechSynthesisUtterance {
  return new SpeechSynthesisUtterance(text);
}

function createAbortError(): DOMException {
  return new DOMException('Speech synthesis was aborted', 'AbortError');
}
