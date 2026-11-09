/**
 * @file `toAdminPluginResponse()` — DTO mapping for the admin plugin list / set-enabled wire shape
 * (SPEC-005 REQ-10, api.spec.md §5; C-017).
 *
 * Purpose:
 * Projects a `PluginDiscoveryRecord` plus its (possibly absent) `PluginActivationRecord` into the
 * exact `api.spec.md` §5 wire shape — `enabled` is the one field discovery itself does not know
 * (state.spec.md §2: "enabled: boolean # projected from plugin_activations"); this function is
 * where that projection happens (discovery.ts stays activation-ignorant by design).
 *
 * Architectural role:
 * TDD-certified implementation (implementation outline C-017). `toAdminPluginResponse()` is a pure
 * projection — no I/O — that folds discovery's `tier`/`status`/`errors` with activation's
 * `enabled`/quarantine fields into the wire envelope. Routes, authorization and transport stay
 * with the host.
 */
import type { PluginActivationRecord } from "./activation.js";
import type { PluginDiscoveryRecord } from "./discovery-types.js";
import type { PluginConflict } from "./plugin-claims.js";

/**
 * api.spec.md §5 per-plugin admin wire shape.
 *
 * @agent-note Key order is the serialized wire order; a host must send this object as returned
 * (no re-keying) so saved/compared bytes stay identical.
 */
export interface AdminPluginEnvelope {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly source: "built-in" | "site";
  /** (1.1.2, REQ-10/REQ-18) Projected verbatim from `PluginDiscoveryRecord.tier`, itself projected
   * verbatim from the plugin's already-required `PluginManifest.tier` (REQ-01/ADR-024 §1) — the
   * same additive-field mechanism REQ-10's revision note describes ("mirroring how `enabled` is
   * already projected"). Required at this wire-contract layer (api.spec.md §5 lists it as a plain,
   * always-present field, consumed by REQ-18's per-row badge, AC-26).
   *
   * @agent-note A record without a tier is reported as `"tier-3"`. */
  readonly tier: "tier-1" | "tier-2" | "tier-3";
  readonly status: "valid" | "invalid" | "incompatible";
  /** @agent-note Projected from the activation record; an absent record means disabled. */
  readonly enabled: boolean;
  /** @agent-note Non-null only when the activation record carries all three quarantine fields. */
  readonly quarantine: null | {
    readonly at: string;
    readonly reason: string;
    readonly consecutiveFailures: number;
  };
  readonly errors: readonly { code: string; file: string | null; message: string }[];
  /** (2026-10-04) Names this plugin claims that core or an earlier-enabled plugin already holds —
   * for an enabled plugin, why it was refused; for one that is off, what turning it on would hit.
   * Always present (empty when clear), so the admin row and the list tool need no absent case.
   *
   * @agent-note The host supplies this plugin's own conflict entry (for example from
   * `listPluginConflicts()`); omitted means none. */
  readonly conflicts: readonly PluginConflict[];
  /** (2026-10-26) Present (true) only when the plugin's manifest declares provider settings — the
   * host's admin row then offers its settings card. Absent otherwise.
   *
   * @agent-note Absent rather than `false`; hosts must not add the key themselves. */
  readonly providerSettings?: true;
}

/**
 * Required inputs of {@link toAdminPluginResponse}.
 *
 * @agent-note Both records belong to the same plugin id; the host reads them (one discovery pass,
 * one activation read) and this function never re-reads either.
 */
export interface ToAdminPluginResponseRequired {
  /** One plugin's discovery-time record (source/status/errors). */
  readonly discovery: PluginDiscoveryRecord;
  /** That plugin's persisted activation row, or `null` when it has never been enabled (treated as
   * disabled — `enabled: false`, not an error). */
  readonly activation: PluginActivationRecord | null;
}

/** Optional inputs of {@link toAdminPluginResponse}. */
export interface ToAdminPluginResponseOptional {
  /** This plugin's entry from `listPluginConflicts()`, if any. */
  readonly conflicts?: readonly PluginConflict[];
}

/**
 * Projects one discovery record + its (possibly absent, meaning "never enabled") activation
 * record into the wire shape. Pure — no I/O.
 *
 * @agent-note Pure and synchronous: no I/O, no shared state, safe per call from any host route or
 * agent tool. Never throws for a well-typed input. The host owns the route, authorization and
 * transport; this function only shapes the envelope.
 */
export function toAdminPluginResponse(
  required: ToAdminPluginResponseRequired,
  optional: ToAdminPluginResponseOptional = {}
): AdminPluginEnvelope {
  const { discovery, activation } = required;
  return {
    id: discovery.id,
    name: discovery.name,
    version: discovery.version,
    source: discovery.source,
    tier: (discovery.tier ?? "tier-3") as AdminPluginEnvelope["tier"],
    status: discovery.status,
    enabled: activation?.enabled ?? false,
    quarantine: quarantineResponse({ activation }),
    errors: discovery.errors,
    conflicts: optional.conflicts ?? [],
    ...((discovery.manifest?.contributes?.providers ?? []).some((provider) => (provider.settings?.length ?? 0) > 0) ? { providerSettings: true as const } : {}),
  };
}

/** Partial activation metadata is not a quarantine in the admin wire contract. */
function quarantineResponse({ activation }: { activation: PluginActivationRecord | null }, _options = {}): AdminPluginEnvelope["quarantine"] {
  if (activation?.quarantinedAt !== undefined && activation.quarantineReason !== undefined && activation.quarantineFailureCount !== undefined) {
    return { at: activation.quarantinedAt, reason: activation.quarantineReason, consecutiveFailures: activation.quarantineFailureCount };
  }
  return null;
}
