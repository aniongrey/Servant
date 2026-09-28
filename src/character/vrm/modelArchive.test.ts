import { describe, expect, it } from 'vitest';
import {
  MODEL_ARCHIVE_MIME,
  isModelArchive,
  packModelArchive,
  unpackModelArchive
} from './modelArchive';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('model archive', () => {
  it('round-trips a folder with its paths and bytes intact', async () => {
    const blob = packModelArchive([
      { path: '蓝色大肥鱼1.12.pmx', data: bytes('model') },
      { path: 'textures/_01.png', data: bytes('texture') },
      { path: 'toon2.png', data: bytes('toon') }
    ]);

    expect(blob.type).toBe(MODEL_ARCHIVE_MIME);
    const entries = await unpackModelArchive(blob);
    expect(entries.map((entry) => entry.path)).toEqual([
      '蓝色大肥鱼1.12.pmx',
      'textures/_01.png',
      'toon2.png'
    ]);
    expect(new TextDecoder().decode(entries[1].data)).toBe('texture');
  });

  it('keeps binary content byte-exact, including zero bytes', async () => {
    const data = new Uint8Array([0, 1, 2, 0xff, 0xfe, 0x80, 0]);
    const entries = await unpackModelArchive(packModelArchive([{ path: 'a.pmx', data }]));
    expect([...entries[0].data]).toEqual([...data]);
  });

  it('rejects a blob that is not an archive', async () => {
    await expect(unpackModelArchive(new Blob([bytes('glTF_version2')]))).rejects.toThrow('不是模型容器');
  });

  it('rejects a truncated archive rather than reading past the end', async () => {
    const blob = packModelArchive([{ path: 'a.pmx', data: bytes('model') }]);
    await expect(unpackModelArchive(blob.slice(0, blob.size - 2))).rejects.toThrow('已损坏');
  });

  it('does not mistake an ordinary model file for an archive', () => {
    expect(isModelArchive(new Blob([bytes('glTF')], { type: 'model/gltf-binary' }))).toBe(false);
    expect(isModelArchive(new Blob([bytes('PMX ')], { type: '' }))).toBe(false);
  });
});
