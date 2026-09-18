import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const execFileAsync = promisify(execFile);

export const HOME_DIR = process.env.TYPELESS_AUTO_UPDATE_BLOCK_HOME
  ? path.resolve(process.env.TYPELESS_AUTO_UPDATE_BLOCK_HOME)
  : path.join(os.homedir(), '.typeless-auto-update-block');

export const PATHS = {
  home: HOME_DIR,
  backups: path.join(HOME_DIR, 'backups'),
  logs: path.join(HOME_DIR, 'logs'),
  state: path.join(HOME_DIR, 'state.json'),
  log: path.join(HOME_DIR, 'logs', 'agent.log'),
  pid: path.join(HOME_DIR, 'agent.pid'),
  installRoot: path.join(HOME_DIR, 'app'),
  binDir: path.join(HOME_DIR, 'bin'),
  wrapper: path.join(HOME_DIR, 'bin', process.platform === 'win32' ? 'typeless-auto-update-block-agent.cmd' : 'typeless-auto-update-block-agent.sh'),
  plist: path.join(os.homedir(), 'Library', 'LaunchAgents', 'io.typeless-auto-update-block.agent.plist'),
};

export const AGENT_LABEL = 'io.typeless-auto-update-block.agent';
export const DEFAULT_PORT = 47821;
export const MAX_LOG_BYTES = 2 * 1024 * 1024;
export const IS_MAC = process.platform === 'darwin';
export const IS_WINDOWS = process.platform === 'win32';

/** Candidate node binaries, used by the generated launch wrapper. */
export const NODE_CANDIDATES = [
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
  path.join(os.homedir(), '.local', 'bin', 'node'),
  '/usr/bin/node',
];

export function ensureHome() {
  for (const dir of [PATHS.home, PATHS.backups, PATHS.logs]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function appendLog(message, { file = PATHS.log, echo = false } = {}) {
  const line = `${new Date().toISOString()} ${message}`;
  if (echo) process.stdout.write(`${line}\n`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    // logging must never break the daemon
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function plistRaw(plistPath, key) {
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/plutil',
      ['-extract', key, 'raw', '-o', '-', plistPath],
      { timeout: 5000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export function expandHome(input) {
  if (!input) return input;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function dirSize(dir) {
  let total = 0;
  let entries = 0;
  const walk = (current) => {
    let list;
    try {
      list = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of list) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) walk(full);
      else {
        try {
          total += fs.statSync(full).size;
          entries += 1;
        } catch {
          // ignore vanished files
        }
      }
    }
  };
  walk(dir);
  return { bytes: total, entries };
}

export function copyTree(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.cpSync(source, target, { recursive: true, dereference: true });
}

export function pathIsWritable(target) {
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function windowsPaths(env = process.env) {
  const localAppData = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const appData = env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  const programFiles = env['ProgramFiles'] ?? 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  return {
    localAppData,
    appData,
    appDirs: [
      path.join(localAppData, 'Programs'),
      programFiles,
      programFilesX86,
    ],
    startupDir: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
    runKey: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  };
}
