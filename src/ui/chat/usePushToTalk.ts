import { useEffect, useRef } from 'react';
import type { ConversationPhase } from '../../ai/llm/types';
import type { SpeechRecognizer } from '../../ai/stt/speechRecognitionTypes';
import { isTauriDesktop } from '../../desktop/tauri/navigation';

interface PushToTalkControllerOptions {
  abort: () => void;
  finishCurrentUtterance: () => boolean;
  interrupt: () => void;
  isSupported: () => boolean;
  setTranscribing: () => void;
  startListening: () => Promise<void>;
}

export function createPushToTalkController(options: PushToTalkControllerOptions) {
  let active = false;
  let pressedAt: number | null = null;
  const stop = () => {
    active = false;
    pressedAt = null;
    if (options.finishCurrentUtterance()) options.setTranscribing();
  };
  return {
    press(now = Date.now()) {
      if (!options.isSupported()) return false;
      if (active) {
        stop();
        return true;
      }
      active = true;
      pressedAt = now;
      options.interrupt();
      void options.startListening();
      return true;
    },
    release(now = Date.now()) {
      if (!active) return false;
      if (pressedAt !== null && now - pressedAt < 250) {
        pressedAt = null;
        return true;
      }
      stop();
      return true;
    },
    cancel() {
      if (!active) return false;
      active = false;
      pressedAt = null;
      options.abort();
      return true;
    }
  };
}

export function usePushToTalk(
  speechRecognition: SpeechRecognizer,
  startListening: () => Promise<void>,
  setPhase: (phase: ConversationPhase) => void,
  interrupt: () => void,
  enabled: boolean,
  shortcutCode: string
) {
  const startListeningRef = useRef(startListening);
  const interruptRef = useRef(interrupt);
  startListeningRef.current = startListening;
  interruptRef.current = interrupt;
  useEffect(() => {
    if (!enabled) {
      if (isTauriDesktop())
        void import('@tauri-apps/api/core')
          .then(({ invoke }) =>
            invoke('set_push_to_talk_shortcut', { enabled: false, shortcutCode })
          )
          .catch(() => undefined);
      return;
    }
    const isPushToTalkKey = (event: KeyboardEvent) => event.code === shortcutCode;
    const controller = createPushToTalkController({
      abort: () => speechRecognition.abort(),
      finishCurrentUtterance: () => speechRecognition.finishCurrentUtterance(),
      interrupt: () => interruptRef.current(),
      isSupported: () => speechRecognition.isSupported(),
      setTranscribing: () => setPhase('transcribing'),
      startListening: () => startListeningRef.current()
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isPushToTalkKey(event) || event.repeat || !controller.press()) return;
      event.preventDefault();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isPushToTalkKey(event) || !controller.release()) return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', controller.cancel);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauriDesktop()) {
      void Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')])
        .then(async ([{ invoke }, { listen }]) => {
          await invoke('set_push_to_talk_shortcut', { enabled: true, shortcutCode });
          const cleanup = await listen<string>('servant-global-ptt', (event) => {
            if (event.payload === 'pressed') controller.press();
            if (event.payload === 'released') controller.release();
          });
          const release = () => {
            cleanup();
            void invoke('set_push_to_talk_shortcut', { enabled: false, shortcutCode });
          };
          if (disposed) release();
          else unlisten = release;
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', controller.cancel);
      unlisten?.();
    };
  }, [enabled, shortcutCode, speechRecognition, setPhase]);
}
