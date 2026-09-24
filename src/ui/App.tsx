import { DebugSpeechPanel } from './debug/DebugSpeechPanel';
import { RandomComboPanel } from './debug/RandomComboPanel';
import { DebugStage } from './debug/DebugStage';
import {
  RuntimeLogPanel,
  RuntimeStatusPanel,
  RuntimeRelationshipPanel,
  RuntimeEmotionPanel,
  RuntimeTimeline
} from './debug/RuntimePanels';
import { MotionTestPanel } from './debug/MotionTestPanel';
import { AvatarFitPanel } from './debug/AvatarFitPanel';
import { LightingPanel } from './debug/LightingPanel';
import { TriggerPanel } from './debug/TriggerPanel';
import { ActionComboPanel } from './debug/ActionComboPanel';
import { CustomTriggersPanel, InputPanel, DirectorPanel } from './debug/EventDebugPanels';
import { CharacterStateDebugPanel } from './debug/CharacterStateDebugPanel';
import { useState, useMemo, useSyncExternalStore, useCallback, useEffect } from 'react';

import { loadDebugPanelSections, saveDebugPanelSections } from './debug/debugSettings';
import { createAgentRuntime, type AgentRuntime } from '../ai/AgentRuntime';
import { vrmaTestMotions } from '../character/motion/assets/vrmaTestMotions';

import { type DebugPanelSectionState, type DebugPanelSectionId } from './debug/debugConfig';

import { Sparkles, Home, SlidersHorizontal } from 'lucide-react';
import { openSettingsHome } from '../desktop/tauri/navigation';

import { useDebugSpeechSettings } from './debug/useDebugSpeechSettings';
import { useDebugCharacterSettings } from './debug/useDebugCharacterSettings';
import { useDebugMotionController } from './debug/useDebugMotionController';
import { useDebugCharacterState } from './debug/useDebugCharacterState';
import { useDebugEventControls } from './debug/useDebugEventControls';

export function App() {
  const fallbackEngine = useMemo(() => createAgentRuntime({ extraMotions: vrmaTestMotions }), []);
  const [engine, setEngine] = useState<AgentRuntime>(() => fallbackEngine);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [stageMode, setStageMode] = useState<'mock' | 'vrm'>('mock');
  const speechSettings = useDebugSpeechSettings(engine);
  const { networkFetch } = speechSettings;
  const characterSettings = useDebugCharacterSettings(engine);
  const { selectedVrmModel } = characterSettings;
  const motionTests = useDebugMotionController(engine, stageMode, networkFetch);

  const characterStateControls = useDebugCharacterState();

  const eventControls = useDebugEventControls(engine);

  const [vrmStatus, setVrmStatus] = useState(`Loading ${selectedVrmModel.url}`);
  const snapshot = useSyncExternalStore(engine.store.subscribe, engine.store.getSnapshot);

  const [debugPanelSections, setDebugPanelSections] =
    useState<DebugPanelSectionState>(loadDebugPanelSections);

  const handleVrmReady = useCallback((nextEngine: AgentRuntime) => {
    setEngine(nextEngine);
    setStageMode('vrm');
  }, []);

  const handleVrmStatus = useCallback((message: string) => {
    setVrmStatus(message);
  }, []);

  useEffect(() => {
    saveDebugPanelSections(debugPanelSections);
  }, [debugPanelSections]);

  useEffect(() => {
    if (stageMode === 'vrm') {
      return undefined;
    }

    let frame = 0;
    let previous = performance.now();

    const loop = (now: number) => {
      const deltaSeconds = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      engine.update(deltaSeconds);
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [engine, stageMode]);

  const setDebugSectionOpen = (sectionId: DebugPanelSectionId, open: boolean) => {
    setDebugPanelSections((current) => ({
      ...current,
      [sectionId]: open
    }));
  };

  return (
    <main className="shell">
      <section className="stagePanel">
        <header className="topbar">
          <div className="gameBrand">
            <span className="brandSigil" aria-hidden="true">
              <Sparkles size={19} />
            </span>
            <div>
              <p className="eyebrow">Moonlit Link // Companion System</p>
              <h1>
                小伴 <span>AI 桌面伙伴</span>
              </h1>
            </div>
          </div>
          <div className="runBadge">
            <span>
              <i aria-hidden="true" /> {snapshot.director.currentEvent?.id ?? '待机陪伴中'}
            </span>
            <strong>
              LINK {snapshot.director.currentStep}/{snapshot.director.totalSteps}
            </strong>
          </div>
          <div className="topbarActions">
            <button
              className="settingsToggleButton"
              onClick={() => void openSettingsHome()}
              title="打开主页设置"
              type="button"
            >
              <Home size={17} />
              主页设置
            </button>
            <button
              aria-expanded={settingsOpen}
              className="settingsToggleButton"
              onClick={() => setSettingsOpen((open) => !open)}
              title={settingsOpen ? '关闭设置' : '打开设置'}
              type="button"
            >
              <SlidersHorizontal size={17} />
              系统设置
            </button>
          </div>
        </header>

        {settingsOpen ? <DebugSpeechPanel speechSettings={speechSettings} /> : null}

        <RandomComboPanel motionTests={motionTests} />

        <DebugStage
          speechSettings={speechSettings}
          characterSettings={characterSettings}
          engine={engine}
          snapshot={snapshot}
          stageMode={stageMode}
          vrmStatus={vrmStatus}
          handleVrmReady={handleVrmReady}
          handleVrmStatus={handleVrmStatus}
        />

        <RuntimeTimeline snapshot={snapshot} />
      </section>

      <aside className="debugPanel">
        <MotionTestPanel
          open={debugPanelSections.vrmaMotionTest}
          onToggle={setDebugSectionOpen}
          characterSettings={characterSettings}
          motionTests={motionTests}
          snapshot={snapshot}
        />

        <AvatarFitPanel characterSettings={characterSettings} />

        <LightingPanel characterSettings={characterSettings} />

        <TriggerPanel open={debugPanelSections.triggers} onToggle={setDebugSectionOpen} engine={engine} />

        <ActionComboPanel
          open={debugPanelSections.actionCombo}
          onToggle={setDebugSectionOpen}
          motionTests={motionTests}
          snapshot={snapshot}
        />

        <DirectorPanel
          open={debugPanelSections.director}
          onToggle={setDebugSectionOpen}
          eventControls={eventControls}
          engine={engine}
        />

        <InputPanel
          open={debugPanelSections.input}
          onToggle={setDebugSectionOpen}
          eventControls={eventControls}
        />

        <RuntimeEmotionPanel
          open={debugPanelSections.runtimeEmotion}
          onToggle={setDebugSectionOpen}
          engine={engine}
          snapshot={snapshot}
        />

        <RuntimeRelationshipPanel
          open={debugPanelSections.runtimeRelationship}
          onToggle={setDebugSectionOpen}
          engine={engine}
          snapshot={snapshot}
        />

        <CharacterStateDebugPanel
          open={debugPanelSections.characterState}
          onToggle={setDebugSectionOpen}
          characterStateControls={characterStateControls}
        />

        <CustomTriggersPanel
          open={debugPanelSections.customTriggers}
          onToggle={setDebugSectionOpen}
          eventControls={eventControls}
          engine={engine}
          snapshot={snapshot}
        />

        <RuntimeStatusPanel
          open={debugPanelSections.runtime}
          onToggle={setDebugSectionOpen}
          snapshot={snapshot}
        />

        <RuntimeLogPanel open={debugPanelSections.log} onToggle={setDebugSectionOpen} snapshot={snapshot} />
      </aside>
    </main>
  );
}
