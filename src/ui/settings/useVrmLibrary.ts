import { useState, useRef, useEffect, useMemo, type ChangeEvent } from 'react';
import {
  type ImportedModelKind,
  type ImportedVrmRecord,
  listImportedVrms,
  importVrmFile,
  importModelBlob,
  deleteImportedVrm
} from '../../character/vrm/ImportedVrmStore';
import { createImportedModelUrl } from '../../character/vrm/importedModelUrl';
import { packFolderModels } from '../../character/mmd/mmdModelFolder';
import {
  vrmModelOptions,
  resolveVrmModelOption,
  type VrmModelOption
} from '../../character/vrm/assets/vrmModels';
import {
  loadVrmModelNames,
  resolveVrmModelName,
  saveVrmModelNames,
  setVrmModelName,
  type VrmModelNameOverrides
} from '../../character/vrm/vrmModelNames';
import { DESKTOP_MODEL_CACHE_ID } from '../../desktop/tauri/characterSettings';
import {
  VRM_MODEL_SELECTION_STORAGE_KEY,
  IMPORTED_VRM_SELECTION_STORAGE_KEY
} from '../../app/settings/storageKeys';
import { readStoredString } from '../../app/settings/browserStorage';

/**
 * One row of the model library: a bundled model or one the user imported.
 *
 * Both kinds share a shape on purpose — the panel lists them together and names
 * them the same way; they only differ in that an imported model can be deleted
 * and a bundled one cannot.
 */
export interface VrmLibraryModel {
  id: string;
  source: 'builtin' | 'imported';
  /** Alias when the user set one, the original label otherwise. */
  name: string;
  /** Never rewritten: the scanned label, or the imported file name. */
  fileName: string;
  url: string;
  size?: number;
  renamed: boolean;
  /** Absent for bundled rows; defaults to `'vrm'` for records written earlier. */
  kind?: ImportedModelKind;
}

/** Owns model selection, model names, and every preview URL created for this mounted library. */
export function useVrmLibrary() {
  const lifecycle = useRef({ disposed: false });
  const [modelId, setModelId] = useState(
    () => readStoredString(VRM_MODEL_SELECTION_STORAGE_KEY) || vrmModelOptions[0]?.id || 'main'
  );
  const [importedModels, setImportedModels] = useState<Array<ImportedVrmRecord & { url: string }>>([]);
  const [activeImportedId, setActiveImportedId] = useState<string | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelNames, setModelNames] = useState<VrmModelNameOverrides>(loadVrmModelNames);
  const [deleteVrmTarget, setDeleteVrmTarget] = useState<(ImportedVrmRecord & { url: string }) | null>(null);
  const [assetMessage, setAssetMessage] = useState('已导入的模型会保存在此浏览器中');
  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const modelFolderInputRef = useRef<HTMLInputElement | null>(null);
  /* Every preview URL made for this mounted library, so unmount can revoke them
     all — including the container registration behind an imported MMD folder. */
  const importedUrlsRef = useRef<Array<{ url: string; dispose(): void }>>([]);
  const selectedOption = resolveVrmModelOption(modelId);
  const selectedModel: VrmModelOption = useMemo(
    () => ({
      ...selectedOption,
      label: resolveVrmModelName(modelNames, selectedOption.id, selectedOption.label)
    }),
    [selectedOption, modelNames]
  );
  const activeImportedModel = importedModels.find((model) => model.id === activeImportedId) ?? null;
  const models: VrmLibraryModel[] = useMemo(
    () => [
      ...vrmModelOptions.map((model) => ({
        id: model.id,
        source: 'builtin' as const,
        name: resolveVrmModelName(modelNames, model.id, model.label),
        fileName: model.label,
        url: model.url,
        renamed: modelNames[model.id] !== undefined
      })),
      ...importedModels.map((model) => ({
        id: model.id,
        source: 'imported' as const,
        name: resolveVrmModelName(modelNames, model.id, model.name),
        fileName: model.name,
        url: model.url,
        size: model.size,
        renamed: modelNames[model.id] !== undefined,
        kind: model.kind ?? 'vrm'
      }))
    ],
    [modelNames, importedModels]
  );
  const activeLibraryId = activeImportedId ?? modelId;

  useEffect(() => {
    const owner = { disposed: false };
    lifecycle.current = owner;
    void listImportedVrms()
      .then((records) => {
        if (owner.disposed) return;
        // The desktop window caches its published model in this same store. That
        // row is an internal copy, not an import, so it must not appear as a model
        // the user can rename or delete — and its name is a lookup key there.
        const imported = records
          .filter((record) => record.id !== DESKTOP_MODEL_CACHE_ID)
          .map((record) => {
            const handle = createImportedModelUrl(record.blob);
            importedUrlsRef.current.push(handle);
            return { ...record, url: handle.url };
          });
        setImportedModels(imported);
        const savedId = localStorage.getItem(IMPORTED_VRM_SELECTION_STORAGE_KEY);
        if (savedId && imported.some((model) => model.id === savedId)) setActiveImportedId(savedId);
        setModelsLoaded(true);
      })
      .catch((error) => {
        if (owner.disposed) return;
        setAssetMessage(error instanceof Error ? error.message : '无法读取本地 VRM 资源库');
        setModelsLoaded(true);
      });
    return () => {
      owner.disposed = true;
      importedUrlsRef.current.forEach((handle) => handle.dispose());
      importedUrlsRef.current = [];
    };
  }, []);

  const applyModelNames = (next: VrmModelNameOverrides) => {
    setModelNames(next);
    saveVrmModelNames(next);
  };
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
  const selectLibraryModel = (libraryId: string) => {
    const model = models.find((item) => item.id === libraryId);
    if (!model) return;
    if (model.source === 'imported') selectImportedModel(model.id);
    else selectModel(model.id);
  };
  /**
   * Names either kind of model. The alias never touches the scanned file name or
   * the imported record, so "恢复原名" always works and the desktop window keeps
   * matching its cached model by the untouched name.
   */
  const renameModel = (id: string, name: string) => {
    const next = setVrmModelName(modelNames, id, name);
    applyModelNames(next);
    const applied = resolveVrmModelName(next, id, name);
    setAssetMessage(applied ? `已重命名为 ${applied}` : '已恢复原名');
  };
  const resetModelName = (libraryId: string) => {
    applyModelNames(setVrmModelName(modelNames, libraryId, ''));
    const model = models.find((item) => item.id === libraryId);
    if (model) setAssetMessage(`已恢复原名 ${model.fileName}`);
  };
  /** Gives freshly imported records their load URLs and makes the first one active. */
  const adoptImportedRecords = (records: readonly ImportedVrmRecord[]) => {
    const models = records.map((record) => {
      const handle = createImportedModelUrl(record.blob);
      importedUrlsRef.current.push(handle);
      return { ...record, url: handle.url };
    });
    setImportedModels((current) => [...models, ...current]);
    selectImportedModel(models[0].id);
  };
  const importModel = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    if (!files.length) return;
    const owner = lifecycle.current;
    try {
      const records = await Promise.all(files.map(importVrmFile));
      if (owner.disposed) return;
      adoptImportedRecords(records);
      setAssetMessage(`已导入 ${files.length} 个模型文件`);
    } catch (error) {
      if (!owner.disposed) setAssetMessage(error instanceof Error ? error.message : '模型导入失败');
    }
  };
  /**
   * Imports a picked model folder.
   *
   * `webkitRelativePath` is what makes this work at all: the browser hands every
   * file the path it had inside the folder the user picked, so the PMX sitting at
   * the top can be told apart from the textures below it — and those textures can
   * be stored under the very names the model's materials look them up by.
   */
  const importModelFolder = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    if (!files.length) return;
    const owner = lifecycle.current;
    setAssetMessage('正在读取模型文件夹…');
    try {
      // Packing reads and copies every texture, so it must not outlive the panel.
      const packed = await packFolderModels(files);
      if (owner.disposed) return;
      const records = await Promise.all(
        packed.map((model) => importModelBlob(model.name, model.blob, 'mmd'))
      );
      if (owner.disposed) return;
      adoptImportedRecords(records);
      setAssetMessage(
        packed.length === 1 ? `已导入 ${packed[0].name}` : `已从该文件夹导入 ${packed.length} 个模型`
      );
    } catch (error) {
      if (!owner.disposed)
        setAssetMessage(error instanceof Error ? error.message : '模型文件夹导入失败');
    }
  };
  const confirmDeleteVrm = async () => {
    if (!deleteVrmTarget) return;
    const owner = lifecycle.current;
    try {
      await deleteImportedVrm(deleteVrmTarget.id);
      if (owner.disposed) return;
      const handle = importedUrlsRef.current.find((item) => item.url === deleteVrmTarget.url);
      handle?.dispose();
      importedUrlsRef.current = importedUrlsRef.current.filter((item) => item !== handle);
      setImportedModels((current) => current.filter((model) => model.id !== deleteVrmTarget.id));
      // Drop the alias together with the model it named, or the map grows forever.
      applyModelNames(setVrmModelName(modelNames, deleteVrmTarget.id, ''));
      if (activeImportedId === deleteVrmTarget.id) {
        setActiveImportedId(null);
        localStorage.removeItem(IMPORTED_VRM_SELECTION_STORAGE_KEY);
      }
      setAssetMessage(`已删除 ${deleteVrmTarget.name}`);
      setDeleteVrmTarget(null);
    } catch (error) {
      if (!owner.disposed) setAssetMessage(error instanceof Error ? error.message : '模型删除失败');
    }
  };

  return {
    modelId,
    models,
    importedModels,
    activeImportedId,
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
    selectModel,
    selectImportedModel,
    selectLibraryModel,
    renameModel,
    resetModelName,
    importModel,
    importModelFolder,
    confirmDeleteVrm
  };
}
