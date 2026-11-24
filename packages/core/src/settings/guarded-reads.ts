import type { JsonValue } from "../primitives/index.js";
import type { SettingsRepoPort } from "./ports.js";
import { resolveDefinitionRaw, type getEffective, type ResolvedSetting } from "./settings.js";
import type { SettingScopeContext } from "./types.js";

/**
 * @file Host-facing read policies over the settings ledger that security-relevant readers share:
 * a fail-closed effective read and a raw read of one principal's own user layer. Hosts supply the
 * namespace, key, refusal copy and projection; nothing here knows a product's settings.
 */

/** Read-failure policy: HTTP readers propagate the error so a UI can show "unknown"; launch-time
 * readers deny and log the host's safe diagnostic. */
export interface FailClosedReadOptions {
  readFailure?: "deny" | "throw";
}

/**
 * Resolve one effective setting and project it, denying on any failure. The ledger is read fresh
 * on every call because another process may have changed a grant since the last read.
 * @param required.getEffective The host's `getEffective` (injected so hosts avoid module cycles).
 * @param required.project Maps the resolved setting (null when undefined) to the caller's value;
 * a throw here is treated exactly like a storage failure.
 * @param required.denied Lazily builds the refusal value returned after a denied failure.
 * @param required.deniedWarning The host's safe diagnostic, logged instead of the error.
 * @throws the original error unchanged when `readFailure` is "throw".
 * @complexity O(1) settings resolutions plus the projection's own cost.
 */
export async function readEffectiveFailClosed<T>(required: {
  settingsRepo: SettingsRepoPort; getEffective: typeof getEffective; settingsReady: Promise<void>;
  namespace: string; key: string; scopeContext: SettingScopeContext;
  project: (required: { setting: ResolvedSetting | null }) => T | Promise<T>;
  denied: () => T; deniedWarning: string; warn: (message: string) => void;
}, optional: FailClosedReadOptions = {}): Promise<T> {
  try {
    await required.settingsReady;
    const setting = await required.getEffective({ deps: { repo: required.settingsRepo }, namespace: required.namespace,
      key: required.key, scopeContext: required.scopeContext });
    return await required.project({ setting });
  } catch (error) {
    if (optional.readFailure === "throw") throw error;
    // Storage exceptions may contain sensitive values; never copy them into daemon logs.
    required.warn(required.deniedWarning);
    return required.denied();
  }
}

/**
 * Read the addressed principal's own user-layer object, preserving fields an effective projection
 * omits, so a read-modify-write patch never drops sibling entries. A cleared, missing or non-object
 * row reads as `{}` with revision 0.
 * @throws Error(notReadyMessage) when the definition is not registered yet.
 * @complexity O(1) — one definition read and one user-layer read.
 */
export async function readUserLayerObject(required: {
  settingsRepo: SettingsRepoPort; namespace: string; key: string; workspaceId: string; principalId: string;
  notReadyMessage: string;
}, _optional: Record<string, never> = {}): Promise<{ raw: Record<string, JsonValue>; revisionSeq: number }> {
  const definition = await resolveDefinitionRaw({ repo: required.settingsRepo }, {
    namespace: required.namespace, key: required.key, workspaceId: required.workspaceId,
  });
  if (!definition) throw new Error(required.notReadyMessage);
  const row = await required.settingsRepo.getUserValue({ workspaceId: required.workspaceId, principalId: required.principalId, settingId: definition.settingId });
  const value = row?.state === "set" ? row.valueJson : null;
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { raw, revisionSeq: row?.seq ?? 0 };
}
