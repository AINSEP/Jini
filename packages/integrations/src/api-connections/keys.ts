/**
 * @file Opaque connection keys and the generation reader a vault token store fences on.
 *
 * Exists so one function owns the workspace+plugin+connection → key mapping. The key doubles as
 * the public `connectionRef`; percent-encoding each part keeps the mapping injective, and the
 * staged-switch key lives beside it so the same record fences both.
 */
import type { ApiConnectionRecordStore } from './ports.js';

const KEY_PREFIX = 'api-connection:v1:';
const STAGED_SUFFIX = '#staged';

export function deriveApiConnectionKey(requiredArgs: {
  readonly workspaceId: string; readonly pluginId: string; readonly connectionId: string;
}): string {
  const parts = [requiredArgs.workspaceId, requiredArgs.pluginId, requiredArgs.connectionId];
  return KEY_PREFIX + parts.map(part => encodeURIComponent(part)).join(':');
}

/** Token-store key for tokens of a switch-account result awaiting confirmation. */
export function stagedTokenKey(requiredArgs: { readonly key: string }): string {
  return requiredArgs.key + STAGED_SUFFIX;
}

/**
 * Fence reader for a token store: the credential generation of the record owning `key`
 * (the main or staged token key), 0 when no record exists. Generation only ever increases.
 */
export function createApiConnectionGenerationReader(requiredArgs: { readonly records: ApiConnectionRecordStore }) {
  return async function readGeneration({ key }: { readonly key: string }): Promise<number> {
    const recordKey = key.endsWith(STAGED_SUFFIX) ? key.slice(0, -STAGED_SUFFIX.length) : key;
    const record = await requiredArgs.records.read({ key: recordKey });
    return record?.generation ?? 0;
  };
}
