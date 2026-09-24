import { lightingGroups } from './lightingFields';
import { Sparkles, SlidersHorizontal, RotateCcw, ChevronDown, Save, ChevronRight } from 'lucide-react';
import { RenderSlider, RenderGroupHeader } from './DebugControls';
import type { DebugCharacterSettings } from './useDebugCharacterSettings';

export function LightingPanel({
  characterSettings
}: {
  characterSettings: Pick<
    DebugCharacterSettings,
    | 'renderConfig'
    | 'renderPanelOpen'
    | 'setRenderPanelOpen'
    | 'updateRenderConfig'
    | 'resetRenderConfig'
    | 'downloadLightingConfig'
  >;
}) {
  const {
    renderConfig,
    renderPanelOpen,
    setRenderPanelOpen,
    updateRenderConfig,
    resetRenderConfig,
    downloadLightingConfig
  } = characterSettings;

  return (
    <section className="panelSection">
      <div className="panelHeader">
        <button
          aria-expanded={renderPanelOpen}
          className="panelTitleButton"
          onClick={() => setRenderPanelOpen((open) => !open)}
          title={renderPanelOpen ? 'Collapse render settings' : 'Expand render settings'}
          type="button"
        >
          {renderPanelOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <h2>Lighting</h2>
        </button>
        <div className="panelHeaderActions">
          <button
            className="iconButton"
            onClick={downloadLightingConfig}
            title="Save Lighting JSON"
            type="button"
          >
            <Save size={16} />
          </button>
          <button className="iconButton" onClick={resetRenderConfig} title="Reset lighting" type="button">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
      {renderPanelOpen ? (
        <div className="collapsiblePanel">
          {lightingGroups.map((group) => (
            <div className="renderSettingGroup" key={group.toggle}>
              <RenderGroupHeader
                checked={renderConfig[group.toggle]}
                label={group.label}
                onChange={(checked) => updateRenderConfig(group.toggle, checked)}
                toggleLabel={group.toggleLabel}
              />
              {group.fields.map((field) => (
                <RenderSlider
                  key={field.key}
                  icon={field.sparkle ? <Sparkles size={16} /> : <SlidersHorizontal size={16} />}
                  label={field.label}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={renderConfig[field.key]}
                  onChange={(value) => updateRenderConfig(field.key, value)}
                />
              ))}
              {group.extraToggle && (
                <label className="inlineToggleRow">
                  <span>{group.extraToggle.label}</span>
                  <input
                    checked={renderConfig[group.extraToggle.key]}
                    onChange={(event) =>
                      updateRenderConfig(group.extraToggle!.key, event.currentTarget.checked)
                    }
                    type="checkbox"
                  />
                </label>
              )}
            </div>
          ))}
          <p className="hintText">Saved locally in this browser.</p>
        </div>
      ) : null}
    </section>
  );
}
