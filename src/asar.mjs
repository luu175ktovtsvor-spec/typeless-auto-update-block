import fs from 'node:fs';

/**
 * Read the `version` field from package.json inside an Electron app.asar.
 * Used where Info.plist / exe metadata is unavailable (Windows installs).
 */
export function readAsarPackage(asarPath) {
  let fd;
  try {
    fd = fs.openSync(asarPath, 'r');
    const prefix = Buffer.alloc(16);
    fs.readSync(fd, prefix, 0, 16, 0);
    const headerSize = prefix.readUInt32LE(12);
    if (!headerSize || headerSize <= 0) return null;
    const headerBuffer = Buffer.alloc(headerSize);
    fs.readSync(fd, headerBuffer, 0, headerSize, 16);
    const header = JSON.parse(headerBuffer.toString('utf8'));
    const entry = header?.files?.['package.json'];
    if (!entry || entry.offset === undefined || entry.size === undefined) return null;
    const size = Number(entry.size);
    const offset = Number(entry.offset);
    if (!Number.isFinite(size) || !Number.isFinite(offset)) return null;
    const dataStart = 16 + headerSize;
    // Read a little extra: some builders pad entries with NUL/BOM bytes, which
    // shifts the payload by one byte relative to the recorded offset/size.
    const buffer = Buffer.alloc(size + 16);
    const read = fs.readSync(fd, buffer, 0, size + 16, dataStart + offset);
    return parseJsonWindow(buffer.subarray(0, read).toString('utf8'));
  } catch (error) {
    if (process.env.UPDATE_FREEZE_DEBUG) process.stderr.write(`asar read failed: ${error.message}\n`);
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function readAsarVersion(asarPath) {
  return readAsarPackage(asarPath)?.version ?? null;
}

function parseJsonWindow(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const tail = text.slice(start);
  const maxTrim = Math.min(tail.length, 512);
  for (let cut = 0; cut <= maxTrim; cut += 1) {
    const end = tail.length - cut;
    if (tail[end - 1] !== '}') continue;
    try {
      return JSON.parse(tail.slice(0, end));
    } catch {
      // keep trimming towards the last complete object
    }
  }
  return null;
}
