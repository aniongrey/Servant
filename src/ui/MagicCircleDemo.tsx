import { useCallback, useEffect, useState } from 'react';
import { useDesktopCharacter } from '../desktop/tauri/useDesktopCharacter';
import { VrmStage } from '../character/vrm/VrmStage';
import { CharacterEntryCircle, useCharacterEntryEffect } from '../character/vrm/CharacterEntryEffect';
import type { CharacterController } from '../character/CharacterController';
import './magic-circle-demo.css';

type DemoPhase = 'waiting' | 'summoning' | 'complete';

export function MagicCircleDemo() {
  const { settings, modelUrl, error } = useDesktopCharacter();
  const [phase, setPhase] = useState<DemoPhase>('waiting');
  const [modelReady, setModelReady] = useState(false);
  const [entryBounds, setEntryBounds] = useState({ footY: 96, headY: 55 });
  const entry = useCharacterEntryEffect();
  const play = useCallback(() => {
    if (!modelReady) return;
    entry.play();
    setPhase('summoning');
  }, [entry.play, modelReady]);
  const cancel = useCallback(() => {
    entry.cancel();
    setPhase('waiting');
  }, [entry.cancel]);
  const onEngineReady = useCallback((_engine: CharacterController) => setModelReady(true), []);
  const onCharacterProjection = useCallback(setEntryBounds, []);
  const onStatus = useCallback((message: string) => console.debug('[MagicCircleDemo]', message), []);

  useEffect(() => {
    if (entry.progress === 1) setPhase('complete');
  }, [entry.progress]);

  useEffect(() => {
    setModelReady(false);
  }, [modelUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'KeyR') {
        event.preventDefault();
        play();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [play]);

  return (
    <main className="magic-demo" data-phase={phase}>
      <div className="magic-demo__backdrop" />
      <div className="magic-demo__stage">
        <VrmStage
          modelUrl={modelUrl}
          avatarFitConfig={settings.avatarFit}
          holdMicroMotionEnabled={settings.holdMicroMotionEnabled}
          footIkEnabled={settings.footIkEnabled}
          renderConfig={settings.renderConfig}
          proportionConfig={settings.proportionConfig}
          dissolveProgress={entry.progress}
          onCharacterProjection={onCharacterProjection}
          wheelZoomEnabled={false}
          onEngineReady={onEngineReady}
          onStatus={onStatus}
        />
      </div>
      <CharacterEntryCircle active={entry.active} startY={entryBounds.footY} endY={entryBounds.headY} />
      <div className="magic-demo__hud">
        <p>MAGIC CIRCLE // SERVANT</p>
        <h1>{phase === 'waiting' ? '等待召唤' : phase === 'summoning' ? '灵基构筑中' : '召唤完成'}</h1>
        <button type="button" disabled={!modelReady} onClick={phase === 'summoning' ? cancel : play}>
          {!modelReady ? '角色载入中…' : phase === 'complete' ? '再次召唤' : phase === 'summoning' ? '取消召唤' : '召唤角色'}
          <kbd>Space</kbd>
        </button>
        {error ? <small>{error}</small> : null}
      </div>
    </main>
  );
}
