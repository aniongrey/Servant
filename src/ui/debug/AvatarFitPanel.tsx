import { SlidersHorizontal, RotateCcw, ChevronDown, Save, ChevronRight } from 'lucide-react';
import { PreciseRenderSlider, RenderSlider } from './DebugControls';
import type { DebugCharacterSettings } from './useDebugCharacterSettings';
import { avatarFitRanges } from '../../character/ik/AvatarFitConfig';

export function AvatarFitPanel({
  characterSettings
}: {
  characterSettings: Pick<
    DebugCharacterSettings,
    | 'avatarFitConfig'
    | 'holdMicroMotionEnabled'
    | 'setHoldMicroMotionEnabled'
    | 'footIkEnabled'
    | 'setFootIkEnabled'
    | 'avatarFitPanelOpen'
    | 'setAvatarFitPanelOpen'
    | 'updateAvatarFitNumber'
    | 'updateAvatarFitBoolean'
    | 'updateWristRotationOffset'
    | 'updateHeadCollider'
    | 'updateTorsoCollider'
    | 'updateHandIkRule'
    | 'resetAvatarFitConfig'
    | 'downloadAvatarFitConfig'
  >;
}) {
  const {
    avatarFitConfig,
    holdMicroMotionEnabled,
    setHoldMicroMotionEnabled,
    footIkEnabled,
    setFootIkEnabled,
    avatarFitPanelOpen,
    setAvatarFitPanelOpen,
    updateAvatarFitNumber,
    updateAvatarFitBoolean,
    updateWristRotationOffset,
    updateHeadCollider,
    updateTorsoCollider,
    updateHandIkRule,
    resetAvatarFitConfig,
    downloadAvatarFitConfig
  } = characterSettings;

  return (
    <section className="panelSection">
      <div className="panelHeader">
        <button
          aria-expanded={avatarFitPanelOpen}
          className="panelTitleButton"
          onClick={() => setAvatarFitPanelOpen((open) => !open)}
          title={avatarFitPanelOpen ? 'Collapse avatar fit settings' : 'Expand avatar fit settings'}
          type="button"
        >
          {avatarFitPanelOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <h2>Avatar Fit</h2>
        </button>
        <div className="panelHeaderActions">
          <button
            className="iconButton"
            onClick={downloadAvatarFitConfig}
            title="Save Avatar Fit JSON"
            type="button"
          >
            <Save size={16} />
          </button>
          <button
            className="iconButton"
            onClick={resetAvatarFitConfig}
            title="Reset avatar fit"
            type="button"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
      {avatarFitPanelOpen ? (
        <div className="collapsiblePanel">
          <label className="inlineToggleRow avatarFitVisualToggle">
            <span>Show Guide</span>
            <input
              checked={avatarFitConfig.showGuide}
              onChange={(event) => updateAvatarFitBoolean('showGuide', event.currentTarget.checked)}
              type="checkbox"
            />
          </label>
          <label className="inlineToggleRow avatarFitVisualToggle">
            <span>Global Hand IK</span>
            <input
              checked={avatarFitConfig.handIk.enabled}
              onChange={(event) => updateHandIkRule('enabled', event.currentTarget.checked)}
              type="checkbox"
            />
          </label>
          <label className="inlineToggleRow avatarFitVisualToggle">
            <span>Global Hold Micro Motion</span>
            <input
              checked={holdMicroMotionEnabled}
              onChange={(event) => setHoldMicroMotionEnabled(event.currentTarget.checked)}
              type="checkbox"
            />
          </label>
          <label className="inlineToggleRow avatarFitVisualToggle">
            <span>Global Foot IK</span>
            <input
              checked={footIkEnabled}
              onChange={(event) => setFootIkEnabled(event.currentTarget.checked)}
              type="checkbox"
            />
          </label>
          <div className="renderSettingGroup">
            <h3>Body Measure</h3>
            <RenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Height"
              {...avatarFitRanges.height}
              value={avatarFitConfig.height}
              onChange={(value) => updateAvatarFitNumber('height', value)}
            />
            <RenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Shoulder"
              {...avatarFitRanges.shoulderWidth}
              value={avatarFitConfig.shoulderWidth}
              onChange={(value) => updateAvatarFitNumber('shoulderWidth', value)}
            />
            <RenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Arm"
              {...avatarFitRanges.armLength}
              value={avatarFitConfig.armLength}
              onChange={(value) => updateAvatarFitNumber('armLength', value)}
            />
            <RenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Foot Y"
              {...avatarFitRanges.footGroundOffset}
              value={avatarFitConfig.footGroundOffset}
              onChange={(value) => updateAvatarFitNumber('footGroundOffset', value)}
            />
          </div>

          <div className="renderSettingGroup">
            <h3>Wrist Offset</h3>
            <PreciseRenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Wrist X"
              min={-90}
              max={90}
              step={1}
              value={avatarFitConfig.wristRotationOffset.x}
              onChange={(value) => updateWristRotationOffset('x', value)}
            />
            <PreciseRenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Wrist Y"
              min={-90}
              max={90}
              step={1}
              value={avatarFitConfig.wristRotationOffset.y}
              onChange={(value) => updateWristRotationOffset('y', value)}
            />
            <PreciseRenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Wrist Z"
              min={-90}
              max={90}
              step={1}
              value={avatarFitConfig.wristRotationOffset.z}
              onChange={(value) => updateWristRotationOffset('z', value)}
            />
          </div>

          <div className="renderSettingGroup">
            <h3>Colliders</h3>
            <RenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Head R"
              {...avatarFitRanges.headRadius}
              value={avatarFitConfig.colliders.head.radius}
              onChange={(value) => updateHeadCollider('radius', value)}
            />
            <RenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Head Y"
              {...avatarFitRanges.headHeight}
              value={avatarFitConfig.colliders.head.height}
              onChange={(value) => updateHeadCollider('height', value)}
            />
            <RenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Top R"
              {...avatarFitRanges.torsoRadius}
              value={avatarFitConfig.colliders.torso.topRadius}
              onChange={(value) => updateTorsoCollider('topRadius', value)}
            />
            <RenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Bottom R"
              {...avatarFitRanges.torsoRadius}
              value={avatarFitConfig.colliders.torso.bottomRadius}
              onChange={(value) => updateTorsoCollider('bottomRadius', value)}
            />
            <RenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Top Y"
              {...avatarFitRanges.torsoTopHeight}
              value={avatarFitConfig.colliders.torso.topHeight}
              onChange={(value) => updateTorsoCollider('topHeight', value)}
            />
            <RenderSlider
              icon={<SlidersHorizontal size={16} />}
              label="Bottom Y"
              {...avatarFitRanges.torsoBottomHeight}
              value={avatarFitConfig.colliders.torso.bottomHeight}
              onChange={(value) => updateTorsoCollider('bottomHeight', value)}
            />
          </div>
          <p className="hintText">
            Hand IK {avatarFitConfig.handIk.enabled ? 'enabled' : 'disabled'} globally for motions containing
            arm tracks.
          </p>
        </div>
      ) : null}
    </section>
  );
}
