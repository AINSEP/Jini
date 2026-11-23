import type { UUID } from "@jini-ai/core/primitives";
import { ensureSettingDefinitions, getEffective, SCOPE_BIT, type EnsureSettingDefinitionsDeps, type SettingsRepoPort } from "@jini-ai/core/settings";
import { DEFAULT_SITE_TIME_ZONE, normalizeTimeZone, type SiteTimeZonePort } from "../../widgets/date-label.js";

/**
 * @file Bug D (2026-10-22): `core.site.timezone`, the IANA zone public pages format post dates in.
 * Dates rendered server-side in UTC showed the day after a post's real date for any site west of UTC
 * that published in the evening (and the day before for one east of it publishing early). Static
 * pages carry no JavaScript to correct that, so the zone is a site setting the render reads.
 *
 * Tiers, in order (same "only a workspace-layer value is the owner's choice" rule as
 * `core.site.title`): the owner's workspace value; the zone detected when the site was created
 * (`config.json` `timezone`, written by `init-site.ts`); the server's local zone. An invalid value at
 * any tier falls to the next. A WordPress import sets the owner value from the source site's `timezone_string`
 * through `settings_set_value` (see the `site-import` skill). Stored post instants never shift.
 *
 * `ownerKind: "core"` and the platform-wide definition are forced by the settings namespace fence for
 * `core.*`, exactly as for `core.site.title`; values stay per-workspace through `SCOPE_BIT.workspace`.
 */

export const SITE_TIMEZONE_NAMESPACE = "core.site";
export const SITE_TIMEZONE_KEY = "timezone";

/**
 * Idempotently registers `core.site.timezone` (default UTC). Safe on every boot.
 * @complexity O(1), one definition.
 */
export async function ensureSiteTimeZoneSettingDefinition(
  deps: EnsureSettingDefinitionsDeps,
  input: { systemPrincipalId: UUID }
): Promise<void> {
  await ensureSettingDefinitions(deps, {
    namespace: SITE_TIMEZONE_NAMESPACE,
    definitions: [{ key: SITE_TIMEZONE_KEY, schema: { type: "string" }, defaultValue: DEFAULT_SITE_TIME_ZONE, scopes: SCOPE_BIT.workspace }],
    systemPrincipalId: input.systemPrincipalId,
  });
}

/** The zone detected where the site was created, read when a render needs it. Should not throw. */
export interface SiteCreationTimeZoneSource {
  read(): string | undefined;
}

/** The fixed text a failed settings read is reported with. Never interpolates the error. */
export const SITE_TIME_ZONE_FALLBACK_MESSAGE = "resolveSiteTimeZone: settings read failed; using the creation zone";

/**
 * What a failed settings read reports: fixed text plus safe structured fields. The error's own
 * message is never carried, since a repository error can echo a connection string or a stored value.
 */
export interface SiteTimeZoneFallbackEvent {
  readonly message: typeof SITE_TIME_ZONE_FALLBACK_MESSAGE;
  readonly workspaceId: UUID;
  /** The thrown value's class name when it is a plain identifier, else `"Unknown"`. */
  readonly errorClass: string;
}

/** Host-bound sink for {@link SiteTimeZoneFallbackEvent} (its logger, metrics, or both). Should not throw. */
export type SiteTimeZoneFallbackReporter = (event: SiteTimeZoneFallbackEvent) => void;

export interface ResolveSiteTimeZoneDeps {
  settingsRepo: SettingsRepoPort;
  /** Told when a settings read failed and the creation zone was used instead. */
  reportFallback: SiteTimeZoneFallbackReporter;
  /** Absent (in-memory boots, no site directory) means the server's local zone is the last tier. */
  creationTimeZone?: SiteCreationTimeZoneSource;
}

/** `value` trimmed when `Intl` accepts it (an explicit "UTC" included), else undefined. */
function validTimeZone({ value }: { value: unknown }, _optional = {}): string | undefined {
  if (typeof value !== "string") return undefined;
  const zone = normalizeTimeZone({ timeZone: value });
  // `normalizeTimeZone` returns the trimmed input only for a valid zone; anything else became UTC.
  return zone === value.trim() ? zone : undefined;
}

/** The creation zone when valid, else the server's local zone. */
function creationOrDefault(deps: ResolveSiteTimeZoneDeps): string {
  // Legacy sites have no recorded zone. Pin the server's local zone before shared rendering so
  // article markers, Liquid workers and static exports all use the same calendar day.
  return validTimeZone({ value: deps.creationTimeZone?.read() }) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]{0,63}$/;

/** A thrown value's class name, only when it is a plain identifier (never the error's message). */
function errorClassOf({ err }: { err: unknown }, _optional: Record<string, never> = {}): string {
  const name: unknown = err instanceof Error ? err.constructor.name : undefined;
  return typeof name === "string" && IDENTIFIER.test(name) ? name : "Unknown";
}

/** A usable owner value: a workspace-layer string `Intl` accepts. */
function ownerTimeZone({ resolved }: { resolved: { sourceLayer: string; value: unknown } | null }, _optional = {}): string | undefined {
  return resolved?.sourceLayer === "workspace" ? validTimeZone({ value: resolved.value }) : undefined;
}

/**
 * The zone a public render formats `workspaceId`'s dates in. Reads without a principal, so the user
 * layer never applies. Never throws: a failed settings read is reported (fixed text, no error
 * message) and uses the creation zone.
 * @complexity One settings read.
 */
export async function resolveSiteTimeZone(deps: ResolveSiteTimeZoneDeps, input: { workspaceId: UUID }): Promise<string> {
  try {
    const resolved = await getEffective(
      { deps: { repo: deps.settingsRepo }, namespace: SITE_TIMEZONE_NAMESPACE, key: SITE_TIMEZONE_KEY, scopeContext: { workspaceId: input.workspaceId } },
    );
    return ownerTimeZone({ resolved }) ?? creationOrDefault(deps);
  } catch (err) {
    deps.reportFallback({ message: SITE_TIME_ZONE_FALLBACK_MESSAGE, workspaceId: input.workspaceId, errorClass: errorClassOf({ err }) });
    return creationOrDefault(deps);
  }
}

/** {@link resolveSiteTimeZone} as the `SiteTimeZonePort` the Jini render resolvers take. */
export function createSiteTimeZonePort(deps: ResolveSiteTimeZoneDeps): SiteTimeZonePort {
  return { resolveTimeZone: (required) => resolveSiteTimeZone(deps, required) };
}
