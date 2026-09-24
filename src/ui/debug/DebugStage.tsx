import { type AgentRuntime } from '../../ai/AgentRuntime';
import { type RuntimeSnapshot } from '../../app/runtimeTypes';
import { VrmStage } from '../../character/vrm/VrmStage';
import type { DebugSpeechSettings } from './useDebugSpeechSettings';
import type { DebugCharacterSettings } from './useDebugCharacterSettings';

export function DebugStage({
  speechSettings,
  characterSettings,
  engine,
  snapshot,
  stageMode,
  vrmStatus,
  handleVrmReady,
  handleVrmStatus
}: {
  speechSettings: Pick<DebugSpeechSettings, 'activeTtsProvider'>;
  characterSettings: Pick<
    DebugCharacterSettings,
    'selectedVrmModel' | 'renderConfig' | 'avatarFitConfig' | 'holdMicroMotionEnabled' | 'footIkEnabled'
  >;
  engine: AgentRuntime;
  snapshot: RuntimeSnapshot;
  stageMode: 'mock' | 'vrm';
  vrmStatus: string;
  handleVrmReady: (engine: AgentRuntime) => void;
  handleVrmStatus: (message: string) => void;
}) {
  const { activeTtsProvider } = speechSettings;
  const { selectedVrmModel, renderConfig, avatarFitConfig, holdMicroMotionEnabled, footIkEnabled } =
    characterSettings;
  return (
    <div className="stage" data-mode={stageMode}>
      <div className="stageAtmosphere" aria-hidden="true">
        <span className="stageOrb stageOrbOne" />
        <span className="stageOrb stageOrbTwo" />
        <span className="stageRing" />
      </div>
      <div className="stageIdentity" aria-hidden="true">
        <small>COMPANION CHANNEL</small>
        <strong>SERVANT / 01</strong>
      </div>
      <div className="stageCorner stageCornerTop" aria-hidden="true" />
      <div className="stageCorner stageCornerBottom" aria-hidden="true" />
      <VrmStage
        modelUrl={selectedVrmModel.url}
        avatarFitConfig={avatarFitConfig}
        holdMicroMotionEnabled={holdMicroMotionEnabled}
        footIkEnabled={footIkEnabled}
        ttsProvider={activeTtsProvider}
        renderConfig={renderConfig}
        onEngineReady={handleVrmReady}
        onStatus={handleVrmStatus}
      />
      <div className="assetStatus">
        {stageMode === 'vrm' ? vrmStatus : `${vrmStatus} · mock fallback active`}
      </div>

      {stageMode === 'vrm' ? (
        <div className="speechOverlay" data-speaking={snapshot.speech.speaking}>
          {snapshot.speech.text || '...'}
        </div>
      ) : (
        <div
          className={[
            'avatar',
            ...snapshot.action.activeActions.map((action) => `action-${action}`),
            `motion-${snapshot.body.currentAction ?? 'none'}`,
            `expr-${snapshot.expression.id}`,
            `tail-${snapshot.accessory.preset}`,
            `face-${snapshot.spatial.facing}`
          ].join(' ')}
          style={{
            left: `${snapshot.spatial.x}%`,
            top: `${snapshot.spatial.y}%`,
            transform: `translate(-50%, -50%) scale(${snapshot.spatial.scale})`
          }}
        >
          <div className="speechBubble" data-speaking={snapshot.speech.speaking}>
            {snapshot.speech.text || '...'}
          </div>
          <button
            className="tail"
            data-visible={snapshot.spatial.tailVisible}
            onClick={engine.actions.tailPoke}
            title="Tail poke"
            type="button"
          />
          <div className="body">
            <div className="head">
              <div className="ear leftEar" />
              <div className="ear rightEar" />
              <div className="eye leftEye" />
              <div className="eye rightEye" />
              <div className="mouth" />
              <div className="blush leftBlush" />
              <div className="blush rightBlush" />
            </div>
            <div className="torso" />
          </div>
        </div>
      )}

      {snapshot.fx.active.tears ? <div className="tearFx" /> : null}
      {snapshot.fx.active.water_rise ? <div className="waterFx" /> : null}
      {snapshot.fx.active.hearts ? <div className="heartFx">♥ ♥ ♥</div> : null}
      {snapshot.spatial.offscreen && snapshot.spatial.tailVisible ? (
        <div className="tailHint">tail visible</div>
      ) : null}
    </div>
  );
}
