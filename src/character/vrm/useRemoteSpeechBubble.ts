import { useEffect, useState } from 'react';
import { listenVoiceBroadcast, type VoiceBroadcastEvent } from '../../ai/tts/voiceBroadcast';
import { getSpeechBubbleDurationMs, SpeechBubbleTimeline, type SpeechBubbleState } from './speechBubble';

/** Owns the timing and identity of one remote utterance, independent of the renderer. */
export function createRemoteSpeechTracker(onChange: (state: SpeechBubbleState) => void) {
  const timeline = new SpeechBubbleTimeline({ onChange });
  let activeId: string | null = null;
  let latestText = '';
  let speechStartedAt = 0;

  const reset = () => {
    activeId = null;
    latestText = '';
    speechStartedAt = 0;
  };

  return {
    onEvent(event: VoiceBroadcastEvent) {
      if (event.type === 'speech-start') {
        if (activeId !== event.id) speechStartedAt = Date.now();
        activeId = event.id;
        latestText = event.text;
        timeline.show(event.text);
      } else if (event.type === 'speech-delta' && activeId === event.id) {
        latestText = event.text;
        timeline.show(event.text);
      } else if (event.type === 'speech-end' && activeId === event.id) {
        latestText = event.text ?? latestText;
        timeline.show(latestText);
        // Waiting for the desktop playback receipt: keep the bubble up and only
        // arm a worst-case timeout so a lost receipt cannot pin it to the screen.
        timeline.hideAfter(getSpeechBubbleDurationMs(latestText, Date.now() - speechStartedAt));
      } else if (event.type === 'speech-cancel' && activeId === event.id) {
        reset();
        timeline.hide();
      } else if (event.type === 'speech-playback-completed' && activeId === event.id) {
        reset();
        timeline.finish();
      }
    },
    dispose() {
      timeline.dispose();
    }
  };
}

export function useRemoteSpeechBubble(modelUrl: string) {
  const [remoteSpeechBubble, setRemoteSpeechBubble] = useState<SpeechBubbleState>({
    text: '',
    speaking: false
  });
  useEffect(() => {
    setRemoteSpeechBubble({ text: '', speaking: false });
    const tracker = createRemoteSpeechTracker(setRemoteSpeechBubble);
    const unsubscribe = listenVoiceBroadcast(tracker.onEvent);
    return () => {
      unsubscribe();
      tracker.dispose();
    };
  }, [modelUrl]);

  return { remoteSpeechBubble };
}
