import type { Dispatch, SetStateAction } from 'react';
import { avatarFitRanges, type AvatarFitConfig } from '../../character/ik/AvatarFitConfig';
import { PanelTitle, ControlGroup, ControlRange, SettingRow, Toggle } from './SettingsControls';
import { humanize } from './settingsState';

interface Props {
  avatarFit: AvatarFitConfig;
  setAvatarFit: Dispatch<SetStateAction<AvatarFitConfig>>;
  holdMicroMotionEnabled: boolean;
  setHoldMicroMotionEnabled: (enabled: boolean) => void;
  footIkEnabled: boolean;
  setFootIkEnabled: (enabled: boolean) => void;
}

export function CharacterFitSettings({
  avatarFit,
  setAvatarFit,
  holdMicroMotionEnabled,
  setHoldMicroMotionEnabled,
  footIkEnabled,
  setFootIkEnabled
}: Props) {
  const updateAvatarNumber = (
    key: 'height' | 'shoulderWidth' | 'armLength' | 'footGroundOffset',
    value: number
  ) => {
    setAvatarFit((current) => ({ ...current, [key]: value, showGuide: true }));
  };
  const updateAvatarFitWithGuide = (update: (current: AvatarFitConfig) => AvatarFitConfig) => {
    setAvatarFit((current) => ({ ...update(current), showGuide: true }));
  };

  return (
    <section
      className="aurelia-panel aurelia-character-panel-fit"
      tabIndex={0}
      aria-label="Avatar Fit 参数"
    >
      <PanelTitle title="Avatar Fit" eyebrow="BODY CALIBRATION" />
      <ControlGroup title="基础尺寸">
        <div className="aurelia-control-grid">
          <ControlRange
            label="身高"
            {...avatarFitRanges.height}
            value={avatarFit.height}
            onChange={(value) => updateAvatarNumber('height', value)}
          />
          <ControlRange
            label="肩宽"
            {...avatarFitRanges.shoulderWidth}
            value={avatarFit.shoulderWidth}
            onChange={(value) => updateAvatarNumber('shoulderWidth', value)}
          />
          <ControlRange
            label="臂长"
            {...avatarFitRanges.armLength}
            value={avatarFit.armLength}
            onChange={(value) => updateAvatarNumber('armLength', value)}
          />
          <ControlRange
            label="脚底偏移"
            {...avatarFitRanges.footGroundOffset}
            value={avatarFit.footGroundOffset}
            onChange={(value) => updateAvatarNumber('footGroundOffset', value)}
          />
        </div>
      </ControlGroup>
      <details className="aurelia-advanced-controls">
        <summary>高级拟合</summary>
        <ControlGroup title="手腕旋转">
          <div className="aurelia-control-grid">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <ControlRange
                key={axis}
                label={`手腕 ${axis.toUpperCase()}`}
                min={-90}
                max={90}
                step={1}
                value={avatarFit.wristRotationOffset[axis]}
                onChange={(value) =>
                  updateAvatarFitWithGuide((current) => ({
                    ...current,
                    wristRotationOffset: { ...current.wristRotationOffset, [axis]: value }
                  }))
                }
              />
            ))}
          </div>
        </ControlGroup>
        <ControlGroup title="头部碰撞体">
          <div className="aurelia-control-grid">
            <ControlRange
              label="头部半径"
              {...avatarFitRanges.headRadius}
              value={avatarFit.colliders.head.radius}
              onChange={(value) =>
                updateAvatarFitWithGuide((current) => ({
                  ...current,
                  colliders: { ...current.colliders, head: { ...current.colliders.head, radius: value } }
                }))
              }
            />
            <ControlRange
              label="头部高度"
              {...avatarFitRanges.headHeight}
              value={avatarFit.colliders.head.height}
              onChange={(value) =>
                updateAvatarFitWithGuide((current) => ({
                  ...current,
                  colliders: { ...current.colliders, head: { ...current.colliders.head, height: value } }
                }))
              }
            />
          </div>
        </ControlGroup>
        <ControlGroup title="躯干碰撞体">
          <div className="aurelia-control-grid">
            {(['topRadius', 'bottomRadius', 'topHeight', 'bottomHeight'] as const).map((key) => (
              <ControlRange
                key={key}
                label={humanize(key)}
                {...(key.includes('Radius')
                  ? avatarFitRanges.torsoRadius
                  : key === 'topHeight'
                  ? avatarFitRanges.torsoTopHeight
                  : avatarFitRanges.torsoBottomHeight)}
                value={avatarFit.colliders.torso[key]}
                onChange={(value) =>
                  updateAvatarFitWithGuide((current) => ({
                    ...current,
                    colliders: { ...current.colliders, torso: { ...current.colliders.torso, [key]: value } }
                  }))
                }
              />
            ))}
          </div>
        </ControlGroup>
      </details>
      <ControlGroup title="运行辅助">
        <div className="aurelia-setting-list aurelia-setting-list-two">
          <SettingRow
            title="Hand IK"
            description={`${avatarFit.handIk.iterations} 次迭代 · 强度 ${avatarFit.handIk.strength}`}
            control={
              <Toggle
                checked={avatarFit.handIk.enabled}
                label="Hand IK"
                onChange={(checked) =>
                  setAvatarFit((current) => ({
                    ...current,
                    handIk: { ...current.handIk, enabled: checked }
                  }))
                }
              />
            }
          />
          <SettingRow
            title="拟合引导线"
            description="显示碰撞体与关节参考"
            control={
              <Toggle
                checked={avatarFit.showGuide}
                label="拟合引导线"
                onChange={(checked) => setAvatarFit((current) => ({ ...current, showGuide: checked }))}
              />
            }
          />
          <SettingRow
            title="Hold 微动作"
            description="持续动作加入呼吸与细微变化"
            control={
              <Toggle
                checked={holdMicroMotionEnabled}
                label="Hold 微动作"
                onChange={setHoldMicroMotionEnabled}
              />
            }
          />
          <SettingRow
            title="Foot IK"
            description="角色脚底自适应地面"
            control={<Toggle checked={footIkEnabled} label="Foot IK" onChange={setFootIkEnabled} />}
          />
        </div>
      </ControlGroup>
    </section>
  );
}
