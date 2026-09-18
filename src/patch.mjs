import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ensureHome, writeJsonAtomic, readJson, pathIsWritable, IS_WINDOWS } from './util.mjs';
import { feedUrl, parseYml, setYmlValue, slugFor } from './config.mjs';

export function backupDir(slug) {
  return path.join(PATHS.backups, slug);
}

function sameNonUrlKeys(left, right) {
  const a = parseYml(left);
  const b = parseYml(right);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key !== 'url' && a[key] !== b[key]) return false;
  }
  return true;
}

function assertSafePatch(before, after, target) {
  const beforeMap = parseYml(before);
  const afterMap = parseYml(after);
  const keys = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]);
  for (const key of keys) {
    if (key === 'url') continue;
    if (beforeMap[key] !== afterMap[key]) {
      throw new Error(`refusing to patch: key "${key}" would change`);
    }
  }
  if (afterMap.url !== target) {
    throw new Error('refusing to patch: new feed url was not applied');
  }
}

export function freezeApp({ app, port, guardCache = true, pinVersion = null, dryRun = false }) {
  if (!app?.updater) throw new Error(`no update feed found for ${app?.path ?? 'app'}`);
  if (app.updater.type !== 'electron-updater') {
    throw new Error(`unsupported update feed (${app.updater.type}); this tool only patches electron-updater apps`);
  }
  if (!app.version) throw new Error(`cannot determine installed version for ${app.path}`);
  const slug = slugFor(app.bundleId, app.path);
  const configPath = app.updater.configPath;
  const original = fs.readFileSync(configPath, 'utf8');
  const originalUrl = parseYml(original).url ?? null;
  const target = feedUrl(port, slug);
  const localUrl = typeof originalUrl === 'string' && originalUrl.startsWith('http://127.0.0.1:');

  if (originalUrl === target) {
    const existingBackup = path.join(backupDir(slug), 'app-update.yml');
    const existingMeta = readJson(path.join(backupDir(slug), 'meta.json'), null);
    if (existingMeta?.appPath && path.resolve(existingMeta.appPath) !== path.resolve(app.path)) {
      throw new Error(`slug ${slug} is already associated with another app: ${existingMeta.appPath}`);
    }
    if (!fs.existsSync(existingBackup)) {
      throw new Error(`app already points at ${target}, but no backup exists; refusing to claim it is reversible`);
    }
    const backup = fs.readFileSync(existingBackup, 'utf8');
    if (!sameNonUrlKeys(original, backup)) {
      throw new Error(`local feed points at ${target}, but the saved backup does not match this app configuration; run revert before freezing this app again`);
    }
    return {
      slug,
      changed: false,
      reason: 'already-frozen',
      originalUrl,
      target,
      configPath,
      backupFile: fs.existsSync(existingBackup) ? existingBackup : null,
      guardCache,
      pinVersion,
    };
  }

  if (!pathIsWritable(configPath)) {
    const hint = IS_WINDOWS
      ? 'run your terminal as Administrator and retry'
      : `re-run with sudo: sudo node ${process.argv[1] ?? 'src/cli.mjs'} freeze "${app.path}"`;
    throw new Error(`${configPath} is not writable - ${hint}`);
  }

  const patched = setYmlValue(original, 'url', target);
  assertSafePatch(original, patched, target);

  if (dryRun) {
    return { slug, changed: false, dryRun: true, originalUrl, target, configPath };
  }

  ensureHome();
  const dir = backupDir(slug);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const backupFile = path.join(dir, 'app-update.yml');
  const existingMeta = readJson(path.join(dir, 'meta.json'), null);
  if (existingMeta?.appPath && path.resolve(existingMeta.appPath) !== path.resolve(app.path)) {
    throw new Error(`slug ${slug} is already associated with another app: ${existingMeta.appPath}`);
  }
  if (!fs.existsSync(backupFile)) {
    if (localUrl) throw new Error(`app points at an unknown local feed and has no backup; refusing to overwrite it`);
    fs.writeFileSync(backupFile, original, { mode: 0o600 });
  } else if (!sameNonUrlKeys(original, fs.readFileSync(backupFile, 'utf8'))) {
    if (localUrl) throw new Error(`app points at a local feed but its saved backup does not match; run revert before freezing this app again`);
    fs.writeFileSync(backupFile, original, { mode: 0o600 });
  }
  writeJsonAtomic(path.join(dir, 'meta.json'), {
    appPath: app.path,
    bundleId: app.bundleId,
    configPath,
    originalUrl,
    appVersion: app.version,
    savedAt: new Date().toISOString(),
  });

  const stat = fs.statSync(configPath);
  fs.writeFileSync(configPath, patched, { mode: stat.mode });

  return { slug, changed: true, originalUrl, target, configPath, backupFile, guardCache, pinVersion };
}

export function revertApp({ slug }) {
  const dir = backupDir(slug);
  const backupFile = path.join(dir, 'app-update.yml');
  const meta = readJson(path.join(dir, 'meta.json'), null);
  if (!fs.existsSync(backupFile) || !meta?.configPath) {
    throw new Error(`no backup recorded for ${slug}`);
  }
  const current = fs.existsSync(meta.configPath) ? fs.readFileSync(meta.configPath, 'utf8') : null;
  const restore = fs.readFileSync(backupFile, 'utf8');
  if (current !== null && !sameNonUrlKeys(current, restore)) {
    throw new Error(`refusing to restore stale backup for ${slug}: current app-update.yml has different non-url settings`);
  }
  if (current !== restore && fs.existsSync(meta.configPath)) {
    fs.writeFileSync(meta.configPath, restore);
  }
  return { slug, configPath: meta.configPath, restored: current !== restore, originalUrl: meta.originalUrl };
}
