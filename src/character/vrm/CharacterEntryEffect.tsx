import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import './character-entry-effect.css';

export const CHARACTER_ENTRY_DURATION_MS = 1250;

export function useCharacterEntryEffect(playAudio = true) {
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(false);
  const frame = useRef<number | undefined>(undefined);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUnlock = useRef<(() => void) | null>(null);

  const clearAudioUnlock = useCallback(() => {
    audioUnlock.current?.();
    audioUnlock.current = null;
  }, []);

  const stop = useCallback(() => {
    window.cancelAnimationFrame(frame.current ?? 0);
    frame.current = undefined;
    clearAudioUnlock();
    audio.current?.pause();
    if (audio.current) audio.current.currentTime = 0;
    audio.current = null;
  }, [clearAudioUnlock]);

  const play = useCallback(() => {
    stop();
    setProgress(0);
    setActive(true);
    if (playAudio) {
      const clip = new Audio('/assets/fx/trans.wav');
      audio.current = clip;
      clip.onended = () => {
        if (audio.current === clip) audio.current = null;
      };
      void clip.play().catch((error: unknown) => {
        if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') {
          console.warn('[CharacterEntryEffect] Audio failed', error);
          return;
        }
        const resume = () => {
          clearAudioUnlock();
          if (audio.current === clip)
            void clip.play().catch((cause: unknown) => console.warn('[CharacterEntryEffect] Audio failed', cause));
        };
        document.addEventListener('pointerdown', resume, { once: true });
        document.addEventListener('keydown', resume, { once: true });
        audioUnlock.current = () => {
          document.removeEventListener('pointerdown', resume);
          document.removeEventListener('keydown', resume);
        };
      });
    }

    const startedAt = performance.now();
    const tick = (now: number) => {
      const nextProgress = Math.min(1, (now - startedAt) / CHARACTER_ENTRY_DURATION_MS);
      setProgress(nextProgress);
      if (nextProgress < 1) frame.current = window.requestAnimationFrame(tick);
      else {
        frame.current = undefined;
        clearAudioUnlock();
        setActive(false);
      }
    };
    frame.current = window.requestAnimationFrame(tick);
  }, [clearAudioUnlock, playAudio, stop]);

  const cancel = useCallback(() => {
    stop();
    setProgress(0);
    setActive(false);
  }, [stop]);

  useEffect(() => stop, [stop]);
  return { progress, active, play, cancel };
}

export function CharacterEntryCircle({ active, startY, endY }: { active: boolean; startY?: number; endY?: number }) {
  const style = {
    '--entry-duration': `${CHARACTER_ENTRY_DURATION_MS}ms`,
    ...(startY !== undefined ? { '--entry-start': `${startY}%` } : {}),
    ...(endY !== undefined ? { '--entry-end': `${endY}%` } : {})
  } as CSSProperties;
  return (
    <div className="character-entry-circle" data-active={active} hidden={!active} style={style} aria-hidden="true">
      <div className="character-entry-circle__ring character-entry-circle__ring--outer" />
      <div className="character-entry-circle__stripe" />
      <div className="character-entry-circle__ring character-entry-circle__ring--inner" />
      <div className="character-entry-circle__star character-entry-circle__star--large" />
      <div className="character-entry-circle__star character-entry-circle__star--small" />
      <div className="character-entry-circle__square" />
      <div className="character-entry-circle__cross" />
      <div className="character-entry-circle__runes">
        {Array.from('SERVANT✦MAGIC').map((rune, index) => (
          <span key={index} style={{ '--rune': index } as CSSProperties}>{rune}</span>
        ))}
      </div>
      <div className="character-entry-circle__nodes">
        {Array.from({ length: 8 }, (_, index) => (
          <span key={index} style={{ '--node': index } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}
