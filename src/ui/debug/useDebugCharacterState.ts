import { useEffect, useMemo, useState } from 'react';
import { createBrowserSoulManager } from '../../character/state';

export function useDebugCharacterState() {
  const characterStateManager = useMemo(() => createBrowserSoulManager('shiro'), []);
  const [characterState, setCharacterState] = useState(() => characterStateManager.getState());
  const characterContext = useMemo(
    () => characterStateManager.getPromptContext(),
    [characterState, characterStateManager]
  );
  useEffect(() => {
    const interval = window.setInterval(() => {
      characterStateManager.tick(10_000);
      setCharacterState(characterStateManager.getState());
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [characterStateManager]);
  const applyCharacterEvent = (
    type: Parameters<typeof characterStateManager.record>[0],
    description: string
  ) => {
    characterStateManager.record(type, description);
    setCharacterState(characterStateManager.getState());
  };
  const tickCharacterState = (deltaTimeMs: number) => {
    characterStateManager.tick(deltaTimeMs);
    setCharacterState(characterStateManager.getState());
  };
  const resetCharacterState = () => {
    characterStateManager.reset();
    setCharacterState(characterStateManager.getState());
  };
  return {
    characterStateManager,
    characterState,
    characterContext,
    applyCharacterEvent,
    tickCharacterState,
    resetCharacterState
  };
}

export type DebugCharacterState = ReturnType<typeof useDebugCharacterState>;
