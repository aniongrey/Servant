import { loadVoiceSettings } from '../voice/VoiceSettings';
import { attachVisemeAnalyzerTo } from './lipSync/visemeAnalyzer';

/**
 * Plays synthesized audio for every TTS provider.
 *
 * Shared by the Speech SDK providers and the local GPT-SoVITS provider so the
 * details that are easy to get wrong — output-device routing, object-URL
 * cleanup, abort semantics and the lip-sync end hook — exist in exactly one
 * place. Bugs here are the ones that look like "the mouth keeps moving after
 * the audio stopped", so the trailing-silence window is deliberately part of
 * the contract rather than a per-provider constant.
 *
 * It is also the single place where an utterance is offered to the viseme
 * analyser (`lipSync/visemeAnalyzer.ts`). That has to happen next to playback:
 * the mouth may only follow the audio that is actually being heard, and the
 * analyser never plays anything itself.
 */

/**
 * How long before the end of playback the speech timeline ends. The audio tail
 * is silence, so `speech.speaking` (head motion, speaking action) stops early —
 * the bubble deliberately keeps covering this window. The mouth no longer hangs
 * on this hook: with an analyser attached it closes because the tail really is
 * silent, and without one `updateLipSync` still uses this flag.
 */
export const TTS_TRAILING_SILENCE_MS = 1000;

export interface PlayAudioOptions {
  bytes: Uint8Array;
  mediaType: string;
  signal: AbortSignal;
  onPlaybackStart?: () => void;
  onLipSyncEnd?: () => void;
}

export function createTtsAbortError(): DOMException {
  return new DOMException('Speech playback was aborted', 'AbortError');
}

export function playAudioBytes({
  bytes,
  mediaType,
  signal,
  onPlaybackStart,
  onLipSyncEnd
}: PlayAudioOptions): Promise<void> {
  if (signal.aborted) return Promise.reject(createTtsAbortError());

  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: mediaType || 'audio/mpeg' }));
  const audio = new Audio(url);
  const { outputDeviceId } = loadVoiceSettings();
  // Attached before playback starts, and before the element is awaited: once
  // the element is routed through the analyser graph the context renders the
  // sound, so its own `setSinkId` stops applying and routing moves to the tap.
  const lipSyncTap = attachVisemeAnalyzerTo(audio, outputDeviceId);
  const routedAudio = audio as HTMLAudioElement & { setSinkId?(id: string): Promise<void> };
  const routeOutput = lipSyncTap
    ? lipSyncTap.ready
    : outputDeviceId && routedAudio.setSinkId
    ? routedAudio.setSinkId(outputDeviceId)
    : Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let lipSyncEnded = false;
    let lipSyncTimer: ReturnType<typeof setTimeout> | undefined;
    const endLipSync = () => {
      if (lipSyncEnded) return;
      lipSyncEnded = true;
      onLipSyncEnd?.();
    };
    const cleanup = () => {
      clearTimeout(lipSyncTimer);
      signal.removeEventListener('abort', abort);
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      lipSyncTap?.detach();
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abort = () => settle(() => reject(createTtsAbortError()));

    audio.onended = () => {
      endLipSync();
      settle(resolve);
    };
    audio.onerror = () => settle(() => reject(new Error('TTS audio playback failed.')));
    signal.addEventListener('abort', abort, { once: true });
    void routeOutput
      .then(() => audio.play())
      .then(() => {
        onPlaybackStart?.();
        if (Number.isFinite(audio.duration)) {
          lipSyncTimer = setTimeout(endLipSync, Math.max(0, audio.duration * 1000 - TTS_TRAILING_SILENCE_MS));
        }
      })
      .catch((cause: unknown) => {
        settle(() => reject(cause instanceof Error ? cause : new Error(String(cause))));
      });
  });
}
