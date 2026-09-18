import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plistRaw, expandHome, IS_WINDOWS, windowsPaths } from './util.mjs';
import { parseYml } from './config.mjs';
import { readAsarVersion } from './asar.mjs';

export function defaultAppDirs() {
  if (IS_WINDOWS) {
    return windowsPaths().appDirs.filter((dir) => fs.existsSync(dir));
  }
  return ['/Applications', path.join(os.homedir(), 'Applications')]
    .map(expandHome)
    .filter((dir) => fs.existsSync(dir));
}

/** macOS: *.app bundles. Windows: folders containing resources/app-update.yml. */
export function listAppBundles(dirs = defaultAppDirs()) {
  const found = [];
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (IS_WINDOWS) {
        if (fs.existsSync(path.join(full, 'resources', 'app-update.yml'))) found.push(full);
      } else if (entry.name.endsWith('.app')) {
        found.push(full);
      }
    }
  }
  return found.sort();
}

export function cacheDirFor(updaterConfig, appName) {
  const dirName = updaterConfig?.updaterCacheDirName || appName || 'app';
  if (IS_WINDOWS) {
    return path.join(windowsPaths().localAppData, dirName);
  }
  return path.join(os.homedir(), 'Library', 'Caches', dirName);
}

function detectElectronUpdater(appPath) {
  const configPath = IS_WINDOWS
    ? path.join(appPath, 'resources', 'app-update.yml')
    : path.join(appPath, 'Contents', 'Resources', 'app-update.yml');
  if (!fs.existsSync(configPath)) return null;
  const text = fs.readFileSync(configPath, 'utf8');
  const cfg = parseYml(text);
  return {
    type: 'electron-updater',
    configPath,
    provider: cfg.provider ?? null,
    channel: cfg.channel ?? null,
    url: cfg.url ?? null,
    updaterCacheDirName: cfg.updaterCacheDirName ?? null,
    cacheDir: cacheDirFor(cfg),
  };
}

export async function describeApp(appPath) {
  if (IS_WINDOWS) {
    const updater = detectElectronUpdater(appPath);
    if (!updater) return null;
    const asarPath = path.join(appPath, 'resources', 'app.asar');
    return {
      path: appPath,
      name: path.basename(appPath),
      bundleId: null,
      version: fs.existsSync(asarPath) ? readAsarVersion(asarPath) : null,
      updater,
    };
  }
  const infoPath = path.join(appPath, 'Contents', 'Info.plist');
  if (!fs.existsSync(infoPath)) return null;
  const updater = detectElectronUpdater(appPath);
  const bundleId = await plistRaw(infoPath, 'CFBundleIdentifier');
  let version = await plistRaw(infoPath, 'CFBundleShortVersionString');
  if (!version) {
    const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
    if (fs.existsSync(asarPath)) version = readAsarVersion(asarPath);
  }
  const name = (await plistRaw(infoPath, 'CFBundleDisplayName')) || path.basename(appPath, '.app');
  let detected = updater;
  if (!detected) {
    const feedUrl = await plistRaw(infoPath, 'SUFeedURL');
    if (feedUrl) {
      detected = {
        type: 'sparkle',
        configPath: infoPath,
        feedUrl,
        note: 'Sparkle / Squirrel.Mac feed — detection only, not patched by this tool',
      };
    }
  }
  return { path: appPath, name, bundleId, version, updater: detected };
}

export async function scanApps(dirs = defaultAppDirs()) {
  const apps = [];
  for (const appPath of listAppBundles(dirs)) {
    const described = await describeApp(appPath);
    if (described?.updater) apps.push(described);
  }
  return apps;
}

export async function findApp(query) {
  const target = expandHome(query).replace(/\/+$/, '');
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    return describeApp(target);
  }
  const apps = await scanApps();
  const matches = apps.filter(
    (app) =>
      app.name.toLowerCase() === target.toLowerCase() ||
      app.bundleId?.toLowerCase() === target.toLowerCase() ||
      app.path.toLowerCase() === target.toLowerCase(),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `"${query}" matches ${matches.length} apps:\n${matches.map((m) => `  ${m.path}`).join('\n')}`,
    );
  }
  throw new Error(`no app with an update feed matched "${query}"`);
}
