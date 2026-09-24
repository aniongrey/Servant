const DATABASE_NAME = 'codex-list-character-assets';
const STORE_NAME = 'imported-vrms';
const DATABASE_VERSION = 1;

export interface ImportedVrmRecord {
  id: string;
  name: string;
  size: number;
  createdAt: number;
  blob: Blob;
}

export async function listImportedVrms(): Promise<ImportedVrmRecord[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () =>
      resolve(
        (request.result as ImportedVrmRecord[]).sort((left, right) => right.createdAt - left.createdAt)
      );
    request.onerror = () => reject(request.error ?? new Error('无法读取已导入的 VRM。'));
    transaction.oncomplete = () => database.close();
  });
}

export async function importVrmFile(file: File): Promise<ImportedVrmRecord> {
  const record: ImportedVrmRecord = {
    id: `vrm-${Date.now()}-${crypto.randomUUID()}`,
    name: file.name,
    size: file.size,
    createdAt: Date.now(),
    blob: file
  };
  await saveImportedVrm(record);
  return record;
}

export async function saveImportedVrm(record: ImportedVrmRecord): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('VRM 导入失败。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('VRM 导入已中止。'));
  });
  database.close();
}

export async function deleteImportedVrm(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('无法删除 VRM。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('VRM 删除已中止。'));
  });
  database.close();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地 VRM 资源库。'));
  });
}
