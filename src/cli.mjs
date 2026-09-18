#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT, IS_WINDOWS, PATHS, appendLog, ensureHome, humanBytes, dirSize } from './util.mjs';
import { feedUrl, parseYml, setYmlValue } from './config.mjs';
import { findApp, scanApps } from './discover.mjs';
import { freezeApp, revertApp } from './patch.mjs';
import { loadState, saveState } from './state.mjs';
import { agentLoaded, installAgent, uninstallAgent } from './agent.mjs';
import { isOwnDaemonHealth, pickPort, probeDaemon, runDaemon, waitForDaemon } from './daemon.mjs';

const CLI_PATH = fileURLToPath(import.meta.url);
const VERSION = '0.1.0';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    if (name.startsWith('no-')) {
      flags[name.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = true;
    }
  }
  return { positional, flags };
}

function jsonOut(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parsePort(value, fallback) {
  const candidate = value ?? fallback;
  const port = Number(candidate);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${candidate}`);
  return port;
}

function usage() {
  const lines = [
    `Typeless Update Feed Controller  v${VERSION}`,
    '',
    'Usage:  node src/cli.mjs <command>',
    '',
    '  scan                                inspect apps with an update feed (read-only)',
    '  status [--json]                     show app, service, and feed state',
    '  freeze <app> [options]              back up and redirect one update feed',
    '  revert <app> | --all                restore the original feed URL',
    '  repair                              re-apply local feed URLs from this shell',
    '  agent <install|uninstall|status>    manage the background service',
    '  serve [--foreground]                run the loopback feed service',
    '  hosts <add|remove> <domain>         optional /etc/hosts rule (needs sudo)',
    '  doctor                              check the installation and recent failures',
    '',
    'freeze options:',
    '  --dry-run            print the planned change, touch nothing',
    '  --pin <version>      testing only; a newer value can trigger a download attempt',
    '  --no-guard-cache     do not delete downloaded update payloads in the app cache',
    `  --port <n>           daemon port (default ${DEFAULT_PORT})`,
    '',
    '<app> can be a bundle path, app name (Typeless) or bundle id (now.typeless.desktop).',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function ensureDaemon(port, { quiet = false, refreshAgent = false } = {}) {
  const health = await probeDaemon(port);
  if (isOwnDaemonHealth(health, port) && !refreshAgent) return { started: false, health };
  const wasHealthy = isOwnDaemonHealth(health, port);
  const loader = await installAgent({ cliPath: CLI_PATH });
  const ready = await waitForDaemon(port);
  if (!ready) throw new Error('local feed daemon did not come up; run "node src/cli.mjs doctor"');
  if (!quiet && !wasHealthy) {
    process.stdout.write(`started local feed daemon on 127.0.0.1:${port} (${loader.plist ?? loader.runKey})\n`);
  }
  return { started: !wasHealthy, health: ready };
}

async function commandScan(flags) {
  const extraDirs = flags.dir ? String(flags.dir).split(',').map((dir) => dir.trim()).filter(Boolean) : [];
  const apps = await scanApps(extraDirs.length > 0 ? extraDirs : undefined);
  if (flags.json) return jsonOut(apps);
  if (apps.length === 0) {
    return process.stdout.write('no apps with an update feed found in /Applications and ~/Applications\n');
  }
  for (const app of apps) {
    process.stdout.write(`${app.name} ${app.version ?? '?'} (${app.bundleId ?? 'no bundle id'})\n`);
    process.stdout.write(`  path:   ${app.path}\n`);
    process.stdout.write(`  feed:   ${app.updater.type} ${app.updater.url ?? app.updater.feedUrl ?? ''}\n`);
    if (app.updater.configPath) process.stdout.write(`  config: ${app.updater.configPath}\n`);
    if (app.updater.cacheDir) process.stdout.write(`  cache:  ${app.updater.cacheDir}\n`);
  }
}

async function commandStatus(flags) {
  const state = loadState();
  const port = state.port ?? DEFAULT_PORT;
  const health = await probeDaemon(port);
  const loaded = await agentLoaded();
  const entries = Object.entries(state.apps);
  const report = { port, agentLoaded: loaded, daemon: isOwnDaemonHealth(health, port) ? 'running' : 'stopped', apps: [] };
  for (const [slug, entry] of entries) {
    const item = {
      slug,
      appPath: entry.appPath,
      frozenAt: entry.frozenAt ?? null,
      pinVersion: entry.pinVersion ?? null,
    };
    try {
      const map = parseYml(fs.readFileSync(entry.configPath, 'utf8'));
      item.feedUrl = map.url ?? null;
      item.frozen = map.url === feedUrl(port, slug);
    } catch {
      item.frozen = false;
      item.error = 'config unreadable';
    }
    if (entry.cacheDir && fs.existsSync(entry.cacheDir)) {
      const size = dirSize(entry.cacheDir);
      item.cache = { path: entry.cacheDir, bytes: size.bytes, files: size.entries };
    }
    report.apps.push(item);
  }
  if (flags.json) return jsonOut(report);
  process.stdout.write(
    `daemon: ${report.daemon} on 127.0.0.1:${port}   launch agent: ${loaded ? 'loaded' : 'not loaded'}\n`,
  );
  if (entries.length === 0) return process.stdout.write('no frozen apps\n');
  for (const item of report.apps) {
    process.stdout.write(`\n${item.slug} ${item.frozen ? '[frozen]' : '[needs re-apply]'}\n`);
    process.stdout.write(`  app:   ${item.appPath}\n`);
    process.stdout.write(`  feed:  ${item.feedUrl ?? '?'}\n`);
    if (item.pinVersion) process.stdout.write(`  pin:   ${item.pinVersion}\n`);
    if (item.cache) process.stdout.write(`  cache: ${item.cache.path} (${humanBytes(item.cache.bytes)})\n`);
  }
}

async function commandFreeze(query, flags) {
  if (!query) throw new Error('usage: node src/cli.mjs freeze <app>');
  const app = await findApp(query);
  if (!app) throw new Error(`no app matched "${query}"`);
  const state = loadState();
  const preferred = parsePort(flags.port, state.port ?? DEFAULT_PORT);
  const choice = await pickPort(preferred);
  const port = choice.port;
  if (port !== preferred && !flags.json) {
    process.stdout.write(`port ${preferred} is busy - using ${port} for the local feed\n`);
  }
  const result = freezeApp({
    app,
    port,
    guardCache: flags.guardCache !== false,
    pinVersion: flags.pin ?? null,
    dryRun: Boolean(flags['dry-run']),
  });
  if (result.dryRun) {
    if (flags.json) {
      return jsonOut({ app: { path: app.path, name: app.name, version: app.version }, ...result });
    }
    process.stdout.write(`[dry-run] ${app.name}: ${result.originalUrl} -> ${result.target}\n`);
    process.stdout.write(`[dry-run] would back up ${result.configPath}\n`);
    return;
  }
  if (!flags.json) {
    if (result.reason === 'already-frozen') {
      process.stdout.write(`${app.name} already points to ${result.target}\n`);
    } else {
      process.stdout.write(`${app.name}: feed ${result.originalUrl} -> ${result.target}\n`);
      process.stdout.write(`backup: ${result.backupFile}\n`);
    }
  }
  state.port = port;
  state.apps[result.slug] = {
    appPath: app.path,
    bundleId: app.bundleId,
    name: app.name,
    version: app.version,
    configPath: result.configPath,
    cacheDir: app.updater.cacheDir,
    cacheDirName: app.updater.updaterCacheDirName,
    guardCache: result.guardCache,
    pinVersion: result.pinVersion,
    frozenAt: new Date().toISOString(),
  };
  saveState(state);
  await repointFrozenApps(state, port, flags, result.slug);
  const daemon = await ensureDaemon(port, { quiet: Boolean(flags.json), refreshAgent: true });
  if (flags.json) {
    return jsonOut({
      app: { path: app.path, name: app.name, version: app.version },
      ...result,
      daemon: { port, started: daemon.started, running: Boolean(daemon.health?.ok) },
    });
  }
  if (!daemon.started) process.stdout.write(`daemon: already running on 127.0.0.1:${port}\n`);
  process.stdout.write('restart the app once so it reads the local feed URL\n');
}

/** Keep already-frozen apps pointing at the port we are actually serving. */
async function repointFrozenApps(state, port, flags, skipSlug) {
  for (const [slug, entry] of Object.entries(state.apps)) {
    if (slug === skipSlug) continue;
    const expected = feedUrl(port, slug);
    try {
      const text = fs.readFileSync(entry.configPath, 'utf8');
      const current = parseYml(text).url ?? '';
      if (current === expected) continue;
      if (!current.startsWith('http://127.0.0.1:')) continue;
      fs.writeFileSync(entry.configPath, setYmlValue(text, 'url', expected));
      if (!flags.json) process.stdout.write(`${slug}: feed moved to ${expected}\n`);
    } catch (error) {
      process.stderr.write(`warning: could not repoint ${slug}: ${error.message}\n`);
    }
  }
}

async function stopDaemon(port) {
  const health = await probeDaemon(port);
  if (!isOwnDaemonHealth(health, port)) return false;
  try {
    const pid = Number(fs.readFileSync(PATHS.pid, 'utf8').trim());
    if (pid !== health.pid) return false;
  } catch {
    return false;
  }
  try {
    process.kill(health.pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

async function commandRevert(query, flags) {
  const state = loadState();
  const slugs = flags.all ? Object.keys(state.apps) : [];
  if (!flags.all) {
    if (!query) throw new Error('usage: node src/cli.mjs revert <app> | --all');
    const app = await findApp(query).catch(() => null);
    const match = Object.entries(state.apps).find(
      ([slug, entry]) => slug === query || entry.appPath === app?.path || entry.bundleId === query,
    );
    if (!match) throw new Error(`"${query}" is not frozen by this tool`);
    slugs.push(match[0]);
  }
  const results = [];
  for (const slug of slugs) {
    const result = revertApp({ slug });
    results.push({ slug, ...result });
    delete state.apps[slug];
  }
  saveState(state);
  const remaining = Object.keys(state.apps).length;
  if (remaining === 0) {
    await uninstallAgent();
    await stopDaemon(state.port ?? DEFAULT_PORT);
  }
  if (flags.json) return jsonOut(results);
  for (const result of results) {
    process.stdout.write(`${result.slug}: restored ${result.originalUrl} in ${result.configPath}\n`);
  }
  if (remaining === 0) {
    process.stdout.write('no frozen apps left - daemon stopped, launch agent removed\n');
  }
}

/**
 * Re-apply the feed patch from the user's own shell context. Needed on macOS 13+
 * where the background agent may be blocked by App Management (EPERM).
 */
async function commandRepair(flags) {
  const state = loadState();
  const port = state.port ?? DEFAULT_PORT;
  const results = [];
  for (const [slug, entry] of Object.entries(state.apps)) {
    const target = feedUrl(port, slug);
    try {
      const text = fs.readFileSync(entry.configPath, 'utf8');
      if (parseYml(text).url === target) {
        results.push({ slug, action: 'ok' });
        continue;
      }
      fs.writeFileSync(entry.configPath, setYmlValue(text, 'url', target));
      results.push({ slug, action: 'repaired' });
    } catch (error) {
      results.push({ slug, action: 'failed', error: error.message });
    }
  }
  if (Object.keys(state.apps).length > 0) {
    ensureHome();
    await ensureDaemon(port, { refreshAgent: true, quiet: Boolean(flags.json) });
  }
  if (flags.json) return jsonOut(results);
  if (results.length === 0) return process.stdout.write('no frozen apps to repair\n');
  for (const result of results) {
    process.stdout.write(`${result.slug}: ${result.action}${result.error ? ` (${result.error})` : ''}\n`);
  }
}

const HOSTS_START = '# >>> typeless-auto-update-block >>>';
const HOSTS_END = '# <<< typeless-auto-update-block <<<';

function commandHosts(action, domain) {
  const file = IS_WINDOWS
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
    : '/etc/hosts';
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(`cannot read ${file} - run this command with sudo`);
  }
  if (!domain) throw new Error('usage: node src/cli.mjs hosts <add|remove> <domain>');
  if (!/^[A-Za-z0-9.-]+$/.test(domain)) throw new Error('domain must contain only letters, digits, dots, and hyphens');
  const rewrite = (current, nextLines) => {
    const filtered = [];
    let inside = false;
    for (const line of current.split('\n')) {
      if (line.trim() === HOSTS_START) {
        inside = true;
        continue;
      }
      if (line.trim() === HOSTS_END) {
        inside = false;
        continue;
      }
      if (!inside) filtered.push(line);
    }
    while (filtered.length > 0 && filtered[filtered.length - 1].trim() === '') filtered.pop();
    if (nextLines.length > 0) filtered.push(HOSTS_START, ...nextLines, HOSTS_END);
    return `${filtered.join('\n')}\n`;
  };
  const markerStart = content.indexOf(HOSTS_START);
  const markerEnd = content.indexOf(HOSTS_END, markerStart + HOSTS_START.length);
  const managedBlock = markerStart >= 0 && markerEnd > markerStart
    ? content.slice(markerStart + HOSTS_START.length, markerEnd)
    : '';
  const managed = (managedBlock.match(/^\s*127\.0\.0\.1\s+(\S+)/gm) ?? [])
    .map((line) => line.trim().split(/\s+/)[1])
    .filter(Boolean);
  if (action === 'add') {
    const next = [...new Set([...managed, domain])];
    fs.writeFileSync(file, rewrite(content, next.map((entry) => `127.0.0.1 ${entry}`)));
    process.stdout.write(`blocked: ${next.join(', ')}\n`);
    return;
  }
  if (action === 'remove') {
    const next = managed.filter((entry) => entry !== domain);
    fs.writeFileSync(file, rewrite(content, next.map((entry) => `127.0.0.1 ${entry}`)));
    process.stdout.write(`unblocked: ${domain}\n`);
    return;
  }
  throw new Error('usage: node src/cli.mjs hosts <add|remove> <domain>');
}

function recentDaemonProblems(windowMs = 15 * 60 * 1000) {
  let lines = [];
  try {
    lines = fs.readFileSync(PATHS.log, 'utf8').split('\n').slice(-400);
  } catch {
    return [];
  }
  const cutoff = Date.now() - windowMs;
  return lines.filter((line) => {
    if (!/re-apply failed|reconcile failed|config unreadable/.test(line)) return false;
    const stamp = Date.parse(line.slice(0, 24));
    return Number.isNaN(stamp) || stamp >= cutoff;
  });
}

async function commandDoctor() {
  const state = loadState();
  const port = state.port ?? DEFAULT_PORT;
  const health = await probeDaemon(port);
  const loaded = await agentLoaded();
  const daemonProblems = recentDaemonProblems();
  const checks = [
    { name: 'platform', ok: true, detail: `${process.platform} ${process.arch}` },
    { name: 'node', ok: true, detail: process.execPath },
    { name: 'cli path', ok: fs.existsSync(CLI_PATH), detail: CLI_PATH },
    { name: 'installed copy', ok: fs.existsSync(path.join(PATHS.installRoot, 'src', 'cli.mjs')), detail: PATHS.installRoot },
    { name: 'agent wrapper', ok: fs.existsSync(PATHS.wrapper), detail: PATHS.wrapper },
    {
      name: IS_WINDOWS ? 'run key' : 'launch agent file',
      ok: IS_WINDOWS || fs.existsSync(PATHS.plist),
      detail: IS_WINDOWS ? PATHS.wrapper : PATHS.plist,
    },
    { name: IS_WINDOWS ? 'run key registered' : 'launch agent loaded', ok: loaded, detail: loaded ? 'yes' : 'no' },
    {
      name: 'daemon',
      ok: Boolean(health?.ok),
      detail: health ? `pid ${health.pid} on ${port}` : `not answering on ${port}`,
    },
    {
      name: 'daemon repairs (last 15 min)',
      ok: daemonProblems.length === 0,
      detail: daemonProblems.at(-1) ?? 'no write failures',
    },
  ];
  for (const [slug, entry] of Object.entries(state.apps)) {
    let detail = 'config missing';
    let ok = false;
    try {
      const map = parseYml(fs.readFileSync(entry.configPath, 'utf8'));
      ok = map.url === feedUrl(port, slug);
      detail = map.url ?? 'no url';
    } catch {
      // keep defaults
    }
    checks.push({ name: `patch ${slug}`, ok, detail });
    checks.push({ name: `app ${slug}`, ok: fs.existsSync(entry.appPath), detail: entry.appPath });
  }
  for (const check of checks) {
    process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}\n`);
  }
  const failed = checks.filter((check) => !check.ok);
  process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;
  switch (command) {
    case 'scan':
      await commandScan(flags);
      break;
    case 'status':
      await commandStatus(flags);
      break;
    case 'freeze':
      await commandFreeze(rest[0], flags);
      break;
    case 'revert':
      await commandRevert(rest[0], flags);
      break;
    case 'repair':
      await commandRepair(flags);
      break;
    case 'agent': {
      const action = rest[0];
      if (action === 'install') {
        const result = await installAgent({ cliPath: CLI_PATH });
        process.stdout.write(
          `${result.changed ? 'installed' : 'already installed'}: ${result.plist ?? result.runKey}\n`,
        );
        process.stdout.write(`wrapper: ${result.wrapper}\n`);
      } else if (action === 'uninstall') {
        const result = await uninstallAgent();
        process.stdout.write(`${result.changed ? 'removed' : 'not installed'}: ${result.plist}\n`);
      } else if (action === 'status') {
        process.stdout.write(`launch agent: ${(await agentLoaded()) ? 'loaded' : 'not loaded'}\n`);
      } else {
        throw new Error('usage: node src/cli.mjs agent <install|uninstall|status>');
      }
      break;
    }
    case 'serve': {
      const state = loadState();
      const port = parsePort(flags.port, state.port ?? DEFAULT_PORT);
      ensureHome();
      const health = await probeDaemon(port);
      if (isOwnDaemonHealth(health, port) && health.pid !== process.pid) {
        appendLog(`daemon already running on ${port} (pid ${health.pid}); exiting`);
        process.stdout.write(`another daemon is already listening on 127.0.0.1:${port}\n`);
        break;
      }
      await runDaemon({ port });
      break;
    }
    case 'hosts':
      commandHosts(rest[0], rest[1]);
      break;
    case 'doctor':
      await commandDoctor();
      break;
    case 'version':
      process.stdout.write(`${VERSION}\n`);
      break;
    case undefined:
    case 'help':
      usage();
      break;
    default:
      usage();
      process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
}
