import { describe, expect, it } from 'vitest';
import { unpackModelArchive } from '../vrm/modelArchive';
import { findFolderModels, packFolderModels, readMmdModelSource } from './mmdModelFolder';

/** A picked file, carrying the path it had inside the folder the user chose. */
function pickedFile(path: string, content = path): File {
  const file = new File([content], path.slice(path.lastIndexOf('/') + 1));
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

const folderFiles = () => [
  pickedFile('blue-fish-mmd/蓝色大肥鱼1.12.pmx', 'PMX-BYTES'),
  pickedFile('blue-fish-mmd/toon2.png', 'TOON'),
  pickedFile('blue-fish-mmd/textures/_01.png', 'TEX-01'),
  pickedFile('blue-fish-mmd/使用规约.txt', 'README')
];

async function textOf(value: unknown): Promise<string> {
  if (!(value instanceof Blob)) throw new Error('纹理未映射为可加载的 Blob');
  return value.text();
}

describe('findFolderModels', () => {
  it('takes the models sitting directly in the picked folder', () => {
    const files = [
      ...folderFiles(),
      pickedFile('blue-fish-mmd/sub/other.pmx', 'NESTED')
    ];
    expect(findFolderModels(files).map((file) => file.name)).toEqual(['蓝色大肥鱼1.12.pmx']);
  });

  it('accepts PMD too, whatever the case', () => {
    expect(findFolderModels([pickedFile('m/Model.PMD')])).toHaveLength(1);
  });

  it('finds nothing when every model is nested', () => {
    expect(findFolderModels([pickedFile('m/parts/other.pmx')])).toEqual([]);
  });
});

describe('importing a PMX folder', () => {
  it('names the record after the model file', async () => {
    const [packed] = await packFolderModels(folderFiles());
    expect(packed.name).toBe('蓝色大肥鱼1.12.pmx');
  });

  it('keeps the model bytes and drops files that are neither model nor texture', async () => {
    const [packed] = await packFolderModels(folderFiles());
    const entries = await unpackModelArchive(packed.blob);
    expect(entries.map((entry) => entry.path)).toEqual([
      '蓝色大肥鱼1.12.pmx',
      'toon2.png',
      'textures/_01.png'
    ]);
  });

  it('restores a source the loader can consume', async () => {
    const [packed] = await packFolderModels(folderFiles());
    const source = await readMmdModelSource(packed.blob);

    expect(new TextDecoder().decode(source.model)).toBe('PMX-BYTES');
    // Materials spell the same texture in any of these three shapes, so all of
    // them have to resolve or the model loads untextured.
    expect(await textOf(source.textures['textures/_01.png'])).toBe('TEX-01');
    expect(await textOf(source.textures['_01.png'])).toBe('TEX-01');
    expect(await textOf(source.textures['toon2.png'])).toBe('TOON');
  });

  it('reports a folder with no model at its top level', async () => {
    await expect(packFolderModels([pickedFile('m/textures/_01.png')])).rejects.toThrow('没有 PMX');
  });

  it('gives a sibling model its own record and its own copy of the textures', async () => {
    const packed = await packFolderModels([
      ...folderFiles(),
      pickedFile('blue-fish-mmd/second.pmx', 'SECOND')
    ]);

    // Two models in one folder are two records sharing one texture set. Look the
    // record up rather than assume a slot: order follows locale collation.
    expect(packed).toHaveLength(2);
    const second = packed.find((model) => model.name === 'second.pmx')!;
    const source = await readMmdModelSource(second.blob);
    expect(new TextDecoder().decode(source.model)).toBe('SECOND');
    expect(await textOf(source.textures['textures/_01.png'])).toBe('TEX-01');
  });
});
