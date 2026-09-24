import { useVrmLibrary } from './useVrmLibrary';
import { CharacterFitSettings } from './CharacterFitSettings';
import { CharacterLightingSettings } from './CharacterLightingSettings';
import { CharacterProportionSettings } from './CharacterProportionSettings';
import { downloadTextFile } from '../../app/utils/downloadFile';
import {
  loadCharacterRenderConfig,
  saveCharacterRenderConfig
} from '../../character/vrm/characterRenderSettings';
import { loadAvatarFitConfig, saveAvatarFitConfig } from '../../character/ik/avatarFitSettings';
import {
  loadCharacterProportionConfig,
  saveCharacterProportionConfig
} from '../../character/vrm/characterProportionSettings';
import {
  HOLD_MICRO_MOTION_ENABLED_STORAGE_KEY,
  FOOT_IK_ENABLED_STORAGE_KEY,
  DEFAULT_HOLD_MICRO_MOTION_ENABLED,
  DEFAULT_FOOT_IK_ENABLED
} from '../../app/settings/storageKeys';
import { loadBooleanSetting, formatFileSize } from './settingsState';
import { vrmModelOptions } from '../../character/vrm/assets/vrmModels';
import { useState, useRef, useEffect, type ChangeEvent, useCallback } from 'react';

import { type AvatarFitConfig } from '../../character/ik/AvatarFitConfig';
import type { CharacterRenderConfig } from '../../character/vrm/CharacterRenderConfig';
import {
  type CharacterSkill,
  pendingCharacterSkill,
  loadCharacterSkillLibrary,
  importCharacterSkill,
  selectCharacterSkill,
  deleteCharacterSkill,
  CHARACTER_SKILL_SELECTION_KEY,
  loadCharacterPromptSettings,
  saveCharacterPromptSettings,
  emptyCharacterSkill,
  type CharacterPromptSettings,
  type CharacterSkillLibrary
} from '../../ai/personality/CharacterSkill';
import { publishDesktopCharacter } from '../../desktop/tauri/publishDesktopCharacter';
import { PanelTitle, ConfirmModal, SettingRow, Toggle } from './SettingsControls';
import { VrmStage } from '../../character/vrm/VrmStage';
import { DEFAULT_CAMERA_ZOOM } from '../../character/vrm/cameraZoom';
import { Upload, RotateCcw, Database, Trash2, Download } from 'lucide-react';

const NATURAL_CONVERSATION_PROMPT = `像真实的人一样自然聊天，不要刻意展示角色设定。
角色卡只代表长期性格倾向，不要每句话都体现人格。大多数时候保持普通、简短、自然的口语；只有在被夸、被逗、生气、害羞、在意某件事等合适情境下，才明显表现角色性格。
不要像客服或AI助手，不要频繁总结、列点、复述用户的话，也不要每次结尾都提问或说“需要我帮你吗”。
回复长度根据聊天内容自然变化，可以使用短句、停顿和省略，但不要机械添加语气词。
不要用文字描述“脸红、转头、生气”等动作和表情，这些交给外部表情、动作和TTS系统控制。
优先考虑：这个角色如果真的在和用户聊天，现在最自然会说什么，而不是怎样证明自己符合角色卡。`;

export function CharacterSettings() {
  const {
    modelId,
    importedModels,
    activeImportedId,
    modelsLoaded,
    deleteVrmTarget,
    setDeleteVrmTarget,
    assetMessage,
    setAssetMessage,
    modelInputRef,
    selectedModel,
    activeImportedModel,
    selectModel,
    selectImportedModel,
    importModel,
    confirmDeleteVrm
  } = useVrmLibrary();
  const [stageStatus, setStageStatus] = useState('正在准备角色预览…');
  const [previewZoom, setPreviewZoom] = useState(DEFAULT_CAMERA_ZOOM);
  const [avatarFit, setAvatarFit] = useState<AvatarFitConfig>(loadAvatarFitConfig);
  const [renderConfig, setRenderConfig] = useState<CharacterRenderConfig>(loadCharacterRenderConfig);
  const [proportionConfig, setProportionConfig] = useState(loadCharacterProportionConfig);
  const [holdMicroMotionEnabled, setHoldMicroMotionEnabled] = useState(() =>
    loadBooleanSetting(HOLD_MICRO_MOTION_ENABLED_STORAGE_KEY, DEFAULT_HOLD_MICRO_MOTION_ENABLED)
  );
  const [footIkEnabled, setFootIkEnabled] = useState(() =>
    loadBooleanSetting(FOOT_IK_ENABLED_STORAGE_KEY, DEFAULT_FOOT_IK_ENABLED)
  );
  const [characterSkill, setCharacterSkill] = useState<CharacterSkill>(pendingCharacterSkill);
  const [skillMessage, setSkillMessage] = useState('');
  const [skillLibrary, setSkillLibrary] = useState<CharacterSkillLibrary | null>(null);
  const [skillBusy, setSkillBusy] = useState(false);
  const [promptSettings, setPromptSettings] = useState<CharacterPromptSettings>(loadCharacterPromptSettings);
  const [deleteSkillTarget, setDeleteSkillTarget] = useState<(CharacterSkill & { id: string }) | null>(null);
  const skillInputRef = useRef<HTMLInputElement | null>(null);
  const desktopPublishReadyRef = useRef(false);
  const applySkillLibrary = (library: CharacterSkillLibrary) => {
    setSkillLibrary(library);
    setCharacterSkill(library.cards.find((card) => card.id === library.activeId) ?? emptyCharacterSkill);
  };
  const changeSkillLibrary = async (operation: () => Promise<CharacterSkillLibrary>) => {
    setSkillBusy(true);
    setSkillMessage('');
    try {
      applySkillLibrary(await operation());
    } catch (error) {
      setSkillMessage(error instanceof Error ? error.message : '角色卡操作失败');
    } finally {
      setSkillBusy(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      void loadCharacterSkillLibrary(controller.signal)
        .then((library) => {
          if (!controller.signal.aborted) applySkillLibrary(library);
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setSkillMessage(error instanceof Error ? error.message : '角色卡读取失败');
        });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === CHARACTER_SKILL_SELECTION_KEY) refresh();
    };
    refresh();
    window.addEventListener('storage', onStorage);
    return () => {
      controller.abort();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!modelsLoaded) return;
    if (!desktopPublishReadyRef.current) {
      desktopPublishReadyRef.current = true;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void publishDesktopCharacter(
        {
          version: 1,
          model: { id: activeImportedModel?.id ?? modelId },
          avatarFit,
          renderConfig,
          proportionConfig,
          holdMicroMotionEnabled,
          footIkEnabled
        },
        activeImportedModel,
        controller.signal
      ).catch((error) => {
        if (!controller.signal.aborted)
          setAssetMessage(`本地设置已保留；${error instanceof Error ? error.message : '桌宠同步失败'}`);
      });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    modelsLoaded,
    modelId,
    activeImportedModel,
    avatarFit,
    renderConfig,
    proportionConfig,
    holdMicroMotionEnabled,
    footIkEnabled
  ]);

  useEffect(() => saveAvatarFitConfig(avatarFit), [avatarFit]);
  useEffect(() => saveCharacterRenderConfig(renderConfig), [renderConfig]);
  useEffect(() => saveCharacterProportionConfig(proportionConfig), [proportionConfig]);
  useEffect(() => saveCharacterPromptSettings(promptSettings), [promptSettings]);
  useEffect(
    () => localStorage.setItem(HOLD_MICRO_MOTION_ENABLED_STORAGE_KEY, String(holdMicroMotionEnabled)),
    [holdMicroMotionEnabled]
  );
  useEffect(() => localStorage.setItem(FOOT_IK_ENABLED_STORAGE_KEY, String(footIkEnabled)), [footIkEnabled]);
  const importSkill = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setSkillBusy(true);
    setSkillMessage('');
    try {
      await importCharacterSkill(await file.text(), file.name);
      applySkillLibrary(await loadCharacterSkillLibrary());
    } catch (error) {
      setSkillMessage(error instanceof Error ? error.message : 'skills.md 导入失败');
    } finally {
      setSkillBusy(false);
    }
  };
  const handleEngineReady = useCallback(() => setStageStatus('角色已载入 · 可拖动旋转预览'), []);
  const handleStageStatus = useCallback((message: string) => setStageStatus(message), []);
  const handlePreviewZoomChange = useCallback((zoom: number) => setPreviewZoom(zoom), []);

  return (
    <div className="aurelia-character-layout">
      <section className="aurelia-panel aurelia-character-figure">
        <PanelTitle title="角色预览" eyebrow="AVATAR" />
        <div className="aurelia-avatar-stage">
          <VrmStage
            modelUrl={activeImportedModel?.url ?? selectedModel.url}
            avatarFitConfig={avatarFit}
            holdMicroMotionEnabled={holdMicroMotionEnabled}
            footIkEnabled={footIkEnabled}
            renderConfig={renderConfig}
            proportionConfig={proportionConfig}
            initialZoom={previewZoom}
            wheelZoomEnabled={!proportionConfig.chibiEnabled}
            wheelZoomAnchorY={0}
            onZoomChange={handlePreviewZoomChange}
            onEngineReady={handleEngineReady}
            onStatus={handleStageStatus}
          />
          <div className="aurelia-avatar-overlay">
            <strong>{characterSkill.config.displayName}</strong>
            <span>{activeImportedModel?.name ?? selectedModel.label}</span>
          </div>
        </div>
        <p className="aurelia-stage-status">{stageStatus}</p>
        <label className="aurelia-field">
          <span>内置角色</span>
          <select
            value={activeImportedModel ? '' : modelId}
            onChange={(event) => selectModel(event.currentTarget.value)}
          >
            <option value="" disabled>
              选择内置角色
            </option>
            {vrmModelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <div className="aurelia-preview-actions">
          <button type="button" onClick={() => modelInputRef.current?.click()}>
            <Upload size={14} /> 导入 VRM
          </button>
          {activeImportedModel ? (
            <button type="button" onClick={() => selectModel(modelId)}>
              <RotateCcw size={14} /> 返回内置角色
            </button>
          ) : null}
          <input
            ref={modelInputRef}
            hidden
            multiple
            type="file"
            accept=".vrm,model/gltf-binary"
            onChange={(event) => void importModel(event)}
          />
        </div>
        <div className="aurelia-vrm-library">
          <div className="aurelia-vrm-library-heading">
            <span>已导入 VRM</span>
            <small>{importedModels.length} 个 · 本地持久保存</small>
          </div>
          {importedModels.length === 0 ? (
            <p>暂无导入角色，点击“导入 VRM”添加。</p>
          ) : (
            importedModels.map((model) => (
              <div
                className="aurelia-vrm-library-row"
                data-active={model.id === activeImportedId}
                key={model.id}
              >
                <button type="button" onClick={() => selectImportedModel(model.id)}>
                  <Database size={13} />
                  <span>
                    {model.name}
                    <small>{formatFileSize(model.size)}</small>
                  </span>
                </button>
                <button
                  aria-label={`删除 ${model.name}`}
                  className="aurelia-danger-icon"
                  type="button"
                  onClick={() => setDeleteVrmTarget(model)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
        <p className="aurelia-field-hint">{assetMessage}</p>
        <div className="aurelia-asset-pill">
          <Database size={13} /> {activeImportedModel ? activeImportedModel.name : selectedModel.url}
        </div>
      </section>
      {/* 控制区按「块」排版：左列上下一分为二（上＝Q版比例、下＝Avatar Fit），
          Lighting 独占右列，角色卡通栏收尾（通栏是为了让「追加提示词」不被挤成半栏）。
          各块占哪块区域由 user-interface.css 的 grid-template-areas 决定。 */}
      <div className="aurelia-character-controls">
        <CharacterProportionSettings config={proportionConfig} setConfig={setProportionConfig} />
        <section className="aurelia-panel aurelia-character-skill">
          <PanelTitle title="角色卡" eyebrow="SKILLS.MD" />
          <label className="aurelia-field">
            <span>选择角色卡</span>
            <select
              aria-label="选择角色卡"
              value={skillLibrary?.activeId ?? ''}
              disabled={skillBusy || !skillLibrary}
              onChange={(event) => void changeSkillLibrary(() => selectCharacterSkill(event.target.value))}
            >
              {!skillLibrary ? <option value="">正在加载角色卡…</option> : null}
              {skillLibrary ? <option value="">不使用角色卡</option> : null}
              {skillLibrary?.cards.map((card) => (
                <option value={card.id} key={card.id}>
                  {card.config.displayName} · {card.fileName}
                  {card.id === 'builtin' ? '（内置）' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="aurelia-skill-summary">
            <strong>{characterSkill.config.displayName}</strong>
            <br />
            <span>{characterSkill.config.identity}</span>
            <small>
              {characterSkill.markdown.length.toLocaleString()} 字符 · {characterSkill.fileName}
            </small>
          </div>
          <p className="aurelia-copy">导入 Markdown 角色卡后可从列表切换，选择会同步到对话。</p>
          <div className="aurelia-setting-list">
            <SettingRow
              title="追加提示词"
              description="开启后在加载角色卡时追加到 LLM 系统提示"
              control={
                <Toggle
                  checked={promptSettings.enabled}
                  label="追加提示词"
                  onChange={(enabled) => setPromptSettings((current) => ({ ...current, enabled }))}
                />
              }
            />
          </div>
          <div className="aurelia-field aurelia-character-prompt-field">
            <div className="aurelia-character-prompt-heading">
              <label htmlFor="character-additional-prompt">提示词内容</label>
              <button
                type="button"
                onClick={() => setPromptSettings({ enabled: true, prompt: NATURAL_CONVERSATION_PROMPT })}
              >
                限制对话提示词
              </button>
            </div>
            <textarea
              id="character-additional-prompt"
              disabled={!promptSettings.enabled}
              maxLength={8_000}
              placeholder="例如：回答时保持更简短，并优先关注用户当前情绪。"
              rows={5}
              value={promptSettings.prompt}
              onChange={(event) => {
                const prompt = event.currentTarget.value;
                setPromptSettings((current) => ({ ...current, prompt }));
              }}
            />
          </div>
          <div className="aurelia-preview-actions">
            <button
              type="button"
              disabled={skillBusy || !skillLibrary}
              onClick={() => skillInputRef.current?.click()}
            >
              <Upload size={14} /> 导入角色卡
            </button>
            <button
              type="button"
              disabled={skillBusy || !skillLibrary || skillLibrary.activeId === 'builtin'}
              onClick={() =>
                setDeleteSkillTarget(skillLibrary!.cards.find((card) => card.id === skillLibrary!.activeId)!)
              }
            >
              <Trash2 size={14} /> 删除角色卡
            </button>
            <button
              type="button"
              onClick={() => downloadTextFile(characterSkill.fileName, characterSkill.markdown)}
            >
              <Download size={14} /> 导出 skills.md
            </button>
            <input
              ref={skillInputRef}
              hidden
              type="file"
              accept=".md,.markdown,text/markdown"
              onChange={(event) => void importSkill(event)}
            />
          </div>
          {skillMessage ? (
            <p className="aurelia-field-hint" role="alert">
              {skillMessage}
            </p>
          ) : null}
        </section>
        <CharacterLightingSettings renderConfig={renderConfig} setRenderConfig={setRenderConfig} />
        <CharacterFitSettings
          avatarFit={avatarFit}
          setAvatarFit={setAvatarFit}
          holdMicroMotionEnabled={holdMicroMotionEnabled}
          setHoldMicroMotionEnabled={setHoldMicroMotionEnabled}
          footIkEnabled={footIkEnabled}
          setFootIkEnabled={setFootIkEnabled}
        />
      </div>
      {deleteSkillTarget ? (
        <ConfirmModal
          title="删除角色卡？"
          description={`删除“${deleteSkillTarget.fileName}”后将切回内置角色卡。`}
          confirmLabel="删除"
          onCancel={() => setDeleteSkillTarget(null)}
          onConfirm={() => {
            const id = deleteSkillTarget.id;
            setDeleteSkillTarget(null);
            void changeSkillLibrary(() => deleteCharacterSkill(id));
          }}
        />
      ) : null}
      {deleteVrmTarget ? (
        <ConfirmModal
          title="删除导入的 VRM？"
          description={`将从本地资源库永久删除“${deleteVrmTarget.name}”。此操作无法撤销。`}
          confirmLabel="确认删除"
          onCancel={() => setDeleteVrmTarget(null)}
          onConfirm={() => void confirmDeleteVrm()}
        />
      ) : null}
    </div>
  );
}
