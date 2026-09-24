import { downloadJsonFile } from '../../app/utils/downloadFile';
import {
  loadCharacterRenderConfig,
  saveCharacterRenderConfig
} from '../../character/vrm/characterRenderSettings';
import { loadAvatarFitConfig, saveAvatarFitConfig } from '../../character/ik/avatarFitSettings';
import { useState, useMemo, useEffect } from 'react';
import {
  loadVrmModelSelection,
  loadCharacterRenderPanelOpen,
  loadAvatarFitPanelOpen,
  saveCharacterRenderPanelOpen,
  saveAvatarFitPanelOpen,
  saveVrmModelSelection
} from './debugSettings';
import { type AgentRuntime } from '../../ai/AgentRuntime';
import { resolveVrmModelOption } from '../../character/vrm/assets/vrmModels';
import { type AvatarFitNumberKey } from './debugConfig';
import {
  loadHoldMicroMotionEnabled,
  loadFootIkEnabled,
  saveHoldMicroMotionEnabled,
  saveFootIkEnabled
} from './motionDebug';
import {
  type CharacterRenderConfig,
  defaultCharacterRenderConfig
} from '../../character/vrm/CharacterRenderConfig';
import {
  type AvatarFitConfig,
  type RotationOffsetConfig,
  type AvatarHeadColliderConfig,
  type AvatarTorsoColliderConfig,
  type AvatarHandIkRule
} from '../../character/ik/AvatarFitConfig';

export function useDebugCharacterSettings(engine: AgentRuntime) {
  const initialVrmModelId = useMemo(loadVrmModelSelection, []);

  const [selectedVrmModelId, setSelectedVrmModelId] = useState(initialVrmModelId);

  const selectedVrmModel = useMemo(() => resolveVrmModelOption(selectedVrmModelId), [selectedVrmModelId]);

  const [renderConfig, setRenderConfig] = useState<CharacterRenderConfig>(loadCharacterRenderConfig);

  const [renderPanelOpen, setRenderPanelOpen] = useState(loadCharacterRenderPanelOpen);

  const initialAvatarFitConfig = useMemo(loadAvatarFitConfig, []);

  const [avatarFitConfig, setAvatarFitConfig] = useState<AvatarFitConfig>(initialAvatarFitConfig);

  const [holdMicroMotionEnabled, setHoldMicroMotionEnabled] = useState(loadHoldMicroMotionEnabled);

  const [footIkEnabled, setFootIkEnabled] = useState(loadFootIkEnabled);

  const [avatarFitPanelOpen, setAvatarFitPanelOpen] = useState(loadAvatarFitPanelOpen);

  const frontPushMinHeight = avatarFitConfig.handIk.frontPushMinHeight;

  useEffect(() => {
    saveCharacterRenderConfig(renderConfig);
  }, [renderConfig]);

  useEffect(() => {
    saveCharacterRenderPanelOpen(renderPanelOpen);
  }, [renderPanelOpen]);

  useEffect(() => {
    saveAvatarFitConfig(avatarFitConfig);
    engine.registry.clearCache();
  }, [avatarFitConfig, engine]);

  useEffect(() => {
    saveAvatarFitPanelOpen(avatarFitPanelOpen);
  }, [avatarFitPanelOpen]);

  useEffect(() => {
    saveVrmModelSelection(selectedVrmModel.id);
  }, [selectedVrmModel.id]);

  useEffect(() => {
    saveHoldMicroMotionEnabled(holdMicroMotionEnabled);
  }, [holdMicroMotionEnabled]);

  useEffect(() => {
    saveFootIkEnabled(footIkEnabled);
  }, [footIkEnabled]);

  const updateRenderConfig = <Key extends keyof CharacterRenderConfig>(
    key: Key,
    value: CharacterRenderConfig[Key]
  ) => {
    setRenderConfig((current) => ({
      ...current,
      [key]: value
    }));
  };

  const resetRenderConfig = () => {
    setRenderConfig(defaultCharacterRenderConfig);
  };

  const downloadLightingConfig = () => {
    downloadJsonFile('lighting-config.json', {
      schemaVersion: 1,
      lighting: renderConfig
    });
  };

  const updateAvatarFitNumber = (key: AvatarFitNumberKey, value: number) => {
    setAvatarFitConfig((current) => ({
      ...current,
      [key]: value
    }));
  };

  const updateAvatarFitBoolean = (key: keyof Pick<AvatarFitConfig, 'showGuide'>, value: boolean) => {
    setAvatarFitConfig((current) => ({
      ...current,
      [key]: value
    }));
  };

  const updateWristRotationOffset = (key: keyof RotationOffsetConfig, value: number) => {
    setAvatarFitConfig((current) => ({
      ...current,
      wristRotationOffset: {
        ...current.wristRotationOffset,
        [key]: value
      }
    }));
  };

  const updateHeadCollider = (key: keyof AvatarHeadColliderConfig, value: number) => {
    setAvatarFitConfig((current) => ({
      ...current,
      colliders: {
        ...current.colliders,
        head: {
          ...current.colliders.head,
          [key]: value
        }
      }
    }));
  };

  const updateTorsoCollider = (key: keyof AvatarTorsoColliderConfig, value: number) => {
    setAvatarFitConfig((current) => ({
      ...current,
      colliders: {
        ...current.colliders,
        torso: {
          ...current.colliders.torso,
          [key]: value
        }
      }
    }));
  };

  const updateHandIkRule = <Key extends keyof AvatarHandIkRule>(key: Key, value: AvatarHandIkRule[Key]) => {
    setAvatarFitConfig((current) => ({
      ...current,
      handIk: {
        ...current.handIk,
        [key]: value
      }
    }));
  };

  const resetAvatarFitConfig = () => {
    setAvatarFitConfig(initialAvatarFitConfig);
  };

  const downloadAvatarFitConfig = () => {
    downloadJsonFile('avatar-fit-config.json', {
      schemaVersion: 1,
      model: {
        id: selectedVrmModel.id,
        url: selectedVrmModel.url
      },
      avatarFit: avatarFitConfig
    });
  };

  return {
    setSelectedVrmModelId,
    selectedVrmModel,
    renderConfig,
    renderPanelOpen,
    setRenderPanelOpen,
    avatarFitConfig,
    holdMicroMotionEnabled,
    setHoldMicroMotionEnabled,
    footIkEnabled,
    setFootIkEnabled,
    avatarFitPanelOpen,
    setAvatarFitPanelOpen,
    frontPushMinHeight,
    updateRenderConfig,
    resetRenderConfig,
    downloadLightingConfig,
    updateAvatarFitNumber,
    updateAvatarFitBoolean,
    updateWristRotationOffset,
    updateHeadCollider,
    updateTorsoCollider,
    updateHandIkRule,
    resetAvatarFitConfig,
    downloadAvatarFitConfig
  };
}

export type DebugCharacterSettings = ReturnType<typeof useDebugCharacterSettings>;
