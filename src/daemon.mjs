import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { IS_MAC, IS_WINDOWS, PATHS, appendLog, ensureHome, humanBytes, plistRaw, sleep } from './util.mjs';
import { feedUrl, parseYml, setYmlValue, stubYml } from './config.mjs';
import { loadState, saveState } from './state.mjs';
import { readAsarVersion } from './asar.mjs';

const RECONCILE_INTERVAL_MS = 20000;
const versionCache = new Map();

export function isOwnDaemonHealth(health, port) {
  return Boolean(
    health?.ok
      && health.port === port
      && health.home === PATHS.home
      && Number.isInteger(health.pid)
      && health.pid > 0,
  );
}

async function installedVersion(appPath) {
  const cached = versionCache.get(appPath);
  const now = Date.now();
  if (cached && now - cached.at < 10000) return cached.version;
  let version;
  if (IS_WINDOWS) {
    version = readAsarVersion(path.join(appPath, 'resources', 'app.asar'));
  } else {
    version = await plistRaw(path.join(appPath, 'Contents', 'Info.plist'), 'CFBundleShortVersionString');
    if (!version) {
      version = readAsarVersion(path.join(appPath, 'Contents', 'Resources', 'app.asar'));
    }
  }
  versionCache.set(appPath, { version, at: now });
  return version;
}

function slugFromRequest(pathname) {
  const match = /^\/([^/]+)\/[^/]*$/.exec(pathname);
  return match ? match[1] : null;
}

export function startServer({ port, log = appendLog }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/healthz') {
      const state = loadState();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        `${JSON.stringify({
          ok: true,
          pid: process.pid,
          port,
          home: PATHS.home,
          apps: Object.keys(state.apps),
        })}\n`,
      );
      return;
    }
    const slug = slugFromRequest(url.pathname);
    const state = loadState();
    const entry = slug ? state.apps[slug] : null;
    if (!entry) {
      log(`feed MISS ${req.url} (unknown slug)`);
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('unknown feed\n');
      return;
    }
    const version = entry.pinVersion || (await installedVersion(entry.appPath)) || entry.version || null;
    if (!version) {
      log(`feed ERROR ${req.url}: installed version unavailable`);
      res.writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end('installed version unavailable\n');
      return;
    }
    const artifact = `${slug}-${version}.zip`;
    const body = stubYml({ version, artifactName: artifact });
    log(`feed HIT ${req.url} -> version ${version}`);
    res.writeHead(200, { 'content-type': 'text/yaml', 'cache-control': 'no-store' });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

export function sweepPending(cacheDir, log = appendLog) {
  const pending = path.join(cacheDir, 'pending');
  if (!fs.existsSync(pending)) return { removed: 0, bytes: 0 };
  let removed = 0;
  let bytes = 0;
  for (const name of fs.readdirSync(pending)) {
    const file = path.join(pending, name);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      fs.unlinkSync(file);
      removed += 1;
      bytes += stat.size;
    } catch {
      // ignore
    }
  }
  if (removed > 0) {
    log(`guard: removed ${removed} pending update file(s) from ${pending} (${humanBytes(bytes)})`);
  }
  return { removed, bytes };
}

/**
 * The cache guard only touches a directory that still looks like the updater
 * cache it was recorded from: same folder name as `updaterCacheDirName`.
 */
export function cacheGuardApplies(entry) {
  if (!entry?.guardCache || !entry.cacheDir) return false;
  if (!entry.cacheDirName) return false;
  return path.basename(entry.cacheDir) === entry.cacheDirName;
}

const NOTIFY_WINDOW_MS = 60 * 60 * 1000;

/** Rate limit: at most one desktop notification per app per hour. */
export function shouldNotify(entry, now = Date.now(), windowMs = NOTIFY_WINDOW_MS) {
  const last = entry?.lastNotifyAt ? Date.parse(entry.lastNotifyAt) : 0;
  if (Number.isNaN(last)) return true;
  return now - last > windowMs;
}

export function notifyDesktop(title, message, run = execFile) {
  if (!IS_MAC) return false;
  try {
    run(
      'osascript',
      ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`],
      () => {},
    );
    return true;
  } catch {
    return false;
  }
}

export function reconcile(state = loadState(), { port, log = appendLog } = {}) {
  const actions = [];
  let dirty = false;
  for (const [slug, entry] of Object.entries(state.apps)) {
    try {
      reconcileApp(slug, entry, { port, log, actions });
    } catch (error) {
      const hint = error.code === 'EPERM' || error.code === 'EACCES'
        ? ' (macOS App Management blocks background agents from editing app bundles - run "node src/cli.mjs freeze <app>" from Terminal, or add a hosts block as a second layer)'
        : '';
      log(`re-apply failed for ${slug}: ${error.message}${hint}`);
      actions.push({ slug, action: 're-apply-failed', error: error.message });
      if (shouldNotify(entry)) {
        const appName = entry.name ?? slug;
        const sent = notifyDesktop(
          'typeless-auto-update-block',
          `${appName}: update patch was lost, run "node src/cli.mjs repair"`,
        );
        entry.lastNotifyAt = new Date().toISOString();
        dirty = true;
        if (sent) log(`notified user about lost patch for ${slug}`);
      }
    }
  }
  return { actions, dirty };
}

function reconcileApp(slug, entry, { port, log, actions }) {
  if (!fs.existsSync(entry.appPath)) {
    if (!entry.missing) {
      entry.missing = true;
      actions.push({ slug, action: 'missing' });
      log(`app missing: ${entry.appPath} (${slug})`);
    }
    return;
  }
  if (entry.missing) delete entry.missing;
  const expected = feedUrl(port, slug);
  let text = null;
  try {
    text = fs.readFileSync(entry.configPath, 'utf8');
  } catch (error) {
    actions.push({ slug, action: 'unreadable' });
    log(`config unreadable: ${entry.configPath} (${error.message})`);
    return;
  }
  if (parseYml(text).url !== expected) {
    fs.writeFileSync(entry.configPath, setYmlValue(text, 'url', expected));
    actions.push({ slug, action: 're-applied' });
    log(`re-applied feed url in ${entry.configPath}`);
  }
  if (cacheGuardApplies(entry)) {
    const swept = sweepPending(entry.cacheDir, log);
    if (swept.removed > 0) actions.push({ slug, action: 'cache-guard', ...swept });
  } else if (entry.guardCache && entry.cacheDir && entry.cacheDirName) {
    log(`guard skipped for ${entry.cacheDir}: folder name does not match "${entry.cacheDirName}"`);
  }
}

export async function runDaemon({ port }) {
  ensureHome();
  const server = await startServer({ port });
  try {
    fs.writeFileSync(PATHS.pid, `${process.pid}\n`, { mode: 0o600 });
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }
  appendLog(`daemon started on 127.0.0.1:${port} (pid ${process.pid})`);
  const tick = () => {
    try {
      const state = loadState();
      const { dirty } = reconcile(state, { port });
      if (dirty) saveState(state);
    } catch (error) {
      appendLog(`reconcile failed: ${error.message}`);
    }
  };
  tick();
  const timer = setInterval(tick, RECONCILE_INTERVAL_MS);
  const stop = () => {
    clearInterval(timer);
    server.close();
    try {
      fs.unlinkSync(PATHS.pid);
    } catch {
      // ignore
    }
    appendLog('daemon stopped');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise(() => {});
}

export async function probeDaemon(port, timeoutMs = 1000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/**
 * Find a usable port: reuse our own running daemon, otherwise the first free
 * port at or after the preference. Returns { port, runningDaemon }.
 */
export async function pickPort(preferred, { attempts = 40 } = {}) {
  if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535) {
    throw new Error(`invalid port: ${preferred}`);
  }
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = preferred + offset;
    if (port > 65535) break;
    const health = await probeDaemon(port, 400);
    if (isOwnDaemonHealth(health, port)) return { port, runningDaemon: true, health };
    if (await portIsFree(port)) return { port, runningDaemon: false };
  }
  throw new Error(`no free port between ${preferred} and ${preferred + attempts - 1}`);
}

export async function waitForDaemon(port, { attempts = 20, delayMs = 300 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const health = await probeDaemon(port);
    if (isOwnDaemonHealth(health, port)) return health;
    await sleep(delayMs);
  }
  return null;
}
