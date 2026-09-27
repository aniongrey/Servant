import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TTS_VOICE_LIBRARY_STORAGE_KEY } from '../../ai/tts/localVoiceLibrary';
import { TtsVoiceLibrary, buildVoiceEditorFields } from './TtsVoiceLibrary';

function stubStoredLibrary(value: unknown) {
  const values = new Map<string, string>();
  if (value !== undefined) values.set(TTS_VOICE_LIBRARY_STORAGE_KEY, JSON.stringify(value));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, item: string) => values.set(key, item),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    }
  } satisfies Storage);
}

function render(props: Partial<Parameters<typeof TtsVoiceLibrary>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(TtsVoiceLibrary, {
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      onApply: () => undefined,
      ...props
    })
  );
}

describe('TtsVoiceLibrary', () => {
  beforeEach(() => stubStoredLibrary(undefined));

  it('renders nothing for providers that have no voice to name', () => {
    expect(render({ provider: 'microsoft' })).toBe('');
    expect(render({ provider: 'none' })).toBe('');
  });

  it('offers to add a voice when the library is empty', () => {
    const markup = render();
    expect(markup).toContain('音色库');
    expect(markup).toContain('新增音色');
    expect(markup).toContain('这个模型下还没有保存的音色');
    // The scope of the list is spelled out, so switching models is not a mystery.
    expect(markup).toContain('OpenAI · gpt-4o-mini-tts');
    expect(markup).toContain('0 个 · gpt-4o-mini-tts');
  });

  it('lists the saved voices of the selected model and marks the one in use', () => {
    stubStoredLibrary([
      {
        id: 'voice-a',
        provider: 'openai',
        name: '夜读',
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        createdAt: 2,
        updatedAt: 2
      },
      {
        id: 'voice-b',
        provider: 'openai',
        name: '旁白',
        model: 'gpt-4o-mini-tts',
        voice: 'nova',
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'voice-other',
        provider: 'elevenlabs',
        name: '别人的音色',
        model: 'eleven_v3',
        voice: 'JBFqnCBsd6RMkjVDRZzb',
        createdAt: 3,
        updatedAt: 3
      }
    ]);
    const markup = render();
    expect(markup).toContain('夜读');
    expect(markup).toContain('旁白');
    // Another provider's entry is never mixed into this list.
    expect(markup).not.toContain('别人的音色');
    // The model is part of the scope, so it is not repeated on every row.
    expect(markup).toContain('alloy');
    expect(markup).not.toContain('gpt-4o-mini-tts · alloy');
    // `alloy` is what the draft config points at, so that row is the active one.
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('aria-label="重命名 夜读"');
    expect(markup).toContain('aria-label="删除 夜读"');
  });

  it('keeps the provider’s other models out of the list but says they are there', () => {
    stubStoredLibrary([
      {
        id: 'voice-mini',
        provider: 'openai',
        name: '当前模型',
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        createdAt: 2,
        updatedAt: 2
      },
      {
        id: 'voice-tts1',
        provider: 'openai',
        name: '旧模型',
        model: 'tts-1',
        voice: 'nova',
        createdAt: 1,
        updatedAt: 1
      }
    ]);
    const markup = render();
    expect(markup).toContain('当前模型');
    expect(markup).not.toContain('旧模型');
    expect(markup).toContain('另有 1 个音色属于该提供商的其他模型，切换模型后可见。');

    // Switching the model in the panel switches the list with it.
    const otherModel = render({ model: 'tts-1', voice: 'nova' });
    expect(otherModel).toContain('旧模型');
    expect(otherModel).not.toContain('当前模型');
    // …and now the model in use is found again.
    expect(otherModel).toContain('data-active="true"');
  });

  it('says so when the configured voice belongs to another model', () => {
    stubStoredLibrary([
      {
        id: 'voice-tts1',
        provider: 'openai',
        name: '旧模型音色',
        model: 'tts-1',
        voice: 'alloy',
        createdAt: 2,
        updatedAt: 2
      }
    ]);
    // `nova` is a valid preset but was never saved for the model now selected,
    // so nothing in the list is active — better to say that than to look broken.
    const markup = render({ model: 'tts-1', voice: 'nova' });
    expect(markup).toContain('当前配置的音色不在这个模型下');
    expect(markup).not.toContain('data-active="true"');
    // Picking one of the model's own voices makes the warning go away again.
    expect(render({ model: 'tts-1', voice: 'alloy' })).not.toContain('当前配置的音色不在这个模型下');
  });

  it('lists saved GPT-SoVITS roles, naming the role behind each id', () => {
    stubStoredLibrary([
      {
        id: 'role-a',
        provider: 'gpt-sovits',
        name: '白瓜',
        model: 'api_v2',
        voice: 'prof-1',
        createdAt: 2,
        updatedAt: 2
      },
      {
        id: 'role-gone',
        provider: 'gpt-sovits',
        name: '被删掉的角色',
        model: 'api_v2',
        voice: 'prof-gone',
        createdAt: 1,
        updatedAt: 1
      }
    ]);
    const markup = render({
      provider: 'gpt-sovits',
      model: 'api_v2',
      voice: 'prof-1',
      presets: [{ id: 'prof-1', name: '白瓜声线' }]
    });
    expect(markup).toContain('白瓜');
    // The role's own name backs the saved alias...
    expect(markup).toContain('白瓜声线');
    expect(markup).toContain('data-active="true"');
    // ...while a role the studio page deleted is reported, not hidden.
    expect(markup).toContain('prof-gone（角色未找到）');
    // Creating and deleting the role itself stays the studio page's job.
    expect(markup).toContain('角色本身在 GPT-SoVITS 配置页增删');
    expect(markup).toContain('搜索名称或角色');
  });

  it('asks for the current role before the role list has loaded', () => {
    const loading = render({ provider: 'gpt-sovits', model: 'api_v2', voice: 'prof-1', presets: [] });
    expect(loading).toContain('这个模型下还没有保存的角色音色');
    // A draft role is still worth saving while 9880 is unreachable.
    expect(loading).not.toMatch(/<button disabled[^>]*>.*新增音色/s);

    const nothingToSave = render({ provider: 'gpt-sovits', model: 'api_v2', voice: '', presets: [] });
    expect(nothingToSave).toMatch(/<button disabled[^>]*>.*新增音色/s);
  });
});

describe('buildVoiceEditorFields', () => {
  it('never asks for the model, since the panel above fixes it', () => {
    const fields = buildVoiceEditorFields({
      provider: 'openai',
      voice: 'nova',
      fallbackName: 'OpenAI · nova'
    });
    expect(fields.map((field) => field.key)).toEqual(['name', 'voice']);
    expect(fields[0]).toMatchObject({ label: '名称', value: 'OpenAI · nova' });
  });

  it('turns the voice field into a picker only when a free id could never apply', () => {
    // OpenAI has fixed voices and accepts nothing else, so a free-text field
    // could only ever save an id `normalizeSpeechSdkTtsProviderConfig` drops.
    const fixed = buildVoiceEditorFields({ provider: 'openai', voice: '', fallbackName: 'x' });
    expect(fixed[1].options?.map((option) => option.id)).toContain('alloy');
    expect(fixed[1].suggestions).toBeUndefined();

    // ElevenLabs takes private ids too, so the presets only suggest.
    const withPrivateIds = buildVoiceEditorFields({
      provider: 'elevenlabs',
      voice: '',
      fallbackName: 'x'
    });
    expect(withPrivateIds[1].suggestions?.map((option) => option.id)).toContain('JBFqnCBsd6RMkjVDRZzb');
    expect(withPrivateIds[1].options).toBeUndefined();
    expect(withPrivateIds[1].placeholder).toBe('ElevenLabs Voice ID');

    // A provider with no preset list at all is free text, with no suggestions.
    const bare = buildVoiceEditorFields({ provider: 'fish', voice: '', fallbackName: 'x' });
    expect(bare[1].suggestions).toEqual([]);
    expect(bare[1].options).toBeUndefined();
  });

  it('carries the value being edited even when the list no longer has it', () => {
    const stale = buildVoiceEditorFields({
      provider: 'openai',
      voice: '',
      fallbackName: 'x',
      entry: {
        id: 'e',
        provider: 'openai',
        name: 'x',
        model: 'gpt-4o-mini-tts',
        voice: 'hand-typed',
        createdAt: 1,
        updatedAt: 1
      }
    });
    expect(stale[1].value).toBe('hand-typed');
    expect(stale[1].options?.at(-1)).toEqual({ id: 'hand-typed', label: 'hand-typed' });
  });

  it('picks roles from the owner’s list and keeps a deleted one selectable', () => {
    const fields = buildVoiceEditorFields({
      provider: 'gpt-sovits',
      voice: 'prof-1',
      presets: [{ id: 'prof-1', name: '白瓜声线' }],
      fallbackName: '白瓜声线'
    });
    expect(fields[1]).toMatchObject({ label: '角色（音色）', value: 'prof-1' });
    expect(fields[1].options).toEqual([{ id: 'prof-1', label: '白瓜声线' }]);

    const stale = buildVoiceEditorFields({
      provider: 'gpt-sovits',
      voice: 'prof-gone',
      presets: [{ id: 'prof-1', name: '白瓜声线' }],
      entry: {
        id: 'e',
        provider: 'gpt-sovits',
        name: '旧角色',
        model: 'api_v2',
        voice: 'prof-gone',
        createdAt: 1,
        updatedAt: 1
      },
      fallbackName: '旧角色'
    });
    expect(stale[1].options?.at(-1)).toEqual({ id: 'prof-gone', label: 'prof-gone（角色未找到）' });
  });
});
