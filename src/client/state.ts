import type { Config, KeyList, Manifest } from "../core/types.ts";

export interface ClientState {
  last_config_version: number;
  last_list_sequence: number;
  cached_manifest: Manifest | null;
  cached_config: Config | null;
  cached_key_list: KeyList | null;
}

const DEFAULT_STATE: ClientState = {
  last_config_version: 0,
  last_list_sequence: 0,
  cached_manifest: null,
  cached_config: null,
  cached_key_list: null,
};

export function createDefaultState(): ClientState {
  return { ...DEFAULT_STATE };
}

export async function loadState(path: string): Promise<ClientState> {
  try {
    const file = Bun.file(path);
    const exists = await file.exists();
    if (!exists) {
      return createDefaultState();
    }
    const text = await file.text();
    const parsed = JSON.parse(text);
    return validateStateShape(parsed);
  } catch {
    // Corruption or invalid JSON — reset to defaults
    return createDefaultState();
  }
}

export async function saveState(path: string, state: ClientState): Promise<void> {
  const json = JSON.stringify(state, null, 2);
  await Bun.write(path, json);
}

function validateStateShape(data: unknown): ClientState {
  if (typeof data !== "object" || data === null) {
    return createDefaultState();
  }
  const obj = data as Record<string, unknown>;

  const lastConfigVersion =
    typeof obj.last_config_version === "number" && Number.isFinite(obj.last_config_version)
      ? obj.last_config_version
      : 0;

  const lastListSequence =
    typeof obj.last_list_sequence === "number" && Number.isFinite(obj.last_list_sequence)
      ? obj.last_list_sequence
      : 0;

  const cachedManifest =
    typeof obj.cached_manifest === "object" && obj.cached_manifest !== null
      ? (obj.cached_manifest as Manifest)
      : null;

  const cachedConfig =
    typeof obj.cached_config === "object" && obj.cached_config !== null
      ? (obj.cached_config as Config)
      : null;

  const cachedKeyList =
    typeof obj.cached_key_list === "object" && obj.cached_key_list !== null
      ? (obj.cached_key_list as KeyList)
      : null;

  return {
    last_config_version: lastConfigVersion,
    last_list_sequence: lastListSequence,
    cached_manifest: cachedManifest,
    cached_config: cachedConfig,
    cached_key_list: cachedKeyList,
  };
}
