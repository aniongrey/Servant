import type { Dispatch, SetStateAction } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  type CharacterRenderConfig,
  defaultCharacterRenderConfig
} from '../../character/vrm/CharacterRenderConfig';
import { PanelTitle, ControlGroup, ControlRange } from './SettingsControls';

interface Props {
  renderConfig: CharacterRenderConfig;
  setRenderConfig: Dispatch<SetStateAction<CharacterRenderConfig>>;
}

export function CharacterLightingSettings({ renderConfig, setRenderConfig }: Props) {
  const updateRender = <K extends keyof CharacterRenderConfig>(key: K, value: CharacterRenderConfig[K]) => {
    setRenderConfig((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="aurelia-panel aurelia-character-panel-lighting" tabIndex={0} aria-label="Lighting 参数">
      <PanelTitle title="Lighting" eyebrow="RENDER" />
      <ControlGroup title="基础光照">
        <div className="aurelia-control-grid">
          <ControlRange
            label="主光强度"
            min={0.5}
            max={4}
            step={0.05}
            value={renderConfig.mainLightIntensity}
            onChange={(value) => updateRender('mainLightIntensity', value)}
          />
          <ControlRange
            label="环境补光"
            min={0}
            max={1.4}
            step={0.02}
            value={renderConfig.ambientLightIntensity}
            onChange={(value) => updateRender('ambientLightIntensity', value)}
          />
        </div>
      </ControlGroup>

      <ControlGroup
        title="MToon Shade"
        enabled={renderConfig.mtoonShadeEnabled}
        onEnabledChange={(enabled) => updateRender('mtoonShadeEnabled', enabled)}
      >
        <div className="aurelia-control-grid one-column">
          <ControlRange
            label="Shade Dark"
            min={0}
            max={1}
            step={0.02}
            value={renderConfig.shadeStrength}
            onChange={(value) => updateRender('shadeStrength', value)}
          />
          <ControlRange
            label="Shade Area"
            min={-0.5}
            max={0.5}
            step={0.01}
            value={renderConfig.shadingShift}
            onChange={(value) => updateRender('shadingShift', value)}
          />
          <ControlRange
            label="Shade Edge"
            min={0}
            max={1}
            step={0.02}
            value={renderConfig.shadingToony}
            onChange={(value) => updateRender('shadingToony', value)}
          />
        </div>
        <ControlGroup
          title="MToon AO"
          enabled={renderConfig.mtoonAoEnabled}
          onEnabledChange={(enabled) => updateRender('mtoonAoEnabled', enabled)}
        >
          <div className="aurelia-control-grid one-column">
            <ControlRange
              label="AO Strength"
              min={0}
              max={0.6}
              step={0.01}
              value={renderConfig.mtoonAoStrength}
              onChange={(value) => updateRender('mtoonAoStrength', value)}
            />
          </div>
        </ControlGroup>
      </ControlGroup>

      <ControlGroup
        title="Rim Light"
        enabled={renderConfig.rimEnabled}
        onEnabledChange={(enabled) => updateRender('rimEnabled', enabled)}
      >
        <div className="aurelia-control-grid one-column">
          <ControlRange
            label="Rim Strength"
            min={0}
            max={1}
            step={0.02}
            value={renderConfig.rimStrength}
            onChange={(value) => updateRender('rimStrength', value)}
          />
          <ControlRange
            label="Rim Power"
            min={0.8}
            max={6}
            step={0.1}
            value={renderConfig.rimFresnelPower}
            onChange={(value) => updateRender('rimFresnelPower', value)}
          />
        </div>
      </ControlGroup>

      <ControlGroup
        title="Outline"
        enabled={renderConfig.outlineEnabled}
        onEnabledChange={(enabled) => updateRender('outlineEnabled', enabled)}
      >
        <div className="aurelia-control-grid one-column">
          <ControlRange
            label="Line Width"
            min={0}
            max={0.015}
            step={0.001}
            value={renderConfig.outlineWidth}
            onChange={(value) => updateRender('outlineWidth', value)}
          />
          <ControlRange
            label="Line Dark"
            min={0}
            max={1}
            step={0.02}
            value={renderConfig.outlineDarkness}
            onChange={(value) => updateRender('outlineDarkness', value)}
          />
        </div>
      </ControlGroup>

      <ControlGroup
        title="Hair Highlight"
        enabled={renderConfig.hairHighlightEnabled}
        onEnabledChange={(enabled) => updateRender('hairHighlightEnabled', enabled)}
      >
        <div className="aurelia-control-grid one-column">
          <ControlRange
            label="Hair Shine"
            min={0}
            max={0.8}
            step={0.01}
            value={renderConfig.hairHighlightStrength}
            onChange={(value) => updateRender('hairHighlightStrength', value)}
          />
        </div>
      </ControlGroup>

      <ControlGroup
        title="Back Shadow"
        enabled={renderConfig.backShadowEnabled}
        onEnabledChange={(enabled) => updateRender('backShadowEnabled', enabled)}
      >
        <div className="aurelia-control-grid one-column">
          <ControlRange
            label="Back X"
            min={-80}
            max={80}
            step={1}
            value={renderConfig.backShadowOffsetX}
            onChange={(value) => updateRender('backShadowOffsetX', value)}
          />
          <ControlRange
            label="Back Y"
            min={-80}
            max={80}
            step={1}
            value={renderConfig.backShadowOffsetY}
            onChange={(value) => updateRender('backShadowOffsetY', value)}
          />
          <ControlRange
            label="Back Blur"
            min={0}
            max={24}
            step={1}
            value={renderConfig.backShadowBlur}
            onChange={(value) => updateRender('backShadowBlur', value)}
          />
          <ControlRange
            label="Back Alpha"
            min={0}
            max={0.8}
            step={0.02}
            value={renderConfig.backShadowOpacity}
            onChange={(value) => updateRender('backShadowOpacity', value)}
          />
        </div>
      </ControlGroup>

      <ControlGroup
        title="Foot Shadow"
        enabled={renderConfig.contactShadowEnabled}
        onEnabledChange={(enabled) => updateRender('contactShadowEnabled', enabled)}
      >
        <div className="aurelia-control-grid one-column">
          <ControlRange
            label="Foot Alpha"
            min={0}
            max={0.55}
            step={0.01}
            value={renderConfig.contactShadowOpacity}
            onChange={(value) => updateRender('contactShadowOpacity', value)}
          />
          <ControlRange
            label="Foot Width"
            min={0.2}
            max={1.5}
            step={0.01}
            value={renderConfig.contactShadowWidth}
            onChange={(value) => updateRender('contactShadowWidth', value)}
          />
          <ControlRange
            label="Foot Depth"
            min={0.1}
            max={1}
            step={0.01}
            value={renderConfig.contactShadowDepth}
            onChange={(value) => updateRender('contactShadowDepth', value)}
          />
          <ControlRange
            label="Height Fade"
            min={0}
            max={1.5}
            step={0.05}
            value={renderConfig.contactShadowHeightFade}
            onChange={(value) => updateRender('contactShadowHeightFade', value)}
          />
        </div>
      </ControlGroup>

      <button
        className="aurelia-reset-button"
        type="button"
        onClick={() => setRenderConfig(defaultCharacterRenderConfig)}
      >
        <RotateCcw size={14} /> 恢复 Lighting 默认值
      </button>
    </section>
  );
}
