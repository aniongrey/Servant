import { useState, useRef, useEffect, type ChangeEvent } from 'react';
import {
  type ImportedVrmRecord,
  listImportedVrms,
  importVrmFile,
  deleteImportedVrm
} from '../../character/vrm/ImportedVrmStore';
import { vrmModelOptions, resolveVrmModelOption } from '../../character/vrm/assets/vrmModels';
import {
  VRM_MODEL_SELECTION_STORAGE_KEY,
  IMPORTED_VRM_SELECTION_STORAGE_KEY
} from '../../app/settings/storageKeys';
import { readStoredString } from '../../app/settings/browserStorage';

/** Owns imported-model selection and every preview URL created for this mounted library. */
export function useVrmLibrary() {
  const lifecycle = useRef({ disposed: false });
  const [modelId, setModelId] = useState(
    () => readStoredString(VRM_MODEL_SELECTION_STORAGE_KEY) || vrmModelOptions[0]?.id || 'main'
  );
  const [importedModels, setImportedModels] = useState<Array<ImportedVrmRecord & { url: string }>>([]);
  const [activeImportedId, setActiveImportedId] = useState<string | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [deleteVrmTarget, setDeleteVrmTarget] = useState<(ImportedVrmRecord & { url: string }) | null>(null);
  const [assetMessage, setAssetMessage] = useState('已导入的 VRM 会保存在此浏览器中');
  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const importedModelUrlsRef = useRef<string[]>([]);
  const selectedModel = resolveVrmModelOption(modelId);
  const activeImportedModel = importedModels.find((model) => model.id === activeImportedId) ?? null;

  useEffect(() => {
    const owner = { disposed: false };
    lifecycle.current = owner;
    void listImportedVrms()
      .then((records) => {
        if (owner.disposed) return;
        const models = records.map((record) => ({ ...record, url: URL.createObjectURL(record.blob) }));
        importedModelUrlsRef.current = models.map((model) => model.url);
        setImportedModels(models);
        const savedId = localStorage.getItem(IMPORTED_VRM_SELECTION_STORAGE_KEY);
        if (savedId && models.some((model) => model.id === savedId)) setActiveImportedId(savedId);
        setModelsLoaded(true);
      })
      .catch((error) => {
        if (owner.disposed) return;
        setAssetMessage(error instanceof Error ? error.message : '无法读取本地 VRM 资源库');
        setModelsLoaded(true);
      });
    return () => {
      owner.disposed = true;
      importedModelUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      importedModelUrlsRef.current = [];
    };
  }, []);

  const selectModel = (nextId: string) => {
    setActiveImportedId(null);
    localStorage.removeItem(IMPORTED_VRM_SELECTION_STORAGE_KEY);
    setModelId(nextId);
    localStorage.setItem(VRM_MODEL_SELECTION_STORAGE_KEY, nextId);
  };
  const selectImportedModel = (id: string) => {
    setActiveImportedId(id);
    localStorage.setItem(IMPORTED_VRM_SELECTION_STORAGE_KEY, id);
  };
  const importModel = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    if (!files.length) return;
    const owner = lifecycle.current;
    try {
      const records = await Promise.all(files.map(importVrmFile));
      if (owner.disposed) return;
      const models = records.map((record) => ({ ...record, url: URL.createObjectURL(record.blob) }));
      importedModelUrlsRef.current.push(...models.map((model) => model.url));
      setImportedModels((current) => [...models, ...current]);
      selectImportedModel(models[0].id);
      setAssetMessage(`已导入 ${files.length} 个 VRM`);
    } catch (error) {
      if (!owner.disposed) setAssetMessage(error instanceof Error ? error.message : 'VRM 导入失败');
    }
  };
  const confirmDeleteVrm = async () => {
    if (!deleteVrmTarget) return;
    const owner = lifecycle.current;
    try {
      await deleteImportedVrm(deleteVrmTarget.id);
      if (owner.disposed) return;
      URL.revokeObjectURL(deleteVrmTarget.url);
      importedModelUrlsRef.current = importedModelUrlsRef.current.filter(
        (url) => url !== deleteVrmTarget.url
      );
      setImportedModels((current) => current.filter((model) => model.id !== deleteVrmTarget.id));
      if (activeImportedId === deleteVrmTarget.id) {
        setActiveImportedId(null);
        localStorage.removeItem(IMPORTED_VRM_SELECTION_STORAGE_KEY);
      }
      setAssetMessage(`已删除 ${deleteVrmTarget.name}`);
      setDeleteVrmTarget(null);
    } catch (error) {
      if (!owner.disposed) setAssetMessage(error instanceof Error ? error.message : 'VRM 删除失败');
    }
  };

  return {
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
  };
}
