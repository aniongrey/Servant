import type { Dispatch, SetStateAction } from 'react';
import { RotateCcw, WandSparkles } from 'lucide-react';
import {
  characterProportionRanges,
  defaultCharacterProportionConfig,
  type CharacterProportionConfig
} from '../../character/vrm/CharacterProportion';
import { ControlGroup, ControlRange, PanelTitle } from './SettingsControls';

export function CharacterProportionSettings({
  config,
  setConfig
}: {
  config: CharacterProportionConfig;
  setConfig: Dispatch<SetStateAction<CharacterProportionConfig>>;
}) {
  const update = (key: 'headScale' | 'bodyHeight' | 'bodyWidth', value: number) =>
    setConfig((current) => ({ ...current, [key]: value }));

  return (
    <section
      className="aurelia-panel aurelia-character-panel-ratio"
      tabIndex={0}
      aria-label="Q版角色比例参数"
    >
      <PanelTitle title="Q版比例" eyebrow="CHIBI" />
      <div className="aurelia-preview-actions">
        <button
          type="button"
          aria-pressed={config.chibiEnabled}
          onClick={() => setConfig((current) => ({ ...current, chibiEnabled: !current.chibiEnabled }))}
        >
          <WandSparkles size={14} /> {config.chibiEnabled ? '恢复原比例' : '转为 Q 版'}
        </button>
      </div>
      <ControlGroup title="角色比例">
        <div className="aurelia-control-grid one-column">
          <ControlRange
            label="头部大小"
            {...characterProportionRanges.headScale}
            value={config.headScale}
            onChange={(value) => update('headScale', value)}
          />
          <ControlRange
            label="身体高度"
            {...characterProportionRanges.bodyHeight}
            value={config.bodyHeight}
            onChange={(value) => update('bodyHeight', value)}
          />
          <ControlRange
            label="身体宽度"
            {...characterProportionRanges.bodyWidth}
            value={config.bodyWidth}
            onChange={(value) => update('bodyWidth', value)}
          />
        </div>
      </ControlGroup>
      <button
        className="aurelia-reset-button"
        type="button"
        onClick={() =>
          setConfig((current) => ({
            ...defaultCharacterProportionConfig,
            chibiEnabled: current.chibiEnabled
          }))
        }
      >
        <RotateCcw size={14} /> 恢复 Q 版默认值
      </button>
    </section>
  );
}
