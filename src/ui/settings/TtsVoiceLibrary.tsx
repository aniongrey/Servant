import { useEffect, useMemo, useState } from 'react';
import { Plus, Volume2 } from 'lucide-react';

import {
  VOICE_NAME_MAX_LENGTH,
  describeSavedVoice,
  findActiveVoiceEntry,
  isVoiceLibraryProvider,
  listProviderVoices,
  suggestVoiceName,
  type ExternalVoicePreset,
  type LocalVoiceEntry,
  type LocalVoiceInput
} from '../../ai/tts/localVoiceLibrary';
import { getSpeechSdkProviderOption } from '../../ai/tts/speechSdkProviderOptions';
import type { SpeechSdkProviderId } from '../../ai/tts/speechSdkTypes';
import {
  AssetFieldEditor,
  AssetLibrary,
  type AssetEditorField,
  type AssetEditorOption,
  type AssetLibraryItem
} from './AssetLibrary';
import { ConfirmModal, PanelTitle } from './SettingsControls';
import { useLocalVoiceLibrary } from './useLocalVoiceLibrary';

/**
 * The voice library of the voice settings — the **only** place a voice is picked
 * for a remote provider.
 *
 * The provider panel above keeps the provider, the model and the API key; the
 * Voice ID lives here and nowhere else, because a voice is only meaningful
 * together with the model it was issued for. The list is therefore scoped twice:
 * by provider (an id means nothing outside the provider that issued it) and by
 * the model the page is currently on, so switching the model switches which
 * saved voices are on offer. Entries belonging to the provider's other models
 * are reported rather than shown, so nothing looks deleted.
 *
 * A provider whose voices are owned elsewhere passes `presets` (GPT-SoVITS role
 * presets). The rows then show the preset's own name and the editor picks from a
 * list instead of asking for an id. Saved roles are added automatically;
 * creating or deleting the preset itself stays the owner's job.
 */
export function TtsVoiceLibrary({
  provider,
  model,
  voice,
  presets,
  rolesReady,
  onApply
}: {
  provider: SpeechSdkProviderId;
  model: string;
  voice: string;
  /**
   * Pass the provider's external voices — `[]` while they are still loading —
   * when the voice ids name things this library only references. Omitting it
   * keeps the free-text Voice ID behaviour.
   */
  presets?: readonly ExternalVoicePreset[];
  rolesReady?: boolean;
  /** Writes a saved entry into the draft config; "应用配置" still commits it. */
  onApply(entry: Pick<LocalVoiceEntry, 'name' | 'model' | 'voice'>): void;
}) {
  const { entries, saveEntry, removeEntry } = useLocalVoiceLibrary(rolesReady ? presets : undefined);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LocalVoiceEntry | null>(null);
  // A form opened for one provider or model must not be saved under the next one.
  useEffect(() => {
    setAdding(false);
  }, [provider, model]);

  const providerOption = getSpeechSdkProviderOption(provider);
  const providerEntries = listProviderVoices(entries, provider, model);
  // Saved under the same provider but another model — kept out of the list on
  // purpose, so the user is told they exist instead of assuming they were lost.
  const otherModelCount = presets
    ? 0
    : entries.filter((entry) => entry.provider === provider && entry.model !== model.trim()).length;
  const entryById = useMemo(
    () => new Map(providerEntries.map((entry) => [entry.id, entry])),
    [providerEntries]
  );
  const activeEntry = findActiveVoiceEntry(providerEntries, { provider, model, voice });
  // The model can be switched in the panel above without the stored voice being
  // any the new model knows about, which would otherwise look like "a voice is
  // configured" next to a list where nothing is selected.
  const voiceMismatch = Boolean(voice.trim()) && providerEntries.length > 0 && !activeEntry;
  const items: AssetLibraryItem[] = providerEntries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    meta: describeSavedVoice(entry, presets),
    // The id stays searchable even when the row shows a friendlier label.
    keywords: `${entry.voice} ${entry.model}`,
    active: entry.id === activeEntry?.id,
    icon: <Volume2 size={13} />
  }));
  const entryFields = (fallbackName: string, entry?: LocalVoiceEntry): AssetEditorField[] =>
    buildVoiceEditorFields({ provider, voice, presets, entry, fallbackName });
  /** What the editor collected, completed with what the form does not show. */
  const toInput = (values: Record<string, string>, base?: LocalVoiceEntry): LocalVoiceInput => {
    const input: LocalVoiceInput = {
      provider,
      name: values.name ?? '',
      // The model comes from the panel, never from the form.
      model: base?.model ?? model,
      voice: values.voice ?? base?.voice ?? ''
    };
    if (base) input.id = base.id;
    return input;
  };

  // Providers whose voice is not picked here keep their own management surface
  // (`none`, local Microsoft) or have no voice at all to name.
  if (!isVoiceLibraryProvider(provider)) return null;

  // Saving the current voice needs one to save: with external presets an empty
  // list means the roles are not loaded yet, not that there is nothing to pick.
  const canSave = !presets || presets.length > 0 || Boolean(voice.trim());
  const scopeHint = `${providerOption.label} · ${model.trim() || '全部模型'}`;

  return (
    <section className="aurelia-panel aurelia-panel-wide">
      <PanelTitle title="音色库" eyebrow="VOICES" />
      <div className="aurelia-preview-actions">
        <button disabled={adding || !canSave} onClick={() => setAdding(true)} type="button">
          <Plus size={14} /> 新增音色
        </button>
      </div>
      <p className="aurelia-field-hint">
        {`${scopeHint} · 保存在本机浏览器，按提供商与模型分别列出；点列表项写回上面的配置，再点“应用配置”生效${
          presets ? '；已保存角色自动加入，失效条目自动清理，角色本身在 GPT-SoVITS 配置页增删' : ''
        }`}
      </p>
      {otherModelCount > 0 ? (
        <p className="aurelia-field-hint">
          另有 {otherModelCount} 个音色属于该提供商的其他模型，切换模型后可见。
        </p>
      ) : null}
      {voiceMismatch ? (
        <p className="aurelia-field-hint">当前配置的音色不在这个模型下，从列表里选一个或新增。</p>
      ) : null}
      {adding ? (
        <div className="aurelia-asset-editor aurelia-asset-editor-standalone">
          <AssetFieldEditor
            fields={entryFields(suggestVoiceName(provider, voice, presets))}
            onCancel={() => setAdding(false)}
            onSave={(values) => {
              const input = toInput(values);
              saveEntry(input);
              // Saving a voice here *is* picking it — the panel above no longer
              // has a voice field, so leaving the new entry unselected would just
              // be a state the user has to fix by clicking the row they created.
              onApply({ name: input.name, model: input.model, voice: input.voice });
              setAdding(false);
            }}
            saveLabel="添加"
          />
        </div>
      ) : null}
      <AssetLibrary
        editorFields={(item) => entryFields(item.name, entryById.get(item.id))}
        emptyText={
          presets
            ? '这个模型下还没有保存的角色音色，点“新增音色”把当前角色加入列表。'
            : '这个模型下还没有保存的音色，点“新增音色”填一个 Voice ID。'
        }
        heading="已保存音色"
        items={items}
        onDelete={(id) => {
          const entry = entryById.get(id);
          if (entry) setDeleteTarget(entry);
        }}
        onEdit={(id, values) => saveEntry(toInput(values, entryById.get(id)))}
        onSelect={(id) => {
          const entry = entryById.get(id);
          if (entry) onApply(entry);
        }}
        searchPlaceholder={presets ? '搜索名称或角色' : '搜索名称或音色 ID'}
        summary={`${providerEntries.length} 个 · ${model.trim() || '全部模型'}`}
      />
      {deleteTarget ? (
        <ConfirmModal
          confirmLabel="确认删除"
          description={
            presets
              ? `将从本机音色库删除“${deleteTarget.name}”。GPT-SoVITS 的角色本身不受影响。`
              : `将从本机音色库删除“${deleteTarget.name}”。语音配置本身不受影响。`
          }
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            removeEntry(deleteTarget.id);
            setDeleteTarget(null);
          }}
          title="删除保存的音色？"
        />
      ) : null}
    </section>
  );
}

/**
 * The fields of the entry editor, decided by who owns the voice.
 *
 * There is deliberately no model field: the panel above fixes the model, and the
 * list is scoped to it, so an entry can only ever belong to the model the user
 * is looking at. What the voice field becomes is the part that differs:
 *
 * - **external presets** (GPT-SoVITS roles) — a picker, because the id names a
 *   thing the user cannot invent;
 * - **a provider with only fixed voices** — also a picker, because
 *   `normalizeSpeechSdkTtsProviderConfig` would replace anything else with the
 *   provider default, so a free-text field could save a voice that never applies;
 * - **anything else** — free text with the provider's presets as autocomplete,
 *   which is what a private Voice ID needs.
 *
 * A picker always carries the value it is seeded with, even when the caller's
 * list no longer contains it — otherwise the `<select>` would jump to its first
 * option and saving would silently switch voices.
 */
export function buildVoiceEditorFields({
  provider,
  voice,
  presets,
  entry,
  fallbackName
}: {
  provider: SpeechSdkProviderId;
  /** The draft config's voice, seeding a new entry's voice field. */
  voice: string;
  /** See {@link TtsVoiceLibrary.presets}. */
  presets?: readonly ExternalVoicePreset[];
  /** The entry being edited; omitted when adding a new one. */
  entry?: LocalVoiceEntry;
  /** Name to seed a new entry with. */
  fallbackName: string;
}): AssetEditorField[] {
  const fields: AssetEditorField[] = [
    {
      key: 'name',
      label: '名称',
      value: entry?.name ?? fallbackName,
      maxLength: VOICE_NAME_MAX_LENGTH
    }
  ];
  if (presets) {
    // The role *is* the voice here, so there is no id to type. A saved entry
    // whose role the owner deleted keeps its value as an extra option instead of
    // jumping to another role.
    fields.push({
      key: 'voice',
      label: '角色（音色）',
      value: entry?.voice ?? (voice.trim() || presets[0]?.id || ''),
      options: withCurrent(
        presets.map((preset) => ({ id: preset.id, label: preset.name })),
        entry?.voice,
        '角色未找到'
      )
    });
    return fields;
  }
  const providerOption = getSpeechSdkProviderOption(provider);
  const presetVoices: AssetEditorOption[] = providerOption.voices.map((option) => ({
    id: option.id,
    label: option.label
  }));
  const editable = providerOption.customVoice === true || presetVoices.length === 0;
  fields.push({
    key: 'voice',
    label: '音色',
    value: entry?.voice ?? '',
    placeholder: providerOption.voiceHint || providerOption.defaultVoice || presetVoices[0]?.label,
    ...(editable ? { suggestions: presetVoices } : { options: withCurrent(presetVoices, entry?.voice) })
  });
  return fields;
}

/**
 * Appends the value a picker is on when the caller's list does not contain it —
 * a hand-edited entry, or a preset the owner has since removed.
 */
function withCurrent(
  options: readonly AssetEditorOption[],
  current: string | undefined,
  suffix = ''
): AssetEditorOption[] {
  const value = current?.trim();
  if (!value || options.some((option) => option.id === value)) return [...options];
  return [...options, { id: value, label: suffix ? `${value}（${suffix}）` : value }];
}
