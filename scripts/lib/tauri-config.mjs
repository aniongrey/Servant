#!/usr/bin/env node
/**
 * The one reader of `src-tauri/tauri.conf.json`.
 *
 * Two facts in that file are load-bearing outside the Tauri build itself: the
 * bundle identifier, which Tauri also uses as the app data directory name, and
 * `bundle.resources`, which is the complete list of files the packaged app ships.
 *
 * Every script that needs either one reads it here. A second copy of the
 * identifier or the resource list is exactly how the fast build, the installer
 * and a verification run end up looking at different places — which is the
 * failure mode this project has already paid for once.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, derived from this file's location rather than the cwd. */
export const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const tauriDir = path.join(projectRoot, 'src-tauri');

function tauriConfigPath() {
  return path.join(tauriDir, 'tauri.conf.json');
}

export function tauriConfig() {
  const configPath = tauriConfigPath();
  return { configPath, config: JSON.parse(readFileSync(configPath, 'utf8')) };
}

/**
 * The bundle identifier. Tauri derives `%APPDATA%\<identifier>` (and
 * `%LOCALAPPDATA%\<identifier>` for the webview profile) from it, so changing it
 * moves every persisted conversation, key and window position.
 */
export function bundleIdentifier() {
  const { configPath, config } = tauriConfig();
  const identifier = config.identifier;
  if (typeof identifier !== 'string' || !identifier) {
    throw new Error(`expected a string identifier in ${configPath}`);
  }
  return identifier;
}

/**
 * Where the packaged app keeps conversations, memory, logs and the memory
 * service's virtualenv. Never inside the build output.
 */
export function dataDir() {
  const identifier = bundleIdentifier();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    return appData ? path.join(appData, identifier) : `%APPDATA%\\${identifier}`;
  }
  if (process.platform === 'darwin') {
    return `~/Library/Application Support/${identifier}`;
  }
  return `~/.local/share/${identifier}`;
}

/** The `bundle.resources` map, as `[source, destination]` pairs. */
export function declaredResources() {
  const { configPath, config } = tauriConfig();
  const resources = config.bundle?.resources;
  if (!resources || Array.isArray(resources)) {
    throw new Error(
      `expected an object map in bundle.resources of ${configPath}, got ${
        Array.isArray(resources) ? 'an array' : String(resources)
      }`
    );
  }
  return Object.entries(resources);
}
