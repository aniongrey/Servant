/**
 * Multi-file container for an imported MMD model folder.
 *
 * A PMX is only half of a model: the materials reference files sitting next to it
 * (`toon2.png`) and inside a `textures/` folder below it. The imported-model
 * store is built around one Blob per record — VRM is one file, so that was
 * enough — and a folder cannot be stored that way without either a second store
 * or a zip dependency. This packs the folder into a single Blob instead, so an
 * imported PMX is one record like everything else: it is content-addressed,
 * counted, renamed and deleted by the same code, and it is recognised by its
 * MIME type alone rather than by an extra field that could drift.
 *
 * Layout (little endian), written and read only by this module:
 *
 *   magic    'SRVA'         4 bytes
 *   version  u8             1 byte
 *   count    u32            4 bytes
 *   entries  count × { u16 pathLength, path (UTF-8), u32 byteLength, bytes }
 *
 * Paths are relative to the model folder and use `/` separators, so a container
 * stays portable between Windows and the POSIX-shaped paths the MMD loader
 * resolves textures against.
 */

/** Marks a Blob as a packed model folder. Also the record's storage marker. */
export const MODEL_ARCHIVE_MIME = 'application/x-servant-model-archive';

const MAGIC = 'SRVA';
const VERSION = 1;
const HEADER_BYTES = 9;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface ModelArchiveEntry {
  /** Path relative to the model folder, `/`-separated. */
  path: string;
  data: Uint8Array;
}

export function packModelArchive(entries: readonly ModelArchiveEntry[]): Blob {
  const paths = entries.map((entry) => encoder.encode(entry.path));
  const total = entries.reduce(
    (sum, entry, index) => sum + 2 + paths[index].byteLength + 4 + entry.data.byteLength,
    HEADER_BYTES
  );
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(encoder.encode(MAGIC), 0);
  view.setUint8(4, VERSION);
  view.setUint32(5, entries.length, true);

  let offset = HEADER_BYTES;
  entries.forEach((entry, index) => {
    view.setUint16(offset, paths[index].byteLength, true);
    offset += 2;
    bytes.set(paths[index], offset);
    offset += paths[index].byteLength;
    view.setUint32(offset, entry.data.byteLength, true);
    offset += 4;
    bytes.set(entry.data, offset);
    offset += entry.data.byteLength;
  });

  return new Blob([buffer], { type: MODEL_ARCHIVE_MIME });
}

export async function unpackModelArchive(blob: Blob): Promise<ModelArchiveEntry[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength < HEADER_BYTES) throw new Error('模型容器不完整');
  if (decoder.decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error('模型文件不是模型容器');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(4);
  if (version !== VERSION) throw new Error(`不支持的模型容器版本：${version}`);

  const count = view.getUint32(5, true);
  const entries: ModelArchiveEntry[] = [];
  let offset = HEADER_BYTES;
  for (let index = 0; index < count; index += 1) {
    if (offset + 2 > bytes.byteLength) throw new Error('模型容器已损坏');
    const pathLength = view.getUint16(offset, true);
    offset += 2;
    if (offset + pathLength + 4 > bytes.byteLength) throw new Error('模型容器已损坏');
    const path = decoder.decode(bytes.subarray(offset, offset + pathLength));
    offset += pathLength;
    const size = view.getUint32(offset, true);
    offset += 4;
    if (offset + size > bytes.byteLength) throw new Error('模型容器已损坏');
    // A view, not a copy: unpacking a 13 MiB folder twice per load would be pure waste.
    entries.push({ path, data: bytes.subarray(offset, offset + size) });
    offset += size;
  }
  return entries;
}

export function isModelArchive(blob: Blob): boolean {
  return blob.type === MODEL_ARCHIVE_MIME;
}

/** Bytes as a Blob the MMD loader accepts as a texture source. */
export function asTextureBlob(data: Uint8Array): Blob {
  return new Blob([data as BlobPart]);
}
