import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createDefaultPersonalityState } from '../../ai/personality/PersonalitySystem';
import { type PersonalityState } from '../../ai/llm/types';
import {
  CHARACTER_SKILL_UPDATED_EVENT,
  CHARACTER_SKILL_SELECTION_KEY,
  CHARACTER_PROMPT_SETTINGS_KEY,
  CHARACTER_PROMPT_SETTINGS_UPDATED_EVENT,
  applyCharacterPromptSettings,
  loadCharacterPromptSettings,
  loadCharacterSkill,
  importCharacterSkill,
  type CharacterSkill
} from '../../ai/personality/CharacterSkill';
import { loadingPersonalityConfig, savePersonalityState, loadPersonalityState } from './chatStorage';

export function useChatIdentity(setError: (message: string) => void) {
  const [personality, setPersonality] = useState<PersonalityState>(() =>
    createDefaultPersonalityState(loadingPersonalityConfig)
  );

  const [characterSkill, setCharacterSkill] = useState<CharacterSkill | null>(null);
  const [promptSettings, setPromptSettings] = useState(loadCharacterPromptSettings);

  const [skillMessage, setSkillMessage] = useState('');

  /**
   * Failure to read the active card, kept apart from the shared chat error so
   * the panel can tell "still loading" from "will never load". Conflating them
   * left the chat page on its loading placeholder forever with the real cause
   * only in the console.
   */
  const [characterSkillError, setCharacterSkillError] = useState('');

  const skillInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Loading the character card must not overwrite the saved personality with placeholder state.
    if (characterSkill) savePersonalityState(personality);
  }, [characterSkill, personality]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCharacterSkill(controller.signal)
      .then((skill) => {
        if (controller.signal.aborted) return;
        setCharacterSkill(skill);
        setPersonality(loadPersonalityState(skill.config));
        setCharacterSkillError('');
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        const message = cause instanceof Error ? cause.message : '角色卡读取失败。';
        setCharacterSkillError(message);
        setError(message);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const handleSkillUpdate = (event: Event) => {
      const skill = (event as CustomEvent<CharacterSkill>).detail;
      if (skill) {
        setCharacterSkill(skill);
        setPersonality(loadPersonalityState(skill.config));
      }
    };
    const controller = new AbortController();
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CHARACTER_SKILL_SELECTION_KEY) return;
      void loadCharacterSkill(controller.signal)
        .then((skill) => {
          if (controller.signal.aborted) return;
          setCharacterSkill(skill);
          setPersonality(loadPersonalityState(skill.config));
          setCharacterSkillError('');
        })
        .catch((cause) => {
          if (controller.signal.aborted) return;
          const message = cause instanceof Error ? cause.message : '角色卡切换失败';
          setCharacterSkillError(message);
          setError(message);
        });
    };
    window.addEventListener(CHARACTER_SKILL_UPDATED_EVENT, handleSkillUpdate);
    window.addEventListener('storage', onStorage);
    return () => {
      controller.abort();
      window.removeEventListener(CHARACTER_SKILL_UPDATED_EVENT, handleSkillUpdate);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setPromptSettings(loadCharacterPromptSettings());
    const onStorage = (event: StorageEvent) => {
      if (event.key === CHARACTER_PROMPT_SETTINGS_KEY) refresh();
    };
    globalThis.addEventListener(CHARACTER_PROMPT_SETTINGS_UPDATED_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      globalThis.removeEventListener(CHARACTER_PROMPT_SETTINGS_UPDATED_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const configuredCharacterSkill = useMemo(
    () => (characterSkill ? applyCharacterPromptSettings(characterSkill, promptSettings) : null),
    [characterSkill, promptSettings]
  );

  const resetPersonality = () => {
    if (characterSkill) setPersonality(createDefaultPersonalityState(characterSkill.config));
  };

  const importCharacterCard = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const skill = await importCharacterSkill(await file.text(), file.name);
      setCharacterSkill(skill);
      setPersonality(createDefaultPersonalityState(skill.config));
      setSkillMessage(`已导入角色卡：${file.name}`);
    } catch (cause) {
      setSkillMessage(cause instanceof Error ? cause.message : '角色卡导入失败。');
    }
  };
  return {
    personality,
    setPersonality,
    characterSkill: configuredCharacterSkill,
    characterSkillError,
    skillMessage,
    skillInputRef,
    resetPersonality,
    importCharacterCard
  };
}
