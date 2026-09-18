import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-test-'));
process.env.TYPELESS_AUTO_UPDATE_BLOCK_HOME = path.join(sandbox, 'home');

const util = await import('../src/util.mjs');
const config = await import('../src/config.mjs');
const discover = await import('../src/discover.mjs');
const patch = await import('../src/patch.mjs');
const daemon = await import('../src/daemon.mjs');
const agent = await import('../src/agent.mjs');
const asar = await import('../src/asar.mjs');

const ORIGINAL_URL = 'https://typeless-static.com/desktop-release/';

function writePlist(file, values) {
  const body = Object.entries(values)
    .map(([key, value]) => `  <key>${key}</key>\n  <string>${value}</string>`)
    .join('\n');
  fs.writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`,
  );
}

function makeFakeApp({
  bundleId = 'now.typeless.desktop',
  version = '2.7.0',
  channel = 'arm64',
  url = ORIGINAL_URL,
} = {}) {
  const appPath = path.join(sandbox, `${bundleId}-${Math.random().toString(36).slice(2)}.app`);
  fs.mkdirSync(path.join(appPath, 'Contents', 'Resources'), { recursive: true });
  writePlist(path.join(appPath, 'Contents', 'Info.plist'), {
    CFBundleIdentifier: bundleId,
    CFBundleShortVersionString: version,
    CFBundleDisplayName: 'Typeless',
  });
  fs.writeFileSync(
    path.join(appPath, 'Contents', 'Resources', 'app-update.yml'),
    `provider: generic\nchannel: ${channel}\nurl: ${url}\nupdaterCacheDirName: typeless-updater\n`,
  );
  return appPath;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test('parses and rewrites only the url key', () => {
  const original = `provider: generic\nchannel: arm64\nurl: ${ORIGINAL_URL}\nupdaterCacheDirName: typeless-updater\n`;
  const patched = config.setYmlValue(original, 'url', 'http://127.0.0.1:1234/now.typeless.desktop/');
  assert.equal(config.getYmlValue(patched, 'provider'), 'generic');
  assert.equal(config.getYmlValue(patched, 'channel'), 'arm64');
  assert.equal(config.getYmlValue(patched, 'updaterCacheDirName'), 'typeless-updater');
  assert.equal(config.getYmlValue(patched, 'url'), 'http://127.0.0.1:1234/now.typeless.desktop/');
  assert.equal(config.setYmlValue(patched, 'url', 'http://127.0.0.1:1234/now.typeless.desktop/'), patched);
  assert.equal(original.split('\n').length, patched.split('\n').length);
});

test('preserves CRLF line endings when rewriting the feed URL', () => {
  const original = `provider: generic\r\nchannel: arm64\r\nurl: ${ORIGINAL_URL}\r\n`;
  const patched = config.setYmlValue(original, 'url', 'http://127.0.0.1:1234/app/');
  assert.match(patched, /provider: generic\r\nchannel: arm64\r\nurl: http:\/\/127\.0\.0\.1:1234\/app\/\r\n$/);
  assert.equal(patched.includes('\n') && !patched.includes('\r\n'), false);
});

test('creates stable slugs from Windows paths', () => {
  assert.equal(config.slugFor(null, 'C:\\Program Files\\Typeless\\Typeless.exe'), 'typeless.exe');
});

test('renders a manifest for the installed version', () => {
  const yaml = config.stubYml({ version: '2.7.0', artifactName: 'app-2.7.0.zip' });
  assert.match(yaml, /^version: 2\.7\.0$/m);
  assert.match(yaml, /^files:$/m);
  assert.match(yaml, /^  - url: app-2\.7\.0\.zip$/m);
  assert.match(yaml, /^path: app-2\.7\.0\.zip$/m);
});

test('detects an electron-updater app and its cache dir', async () => {
  const appPath = makeFakeApp();
  const app = await discover.describeApp(appPath);
  assert.equal(app.bundleId, 'now.typeless.desktop');
  assert.equal(app.version, '2.7.0');
  assert.equal(app.updater.type, 'electron-updater');
  assert.equal(app.updater.url, ORIGINAL_URL);
  assert.equal(app.updater.channel, 'arm64');
  assert.equal(app.updater.cacheDir, path.join(os.homedir(), 'Library', 'Caches', 'typeless-updater'));
});

test('freeze rewrites the feed url, keeps a byte-exact backup and reverts', async () => {
  const appPath = makeFakeApp({ bundleId: 'com.example.freeze' });
  const app = await discover.describeApp(appPath);
  const configPath = app.updater.configPath;
  const before = fs.readFileSync(configPath, 'utf8');

  const result = patch.freezeApp({ app, port: 47821 });
  assert.equal(result.changed, true);
  assert.equal(result.slug, 'com.example.freeze');
  assert.equal(config.getYmlValue(fs.readFileSync(configPath, 'utf8'), 'url'), result.target);
  assert.equal(fs.readFileSync(result.backupFile, 'utf8'), before);

  const again = patch.freezeApp({ app, port: 47821 });
  assert.equal(again.reason, 'already-frozen');

  const reverted = patch.revertApp({ slug: result.slug });
  assert.equal(reverted.restored, true);
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);
});

test('refuses to restore a backup over changed non-url settings', async () => {
  const appPath = makeFakeApp({ bundleId: 'com.example.stale' });
  const app = await discover.describeApp(appPath);
  const frozen = patch.freezeApp({ app, port: 47821 });
  fs.writeFileSync(frozen.configPath, `provider: github\nchannel: arm64\nurl: ${frozen.target}\nupdaterCacheDirName: typeless-updater\n`);
  assert.throws(() => patch.revertApp({ slug: frozen.slug }), /refusing to restore stale backup/);
});

test('refuses to patch a non electron-updater feed', async () => {
  const appPath = path.join(sandbox, 'Sparkle.app');
  fs.mkdirSync(path.join(appPath, 'Contents'), { recursive: true });
  writePlist(path.join(appPath, 'Contents', 'Info.plist'), {
    CFBundleIdentifier: 'com.example.sparkle',
    CFBundleShortVersionString: '1.0.0',
    SUFeedURL: 'https://example.com/appcast.xml',
  });
  const app = await discover.describeApp(appPath);
  assert.equal(app.updater.type, 'sparkle');
  assert.throws(() => patch.freezeApp({ app, port: 47821 }), /unsupported update feed/);
});

test('serves the no-op feed, re-applies the patch and guards the cache', async () => {
  const port = await freePort();
  const appPath = makeFakeApp({ bundleId: 'com.example.noop' });
  const app = await discover.describeApp(appPath);
  app.updater.cacheDir = path.join(sandbox, 'cache', 'typeless-updater');
  const frozen = patch.freezeApp({ app, port });

  const state = {
    schema: 1,
    port,
    apps: {
      [frozen.slug]: {
        appPath,
        bundleId: app.bundleId,
        name: app.name,
        configPath: frozen.configPath,
        cacheDir: app.updater.cacheDir,
        cacheDirName: app.updater.updaterCacheDirName,
        guardCache: true,
        frozenAt: new Date().toISOString(),
      },
    },
  };
  util.writeJsonAtomic(util.PATHS.state, state);

  const server = await daemon.startServer({ port, log: () => {} });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/${frozen.slug}/arm64-mac.yml`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(config.getYmlValue(body, 'version'), '2.7.0');
    assert.ok(body.includes('files:'));

    const missing = await fetch(`http://127.0.0.1:${port}/unknown.app/arm64-mac.yml`);
    assert.equal(missing.status, 404);

    // the app rewrites its own config (e.g. channel flip) - the daemon restores the feed url
    fs.writeFileSync(frozen.configPath, `provider: generic\nchannel: arm64\nurl: ${ORIGINAL_URL}\n`);
    const { actions } = daemon.reconcile(util.readJson(util.PATHS.state, null), { port, log: () => {} });
    assert.deepEqual(actions, [{ slug: frozen.slug, action: 're-applied' }]);
    assert.equal(config.getYmlValue(fs.readFileSync(frozen.configPath, 'utf8'), 'url'), frozen.target);

    // a payload that was already downloaded before freezing gets swept
    const pending = path.join(app.updater.cacheDir, 'pending');
    fs.mkdirSync(pending, { recursive: true });
    fs.writeFileSync(path.join(pending, 'Typeless-2.7.0-arm64.zip'), 'payload');
    const swept = daemon.sweepPending(app.updater.cacheDir, () => {});
    assert.equal(swept.removed, 1);
    assert.equal(fs.existsSync(path.join(pending, 'Typeless-2.7.0-arm64.zip')), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('cache guard ignores a directory that does not look like the updater cache', () => {
  const target = path.join(sandbox, 'cache', 'unrelated-dir', 'pending');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'payload.zip'), 'payload');
  const { actions } = daemon.reconcile(
    {
      port: 47821,
      apps: {
        'now.typeless.desktop': {
          appPath: makeFakeApp(),
          configPath: path.join(sandbox, 'missing-config.yml'),
          cacheDir: path.dirname(target),
          cacheDirName: 'typeless-updater',
          guardCache: true,
        },
      },
    },
    { port: 47821, log: () => {} },
  );
  assert.deepEqual(actions, [{ slug: 'now.typeless.desktop', action: 'unreadable' }]);
  assert.equal(fs.existsSync(path.join(target, 'payload.zip')), true);
});

test('notifies at most once per app per hour when a patch is lost', () => {
  const now = Date.now();
  assert.equal(daemon.shouldNotify({}, now), true);
  assert.equal(daemon.shouldNotify({ lastNotifyAt: new Date(now - 5 * 60 * 1000).toISOString() }, now), false);
  assert.equal(daemon.shouldNotify({ lastNotifyAt: new Date(now - 90 * 60 * 1000).toISOString() }, now), true);
  assert.equal(daemon.shouldNotify({ lastNotifyAt: 'not-a-date' }, now), true);
  const calls = [];
  daemon.notifyDesktop('typeless-auto-update-block', 'hello', (...args) => calls.push(args));
  assert.equal(calls.length, process.platform === 'darwin' ? 1 : 0);
});

test('generated wrapper resolves node instead of hard-coding one path', () => {
  const script = agent.wrapperScript();
  assert.match(script, /typeless-auto-update-block\/app\/src\/cli\.mjs/);
  assert.match(script, /command -v node/);
  assert.match(script, /\/opt\/homebrew\/bin\/node/);
  assert.match(script, /nvm\/versions\/node/);
});

test('generates a windows wrapper and windows paths', async () => {
  const cmd = agent.wrapperScript('win32');
  assert.match(cmd, /nodejs\\node\.exe/);
  assert.match(cmd, /typeless-auto-update-block\\app\\src\\cli\.mjs/);
  const util2 = await import('../src/util.mjs');
  const paths = util2.windowsPaths({
    LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
    APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  });
  assert.equal(paths.localAppData, 'C:\\Users\\x\\AppData\\Local');
  assert.equal(paths.runKey, 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run');
  assert.ok(paths.appDirs.some((dir) => dir.includes('Programs')));
});

test('reads the app version from a real electron app.asar', { skip: !fs.existsSync('/Applications/Typeless.app/Contents/Resources/app.asar') }, () => {
  const version = asar.readAsarVersion('/Applications/Typeless.app/Contents/Resources/app.asar');
  assert.match(String(version), /^\d+\.\d+\.\d+/);
  assert.equal(asar.readAsarVersion('/nonexistent/app.asar'), null);
});

test('picks another port when the preferred one is taken by a foreign process', async () => {
  const port = await freePort();
  const blocker = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(404);
      res.end('not our daemon');
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
  try {
    const choice = await daemon.pickPort(port);
    assert.equal(choice.runningDaemon, false);
    assert.notEqual(choice.port, port);
    assert.ok(choice.port > port);
  } finally {
    blocker.closeAllConnections?.();
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test('rejects invalid ports before probing the network', async () => {
  await assert.rejects(() => daemon.pickPort(0), /invalid port/);
  await assert.rejects(() => daemon.pickPort(65536), /invalid port/);
});

test('accepts only loopback daemon health from the configured state directory', () => {
  assert.equal(daemon.isOwnDaemonHealth({ ok: true, port: 47821, home: util.PATHS.home, pid: 123 }, 47821), true);
  assert.equal(daemon.isOwnDaemonHealth({ ok: true, port: 47821, home: '/tmp/other', pid: 123 }, 47821), false);
  assert.equal(daemon.isOwnDaemonHealth({ ok: true, port: 47822, home: util.PATHS.home, pid: 123 }, 47821), false);
});

test('reuses the port when our own daemon already answers there', async () => {
  const port = await freePort();
  const server = await daemon.startServer({ port, log: () => {} });
  try {
    const choice = await daemon.pickPort(port);
    assert.deepEqual({ port: choice.port, runningDaemon: choice.runningDaemon }, { port, runningDaemon: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('refuses to freeze a config the user cannot write', { skip: process.getuid?.() === 0 }, async () => {
  const appPath = makeFakeApp();
  const app = await discover.describeApp(appPath);
  fs.chmodSync(app.updater.configPath, 0o400);
  try {
    assert.throws(() => patch.freezeApp({ app, port: 47821 }), /not writable/);
  } finally {
    fs.chmodSync(app.updater.configPath, 0o600);
  }
});
