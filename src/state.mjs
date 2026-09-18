import { PATHS, readJson, writeJsonAtomic, ensureHome } from './util.mjs';

export function loadState() {
  const state = readJson(PATHS.state, null);
  if (!state || typeof state !== 'object') {
    return { schema: 1, port: null, apps: {} };
  }
  state.schema ??= 1;
  state.port ??= null;
  state.apps ??= {};
  return state;
}

export function saveState(state) {
  ensureHome();
  writeJsonAtomic(PATHS.state, state);
}
