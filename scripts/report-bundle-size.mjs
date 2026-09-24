#!/usr/bin/env node
/**
 * Explains where the ~700 MB build comes from.
 *
 * A Tauri build embeds `frontendDist` into the executable, so every byte under
 * `dist/` is paid for twice: once in `shiro-desktop.exe`, and again inside the
 * compressed MSI/NSIS installer. On a project this size the interesting question
 * is never "is it big" but "which bytes are duplicated", and that is what this
 * prints — with the numbers, so a change can be judged instead of guessed.
 *
 * Usage: npm run size:report
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = path.join(root, 'dist');
const publicDir = path.join(root, 'public');
const release = path.join(root, 'src-tauri', 'target', 'release');

const MB = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function walk(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push({ path: full, size: statSync(full).size });
    }
  };
  visit(directory);
  return files;
}

const sum = (files) => files.reduce((total, file) => total + file.size, 0);

function groupBy(files, keyOf) {
  const groups = new Map();
  for (const file of files) {
    const key = keyOf(file);
    const group = groups.get(key) ?? { count: 0, size: 0 };
    group.count += 1;
    group.size += file.size;
    groups.set(key, group);
  }
  return [...groups.entries()].sort((a, b) => b[1].size - a[1].size);
}

function reportDist() {
  if (!existsSync(dist)) throw new Error('no dist/ — run `npm run build` first');
  const files = walk(dist);
  console.log(`=== dist/ (embedded into the executable) ===\n${MB(sum(files))} across ${files.length} files\n`);

  console.log('by top-level entry:');
  for (const [name, group] of groupBy(files, (file) =>
    path.relative(dist, file.path).split(path.sep)[0] || '(root files)'
  )) {
    console.log(`  ${name.padEnd(34)} ${MB(group.size).padStart(10)}  ${String(group.count).padStart(5)} files`);
  }

  console.log('\nby extension:');
  for (const [ext, group] of groupBy(files, (file) => path.extname(file.path).toLowerCase() || '(none)').slice(0, 12)) {
    console.log(`  ${ext.padEnd(34)} ${MB(group.size).padStart(10)}  ${String(group.count).padStart(5)} files`);
  }

  return files;
}

/**
 * Vite emits an imported asset twice when the import path points into `public/`:
 * once hashed under `dist/assets/`, and once at its public path because
 * `publicDir` is copied verbatim. Nothing needs both.
 */

/**
 * Vite hashes use the `A-Za-z0-9_-` alphabet and are eight characters long, so a
 * naive `\w{8}` misses every hash that contains a dash — and roughly a third of
 * them do.
 */
const HASH_SUFFIX = /-[A-Za-z0-9_-]{8}(?=\.[^.]+$)/;

function reportDuplicates(distFiles) {
  console.log('\n=== hashed asset vs its public/ original ===');
  console.log('A Vite `import.meta.glob`/`?url` import of a file that lives in public/ emits a');
  console.log('hashed copy, while publicDir already copied the original. Same bytes, twice.\n');

  const publicByName = new Map();
  if (existsSync(publicDir)) {
    for (const file of walk(publicDir)) {
      const relative = path.relative(publicDir, file.path);
      publicByName.set(path.basename(relative), { ...file, relative });
    }
  }

  let duplicated = 0;
  let duplicatedSize = 0;
  const examples = [];
  for (const file of distFiles) {
    if (path.dirname(file.path) !== path.join(dist, 'assets')) continue;
    const name = path.basename(file.path);
    if (!HASH_SUFFIX.test(name)) continue;
    const original = publicByName.get(name.replace(HASH_SUFFIX, ''));
    if (!original || original.size !== file.size) continue;
    duplicated += 1;
    duplicatedSize += file.size;
    if (examples.length < 5) {
      examples.push(`  ${path.relative(root, file.path)}  ==  ${path.join('public', original.relative)}`);
    }
  }

  for (const line of examples) console.log(line);
  console.log(`  …  ${duplicated} files, ${MB(duplicatedSize)} of pure duplication`);
  return duplicatedSize;
}

function reportPublic() {
  if (!existsSync(publicDir)) return 0;
  const files = walk(publicDir);
  console.log(`\n=== public/ (source of the runtime assets) ===\n${MB(sum(files))} across ${files.length} files\n`);
  for (const [name, group] of groupBy(files, (file) => {
    const parts = path.relative(publicDir, file.path).split(path.sep);
    return parts.length > 1 ? parts.slice(0, 2).join('/') : parts[0];
  }).slice(0, 8)) {
    console.log(`  ${name.padEnd(34)} ${MB(group.size).padStart(10)}  ${String(group.count).padStart(5)} files`);
  }
  return sum(files);
}

function reportBinaries() {
  console.log('\n=== executables and installers ===');
  for (const relative of [
    'shiro-desktop.exe',
    'shiro-server.exe',
    path.join('bundle', 'msi'),
    path.join('bundle', 'nsis')
  ]) {
    const target = path.join(release, relative);
    if (!existsSync(target)) {
      console.log(`  ${relative.padEnd(34)} (missing)`);
      continue;
    }
    const stat = statSync(target);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(target)) {
        const file = path.join(target, entry);
        console.log(`  ${path.join(relative, entry).padEnd(34)} ${MB(statSync(file).size).padStart(10)}`);
      }
    } else {
      console.log(`  ${relative.padEnd(34)} ${MB(stat.size).padStart(10)}`);
    }
  }
}

const distFiles = reportDist();
const duplicatedSize = reportDuplicates(distFiles);
const publicSize = reportPublic();
reportBinaries();

console.log('\n=== what this means ===');
console.log(`  dist/                 ${MB(sum(distFiles))}`);
console.log(`  of which duplicated   ${MB(duplicatedSize)}`);
console.log(`  public/ (source)      ${MB(publicSize)}`);
console.log(`  payload after removing the duplicates ≈ ${MB(sum(distFiles) - duplicatedSize)}`);
