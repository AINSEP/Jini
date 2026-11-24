import type { JsonValue, UUID } from "@jini-ai/core/primitives";
import {
  ensureSettingDefinitions,
  type EnsureSettingDefinitionsDeps,
  type SettingDefinitionSpec,
  getEffective,
  type SettingsRepoPort,
} from "@jini-ai/core/settings";
import { LOCAL_ANALYTICS_SINK_ID } from "../forwarding.js";
import type { AnalyticsConfigPort } from "./ports.js";
import type { AnalyticsSiteConfig } from "../types.js";

/**
 * @file Boot-time `core.analytics.*` setting-definition registration plus the
 * `AnalyticsConfigPort` adapter that reads them back — the ADR-028 wiring
 * `server/app.ts`'s former inline stub named as still-owed ("Real config
 * should be backed by ADR-028 settings once that wiring exists"). Mirrors
 * `assistant/execution-mode-settings.ts`'s shape (definitions + registrar +
 * factory in one file); see that file for the worked example this one
 * follows.
 *
 * OWNER KIND: `core`, not `site`. This is first-party analytics
 * COLLECTION policy (whether/how the operator's own site gathers visitor
 * data) — a platform-level capability, same category as
 * `core.execution.*` — not per-site CONTENT, so `workspaceId: null` at the
 * DEFINITION level (`ensureSettingDefinitions`'s namespace-fence
 * requirement), while `scopes: SCOPE_BIT.workspace` (the shared default)
 * still lets each workspace hold its own VALUE row.
 *
 * NOT the same thing as `core.privacy.telemetry.*`
 * (`Jini packages/core/src/settings/ui-tab-definitions.ts`): that pair is VENDOR
 * telemetry consent (share anonymous usage data with the vendor via a
 * `ForwardingSink`-shaped path) and has no adapter to gate — the host has no
 * outbound telemetry sink at all yet. This namespace is the operator's own
 * first-party visitor analytics (pageviews, the operator's own dashboard),
 * gated on THESE settings, never on vendor consent.
 *
 * `sink` KEY (2026-10-21). Until vendor forwarding existed no `sink` key was
 * registered, deliberately: exposing it would have let an operator select an
 * adapter that cannot be constructed (this project's standing rule against
 * controls that lie about what they do). It lands now together with a
 * constructible path — the keyed `@jini-ai/analytics` forwarder registry and
 * its plugin loader (`.cloud-coord/analytics-DESIGN.md`). `"local"` (default)
 * means the built-in sink only; any other value names a forwarder that
 * receives hits IN ADDITION to the built-in sink, and an id that is not
 * installed falls back to built-in only (fail toward not sending data).
 *
 * ADR-PIPE-008 DISCLOSURE (`Jini packages/core/src/settings/types.ts`'s `SettingValueSchema`
 * doc comment): `{type:"json"}` was, until this file, used exactly once in
 * the codebase (`site.seo.robots_rules`), and that comment plus
 * `execution-mode-settings.ts`'s `localCli.model` comment both said so in
 * the singular. `excludedPaths`/`excludedIpRanges` below are a second and
 * third use — deliberately, not by oversight: both are genuinely
 * unbounded, list-shaped data (path globs / IP ranges) with no scalar
 * decomposition available, the same category `robots_rules` itself is the
 * precedent for, not the "scalar field encoded as JSON to skip
 * decomposition work" pattern the rule exists to block. Both stale
 * "exactly one" comments have been corrected alongside this file landing
 * (see `Jini packages/core/src/settings/types.ts` and `execution-mode-settings.ts`) so no
 * comment in the codebase asserts a count this change makes false. Flagged
 * here for Code Review per ADR-PIPE-008 Enforcement's own instruction.
 */

/** SPEC-007 namespace holding the `core.analytics.*` keys. */
export const ANALYTICS_NAMESPACE = "core.analytics";

type AnalyticsSettingKey =
  | "enabled"
  | "honorDoNotTrack"
  | "honorGlobalPrivacyControl"
  | "rawRetentionDays"
  | "excludedPaths"
  | "excludedIpRanges"
  | "sink";

/** Narrows the shared spec's open `key: string` to this namespace's own key
 *  union, so a typo here is a compile error rather than a definition
 *  registered under a key nothing reads.
 * The 7 registered `core.analytics.*` definitions (`sink` — see this file's
 *  header). Defaults match the values the former `server/app.ts` inline
 *  stub hardcoded, so upgrading to this adapter changes no behavior. */
const ANALYTICS_DEFINITIONS: readonly SettingDefinitionSpec<AnalyticsSettingKey>[] = [
  { key: "enabled", schema: { type: "boolean" }, defaultValue: true },
  { key: "honorDoNotTrack", schema: { type: "boolean" }, defaultValue: true },
  { key: "honorGlobalPrivacyControl", schema: { type: "boolean" }, defaultValue: true },
  { key: "rawRetentionDays", schema: { type: "number" }, defaultValue: 30 },
  { key: "excludedPaths", schema: { type: "json" }, defaultValue: [] },
  { key: "excludedIpRanges", schema: { type: "json" }, defaultValue: [] },
  { key: "sink", schema: { type: "string" }, defaultValue: LOCAL_ANALYTICS_SINK_ID },
];

export type EnsureAnalyticsSettingDefinitionsDeps = EnsureSettingDefinitionsDeps;

export interface EnsureAnalyticsSettingDefinitionsInput {
  /** The trusted boot-time actor these writes are attributed to (mirrors
   *  `execution-mode-settings.ts`'s identical convention). */
  systemPrincipalId: UUID;
}

/**
 * Idempotently registers the 7 `core.analytics.*` definitions. Safe to call
 * on every boot. The skip-if-registered loop, the `ownerKind: "core"` /
 * `workspaceId: null` namespace-fence handling, and the boot-trust shim all
 * live in `Jini packages/core/src/settings/ensure-definitions.ts` — this module owns only
 * the definition list above.
 *
 * @complexity O(1) — 7 definitions, each a skip-if-registered check plus at
 * most one `registerDefinitions` call.
 */
export async function ensureAnalyticsSettingDefinitions(
  deps: EnsureAnalyticsSettingDefinitionsDeps,
  input: EnsureAnalyticsSettingDefinitionsInput
): Promise<void> {
  await ensureSettingDefinitions(deps, {
    namespace: ANALYTICS_NAMESPACE,
    definitions: ANALYTICS_DEFINITIONS,
    systemPrincipalId: input.systemPrincipalId,
  });
}

/**
 * Fallback used ONLY when `getEffective` reports a `core.analytics.*`
 * definition as unregistered (`null`) — per `getEffective`'s own contract
 * (`Jini packages/core/src/settings/settings.ts`) that state means a boot-ordering bug
 * (this file's registrar has not run yet), never an operator choice: an
 * operator can only ever produce a *stored* value, and `getEffective` is
 * total over the stored/workspace/global/default layers once a definition
 * exists. Deliberately re-declared here rather than derived from
 * `ANALYTICS_DEFINITIONS` — `honorDoNotTrack`/`honorGlobalPrivacyControl`
 * are hardcoded `true` regardless of what that array declares, so an
 * unrelated future default-value edit there can never accidentally loosen
 * this fail-safe (fail toward privacy).
 */
const BOOT_ORDERING_FALLBACK: Omit<AnalyticsSiteConfig, "workspaceId"> = {
  enabled: true,
  honorDoNotTrack: true,
  honorGlobalPrivacyControl: true,
  rawRetentionDays: 30,
  excludedPaths: [],
  excludedIpRanges: [],
  sink: LOCAL_ANALYTICS_SINK_ID,
};

/** All 7 keys are registered atomically by `ensureAnalyticsSettingDefinitions`, so a `null`
 *  resolution on ANY of them means the whole namespace is still unregistered (boot ordering — see
 *  `BOOT_ORDERING_FALLBACK`'s doc comment), not a per-field gap. Hoisted into a `.some` scan rather
 *  than a 7-term `||` chain so the caller checks one guard, not a repeated comparison per key. */
function anyEffectiveValueUnregistered({ values }: { values: ReadonlyArray<Awaited<ReturnType<typeof getEffective>>> }, _optional = {}): boolean {
  return values.some((value) => value === null);
}

/** Total narrowing for the two `{type:"json"}` array fields: keeps only
 *  string entries, never casts. A non-array or mixed-type stored value
 *  (should not happen — the ledger schema only accepts a JSON value, not a
 *  shape) degrades to `[]` rather than throwing. */
function toStringArray(value: JsonValue): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** A stored sink id, or the built-in `"local"` for anything that is not a non-blank string. */
function toSinkId(value: JsonValue): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : LOCAL_ANALYTICS_SINK_ID;
}

export interface CreateSettingsAnalyticsConfigDeps {
  settingsRepo: SettingsRepoPort;
}

/**
 * Builds the real `AnalyticsConfigPort` adapter over the settings ledger,
 * replacing `server/app.ts`'s former hardcoded stub. `get()` reads all 7
 * keys via `getEffective` (total, cached, never throws) and recomposes
 * `AnalyticsSiteConfig`; a non-string or blank stored `sink` reads as `"local"`.
 *
 * @complexity O(1) per call — 7 independent, parallel `getEffective` reads
 * (each itself O(1): cached layer lookups, no scan).
 * @overallScore 100
 */
export function createSettingsAnalyticsConfig(deps: CreateSettingsAnalyticsConfigDeps): AnalyticsConfigPort {
  return {
    async get({ workspaceId }): Promise<AnalyticsSiteConfig> {
      const scopeContext = { workspaceId };
      const read = (key: AnalyticsSettingKey) =>
        getEffective({ deps: { repo: deps.settingsRepo }, namespace: ANALYTICS_NAMESPACE, key, scopeContext });

      const resolved = await Promise.all([
        read("enabled"),
        read("honorDoNotTrack"),
        read("honorGlobalPrivacyControl"),
        read("rawRetentionDays"),
        read("excludedPaths"),
        read("excludedIpRanges"),
        read("sink"),
      ]);

      // Fall back together rather than mixing partially-resolved live values with fallback ones —
      // see `anyEffectiveValueUnregistered`'s own doc for why this is a whole-namespace check.
      if (anyEffectiveValueUnregistered({ values: resolved })) {
        return { workspaceId, ...BOOT_ORDERING_FALLBACK };
      }

      // Every element shares the same `getEffective` return type (its shape does not vary by key),
      // and the guard above has just proven none of the 7 is null — narrowed by cast, not by a
      // per-variable `=== null` check, which is exactly the chain `anyEffectiveValueUnregistered`
      // replaced.
      type Resolved = NonNullable<(typeof resolved)[number]>;
      const [enabled, honorDoNotTrack, honorGlobalPrivacyControl, rawRetentionDays, excludedPaths, excludedIpRanges, sink] =
        resolved as [Resolved, Resolved, Resolved, Resolved, Resolved, Resolved, Resolved];

      return {
        workspaceId,
        enabled: enabled.value === true,
        honorDoNotTrack: honorDoNotTrack.value === true,
        honorGlobalPrivacyControl: honorGlobalPrivacyControl.value === true,
        rawRetentionDays:
          typeof rawRetentionDays.value === "number" ? rawRetentionDays.value : BOOT_ORDERING_FALLBACK.rawRetentionDays,
        excludedPaths: toStringArray(excludedPaths.value ?? []),
        excludedIpRanges: toStringArray(excludedIpRanges.value ?? []),
        sink: toSinkId(sink.value),
      };
    },
  };
}
