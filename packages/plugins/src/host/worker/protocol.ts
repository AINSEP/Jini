/**
 * @file The Tier-2 plugin ABI wire protocol (ADR-024 §3/§4): what the server sends a fresh worker
 * for one call, and what the worker replies. Both directions are structured-clone-only data — no
 * functions, no class instances, no live core objects — because they cross a `worker_threads`
 * boundary, and because the same messages must later cross a real process sandbox unchanged.
 *
 * One request = one fresh worker: import the plugin, run `setup()` against a fresh
 * capability-scoped SDK, then either report which hooks it attached (`probe`, run once at enable
 * time) or run its beforeSave filter on one entry (`beforeSave`, run per save/preview).
 */
import type { ContentEntryDraft, HookContext } from "../ports.js";

import type { PluginCapability } from "../manifest.js";

/** Everything the worker needs to know about the plugin — taken from the already-validated
 * manifest on the server side; the worker never reads a manifest itself. */
export interface Tier2PluginRef {
  readonly pluginId: string;
  /** Absolute file path or `file:` URL of the code the worker imports (a site plugin's integrity-
   * checked module snapshot, a built-in's own file). */
  readonly entryPath: string;
  readonly capabilities: readonly PluginCapability[];
  readonly hooks: readonly string[];
}

export type Tier2Request =
  | { readonly kind: "probe"; readonly plugin: Tier2PluginRef }
  | {
      readonly kind: "beforeSave";
      readonly plugin: Tier2PluginRef;
      readonly entry: Readonly<ContentEntryDraft>;
      readonly ctx: HookContext;
    };

/** Where a failed call stopped. `import` and `export` map to `loadPlugin()`'s `CODE_ENTRY_MISSING`
 * and `PLUGIN_EXPORT_INVALID`, `setup` to `PLUGIN_SETUP_FAILED`, `hook` to a failed filter run. */
export type Tier2FailureStage = "import" | "export" | "setup" | "hook";

export type Tier2Reply =
  | { readonly ok: true; readonly kind: "probe"; readonly hooks: readonly string[] }
  | { readonly ok: true; readonly kind: "beforeSave"; readonly patch: unknown }
  | { readonly ok: false; readonly stage: Tier2FailureStage; readonly error: string };

/** Runs one Tier-2 request somewhere isolated and resolves to the worker's reply. Rejects on a
 * transport failure (timeout, crash, heap limit, malformed reply). */
export type Tier2CallRunner = (request: Tier2Request) => Promise<Tier2Reply>;

const FAILURE_STAGES: ReadonlySet<string> = new Set<Tier2FailureStage>(["import", "export", "setup", "hook"]);

function invalidReply(): Error {
  return new Error("invalid tier-2 worker reply");
}

/**
 * Validates an untrusted worker message as the reply to a request of `expectedKind`. The worker
 * runs plugin code, so its message is checked like any other external input.
 *
 * @throws Error `invalid tier-2 worker reply` for any other shape, or a success of the wrong kind.
 * @complexity O(h) for h reported hook names.
 */
export function decodeTier2Reply(
  { message, expectedKind }: { message: unknown; expectedKind: Tier2Request["kind"] },
  _optional: Record<string, never> = {},
): Tier2Reply {
  if (typeof message !== "object" || message === null) throw invalidReply();
  const reply = message as Record<string, unknown>;
  if (reply.ok === false) {
    if (typeof reply.stage !== "string" || !FAILURE_STAGES.has(reply.stage) || typeof reply.error !== "string") {
      throw invalidReply();
    }
    return { ok: false, stage: reply.stage as Tier2FailureStage, error: reply.error };
  }
  if (reply.ok !== true || reply.kind !== expectedKind) throw invalidReply();
  if (expectedKind === "beforeSave") return { ok: true, kind: "beforeSave", patch: reply.patch };
  const { hooks } = reply;
  if (!Array.isArray(hooks) || !hooks.every((hook) => typeof hook === "string")) throw invalidReply();
  return { ok: true, kind: "probe", hooks };
}
