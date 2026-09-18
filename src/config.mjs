const TOP_LEVEL_KEY = /^([A-Za-z0-9_.-]+):\s*(.*)$/;

/**
 * Minimal reader for the flat `key: value` files electron-builder writes
 * (app-update.yml). Nested structures are irrelevant for update-freezing.
 */
export function parseYml(text) {
  const map = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s/.test(line) || line.startsWith('#')) continue;
    const match = TOP_LEVEL_KEY.exec(line);
    if (match) map[match[1]] = match[2].trim();
  }
  return map;
}

export function getYmlValue(text, key) {
  return parseYml(text)[key] ?? null;
}

/**
 * Replace one top-level key, byte-preserving every other line. The caller
 * verifies that nothing else changed before writing the file back.
 */
export function setYmlValue(text, key, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let replaced = false;
  const out = lines.map((line) => {
    if (replaced) return line;
    const match = TOP_LEVEL_KEY.exec(line);
    if (match && match[1] === key) {
      replaced = true;
      return `${key}: ${value}`;
    }
    return line;
  });
  if (replaced) return out.join(eol);
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  out.push(`${key}: ${value}`, '');
  return out.join(eol);
}

/** Placeholder checksum — never used, because the served version is never newer. */
const PLACEHOLDER_SHA512 = `${'A'.repeat(86)}==`;

export function stubYml({ version, artifactName }) {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${artifactName}`,
    `    sha512: ${PLACEHOLDER_SHA512}`,
    '    size: 0',
    `path: ${artifactName}`,
    `sha512: ${PLACEHOLDER_SHA512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');
}

export function feedUrl(port, slug) {
  return `http://127.0.0.1:${port}/${slug}/`;
}

export function slugFor(bundleId, appPath) {
  const base = bundleId || (appPath ? appPath.replace(/\\/g, '/').split('/').pop()?.replace(/\.app$/, '') : '') || 'app';
  return base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}
