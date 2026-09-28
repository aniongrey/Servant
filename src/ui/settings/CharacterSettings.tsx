import { useVrmLibrary, type VrmLibraryModel } from './useVrmLibrary';
import { AssetLibrary, ASSET_NAME_MAX_LENGTH } from './AssetLibrary';
import { CharacterFitSettings } from './CharacterFitSettings';
import { LightingDialog } from './LightingDialog';
import { backgroundSource, loadStageScene } from '../stage/stageScene';
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
import { useState, useRef, useEffect, useMemo, type ChangeEvent, useCallback } from 'react';

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
import { clampCameraZoom, DEFAULT_CAMERA_ZOOM } from '../../character/vrm/cameraZoom';
import { loadCharacterProfiles } from '../../character/characterProfiles';
import { Upload, Database, Trash2, Download, Boxes, FolderOpen } from 'lucide-react';

const NATURAL_CONVERSATION_PROMPT = '每次回复控制在一句话左右，约20字，不带动作描述。';

const MODEL_PREVIEW_ZOOMS_KEY = 'codex-list.characterPreviewZooms.v1';

function loadModelPreviewZoom(modelId: string): number {
  try {
    const saved = JSON.parse(localStorage.getItem(MODEL_PREVIEW_ZOOMS_KEY) ?? '{}');
    return typeof saved[modelId] === 'number'
      ? Math.min(6, Math.max(0.3, clampCameraZoom(saved[modelId])))
      : DEFAULT_CAMERA_ZOOM;
  } catch {
    return DEFAULT_CAMERA_ZOOM;
  }
}

function saveModelPreviewZoom(modelId: string, zoom: number): void {
  try {
    const saved = JSON.parse(localStorage.getItem(MODEL_PREVIEW_ZOOMS_KEY) ?? '{}');
    localStorage.setItem(MODEL_PREVIEW_ZOOMS_KEY, JSON.stringify({ ...saved, [modelId]: zoom }));
  } catch {
    localStorage.setItem(MODEL_PREVIEW_ZOOMS_KEY, JSON.stringify({ [modelId]: zoom }));
  }
}

/** Secondary line of a model row: where it comes from, and what it was called before. */
function describeLibraryModel(model: VrmLibraryModel): string {
  const parts = [
    model.source === 'builtin' ? '内置' : model.kind === 'mmd' ? '导入 · MMD 文件夹' : '导入'
  ];
  if (model.size !== undefined) parts.push(formatFileSize(model.size));
  if (model.renamed) parts.push(`原名 ${model.fileName}`);
  return parts.join(' · ');
}

export function CharacterSettings() {
  const {
    models,
    importedModels,
    activeLibraryId,
    modelsLoaded,
    deleteVrmTarget,
    setDeleteVrmTarget,
    assetMessage,
    setAssetMessage,
    modelInputRef,
    modelFolderInputRef,
    selectedModel,
    activeImportedModel,
    selectLibraryModel,
    renameModel,
    resetModelName,
    importModel,
    importModelFolder,
    confirmDeleteVrm
  } = useVrmLibrary();
  const [stageStatus, setStageStatus] = useState('正在准备角色预览…');
  const [avatarFit, setAvatarFit] = useState<AvatarFitConfig>(loadAvatarFitConfig);
  const [renderConfig, setRenderConfig] = useState<CharacterRenderConfig>(loadCharacterRenderConfig);
  const [lightingOpen, setLightingOpen] = useState(false);
  const [lightingZoom, setLightingZoom] = useState(2);
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
  const [profiles, setProfiles] = useState(loadCharacterProfiles);
  const [skillBusy, setSkillBusy] = useState(false);
  const [promptSettings, setPromptSettings] = useState<CharacterPromptSettings>(loadCharacterPromptSettings);
  const [deleteSkillTarget, setDeleteSkillTarget] = useState<(CharacterSkill & { id: string }) | null>(null);
  const skillInputRef = useRef<HTMLInputElement | null>(null);
  const desktopPublishReadyRef = useRef(false);
  const applySkillLibrary = (library: CharacterSkillLibrary) => {
    setSkillLibrary(library);
    setCharacterSkill(library.cards.find((card) => card.id === library.activeId) ?? emptyCharacterSkill);
  };

  useEffect(() => {
    const refreshProfiles = () => setProfiles(loadCharacterProfiles());
    window.addEventListener('servant:character-profiles-changed', refreshProfiles);
    return () => window.removeEventListener('servant:character-profiles-changed', refreshProfiles);
  }, []);

  const mainProfile = profiles.find((profile) => profile.isMain) ?? profiles[0];
  const mainModelId = mainProfile?.vrmId ?? 'main';
  const mainImportedModel = importedModels.find((model) => model.id === mainModelId) ?? null;
  const mainModel = models.find((model) => model.id === mainModelId);
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
          model: { id: mainImportedModel?.id ?? mainModel?.id ?? mainModelId },
          avatarFit,
          renderConfig,
          proportionConfig,
          holdMicroMotionEnabled,
          footIkEnabled
        },
        mainImportedModel,
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
    mainModelId,
    mainModel,
    mainImportedModel,
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
  const handlePreviewZoomChange = useCallback((zoom: number) => saveModelPreviewZoom(activeLibraryId, zoom), [activeLibraryId]);
  /* One searchable row per model — a bundled file and an imported one differ
     only in their icon, their secondary line, and whether they can be deleted. */
  const libraryItems = useMemo(
    () =>
      models.map((model) => ({
        id: model.id,
        name: model.name,
        meta: describeLibraryModel(model),
        keywords: model.fileName,
        active: model.id === activeLibraryId,
        renamed: model.renamed,
        removable: model.source === 'imported',
        icon: model.source === 'imported' ? <Database size={13} /> : <Boxes size={13} />
      })),
    [models, activeLibraryId]
  );
  const activeModelLabel = models.find((model) => model.id === activeLibraryId)?.name ?? selectedModel.label;
  const builtinCount = models.length - importedModels.length;

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
            initialZoom={loadModelPreviewZoom(activeLibraryId)}
            wheelZoomAnchorY={0}
            onZoomChange={handlePreviewZoomChange}
            onEngineReady={handleEngineReady}
            onStatus={handleStageStatus}
          />
          <div className="aurelia-avatar-overlay">
            <strong>{characterSkill.config.displayName}</strong>
            <span>{activeModelLabel}</span>
          </div>
        </div>
        <p className="aurelia-stage-status">{stageStatus}</p>
        <div className="aurelia-preview-actions">
          <button type="button" onClick={() => modelInputRef.current?.click()}>
            <Upload size={14} /> 导入VRM模型文件
          </button>
          <button type="button" onClick={() => modelFolderInputRef.current?.click()}>
            <FolderOpen size={14} /> 导入PMX模型文件夹
          </button>
          <input
            ref={modelInputRef}
            hidden
            multiple
            type="file"
            accept=".vrm,model/gltf-binary"
            onChange={(event) => void importModel(event)}
          />
          {/* `webkitdirectory` puts the whole folder in the FileList, each entry
              carrying the path it had inside it — which is the only reason the PMX
              can be found at the top and its textures under their real names. */}
          <input
            ref={modelFolderInputRef}
            hidden
            multiple
            type="file"
            onChange={(event) => void importModelFolder(event)}
            {...{ webkitdirectory: '', directory: '' }}
          />
        </div>
        <AssetLibrary
          editorFields={(model) => [
            {
              key: 'name',
              label: '模型名称',
              value: model.name,
              placeholder: model.keywords ?? model.name,
              maxLength: ASSET_NAME_MAX_LENGTH
            }
          ]}
          emptyText="暂无模型，点击“导入模型文件”或“导入模型文件夹”添加。"
          heading="模型库"
          items={libraryItems}
          onDelete={(id) => {
            const target = importedModels.find((item) => item.id === id);
            if (target) setDeleteVrmTarget(target);
          }}
          onEdit={(id, values) => renameModel(id, values.name)}
          onResetName={resetModelName}
          onSelect={selectLibraryModel}
          searchPlaceholder="搜索模型名称或文件名"
          summary={`内置 ${builtinCount} · 导入 ${importedModels.length}`}
        />
        <p className="aurelia-field-hint">{assetMessage}</p>
        <p className="aurelia-field-hint">
          MMD：点击“导入PMX模型文件夹”，选择存放 PMX / PMD 的文件夹（模型放在第一层，贴图可与模型同级或放在
          textures 子目录）。文件夹内的贴图会一并存入模型库。
        </p>
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
                自动填入
              </button>
            </div>
            <textarea
              id="character-additional-prompt"
              disabled={!promptSettings.enabled}
              maxLength={8_000}
              placeholder={NATURAL_CONVERSATION_PROMPT}
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
        <section className="aurelia-panel aurelia-character-panel-lighting">
          <PanelTitle title="灯光与外观" eyebrow="LIGHTING" />
          <p className="aurelia-field-hint">打开实时预览，调整主光、补光和角色材质。</p>
          <div className="aurelia-preview-actions"><button type="button" onClick={() => setLightingOpen(true)}>调整灯光…</button></div>
        </section>
        <CharacterFitSettings
          avatarFit={avatarFit}
          setAvatarFit={setAvatarFit}
          holdMicroMotionEnabled={holdMicroMotionEnabled}
          setHoldMicroMotionEnabled={setHoldMicroMotionEnabled}
          footIkEnabled={footIkEnabled}
          setFootIkEnabled={setFootIkEnabled}
        />
      </div>
      {lightingOpen && <LightingDialog value={renderConfig} previewBackground={backgroundSource(loadStageScene().background)} onApply={setRenderConfig} onClose={() => setLightingOpen(false)}
        preview={(config) => <VrmStage modelUrl={activeImportedModel?.url ?? selectedModel.url} avatarFitConfig={{ ...avatarFit, showGuide: false }}
          holdMicroMotionEnabled={holdMicroMotionEnabled} footIkEnabled={footIkEnabled} renderConfig={config}
          proportionConfig={proportionConfig} controlledZoom={lightingZoom} onZoomChange={setLightingZoom} onEngineReady={handleEngineReady} onStatus={handleStageStatus} />} />}
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
