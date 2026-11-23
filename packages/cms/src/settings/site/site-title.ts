import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { JsonValue, UUID } from "@jini-ai/core/primitives";
// The ledger's functions arrive through the deps (`EnsureSettingDefinitionsPort`, `GetEffectivePort`,
// `PreserveLegacySiteTitlesDeps.set`/`resolveDefinitionRaw`), never through a module import, so the
// host binds the implementation at composition and a test can hand in a spy.
import {
  SCOPE_BIT,
  type AuthorizeFn,
  type EnsureSettingDefinitionsDeps,
  type EnsureSettingDefinitionsPort,
  type GetEffectivePort,
  type resolveDefinitionRaw,
  type set,
  type SettingsRepoPort,
} from "@jini-ai/core/settings";

/**
 * @file SPEC-050 (`core.site.title`): the public site title as a per-workspace setting, the one
 * resolver every render call site reads it through (REQ-02), and the one-time pin that keeps every
 * site that existed before this setting on the title it always rendered (REQ-06).
 *
 * The "no owner-set title" value has two tiers (NC-1 = A):
 * - A workspace the marker migration recorded as pre-existing (NC-3 = A) is pinned to
 *   the host's legacy title (`legacySiteTitle`) at the workspace layer, through the settings chokepoint. Until that pin
 *   lands the workspace is pending, and renders the legacy title anyway (REQ-07).
 * - Every other workspace renders the site display name: `config.json` `name`, else
 *   `workspaces.name` when there is no site directory (NC-2 = B).
 *
 * Only a workspace-layer value counts as a title. The definition default stays the legacy literal,
 * and a default-layer read means "no owner-set title".
 *
 * The legacy title itself is product copy, so the host supplies it through the existing args:
 * `legacySiteTitle` on {@link EnsureSiteTitleSettingDefinitionInput} (the stored default), on
 * {@link PreserveLegacySiteTitlesInput} (the workspace pin), and on {@link ResolveSiteTitleDeps} (the
 * render fallback). All three must be the same value the host's sites rendered before the setting.
 *
 * `ownerKind: "core"` is forced, not chosen. The settings namespace fence (`@jini-ai/core/settings`
 * `NAMESPACE_FENCE`) admits a `core.*` namespace only for a core definition, and requires such a
 * definition to be platform-wide (`workspaceId: null`). Its VALUES stay per-workspace through
 * `scopes: SCOPE_BIT.workspace`, which is REQ-01's shape.
 */

export const SITE_TITLE_NAMESPACE = "core.site";
export const SITE_TITLE_KEY = "title";

/** REQ-08's upper bound, mirroring `init-site.ts`'s limit for site display names. */
export const SITE_TITLE_MAX_LENGTH = 200;

export interface EnsureSiteTitleSettingDefinitionInput {
  /** The trusted boot-time actor the registration is attributed to (same convention as every other boot registrar). */
  systemPrincipalId: UUID;
  /** The title every site rendered before this setting existed; stored as the definition default. */
  legacySiteTitle: string;
}

/**
 * Idempotently registers the `core.site.title` definition. Safe to call on every boot:
 * `ensureSettingDefinitions` skips a registered definition and reconciles a changed core default.
 *
 * @complexity O(1), one definition.
 */
export async function ensureSiteTitleSettingDefinition(
  deps: EnsureSettingDefinitionsDeps & EnsureSettingDefinitionsPort,
  input: EnsureSiteTitleSettingDefinitionInput
): Promise<void> {
  await deps.ensureSettingDefinitions(deps, {
    namespace: SITE_TITLE_NAMESPACE,
    definitions: [
      { key: SITE_TITLE_KEY, schema: { type: "string" }, defaultValue: input.legacySiteTitle, scopes: SCOPE_BIT.workspace },
    ],
    systemPrincipalId: input.systemPrincipalId,
  });
}

/**
 * The renderable form of a stored title or name: trimmed, 1..{@link SITE_TITLE_MAX_LENGTH}
 * characters. Anything else is `undefined`, so a caller falls back instead of rendering an empty or
 * unbounded `<title>` (REQ-08, REQ-09, INV-04). Pure.
 *
 * @complexity O(n) in the value's length.
 */
export function normalizeSiteTitle({ value }: { value: JsonValue | undefined }, _optional = {}): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= SITE_TITLE_MAX_LENGTH ? trimmed : undefined;
}

/**
 * The pre-existing-workspace marker (REQ-06, NC-3 = A). A workspace is recorded once, by the schema
 * migration, and stays pending until the pin writes or skips it. The SQLite adapter reads the
 * migration's table; the in-memory composition root has no pre-existing workspaces (EC-03).
 */
export interface SiteTitlePreservationStorePort {
  /** Recorded workspaces whose pin has not landed yet, sorted by id. */
  listPendingWorkspaceIds(): Promise<UUID[]>;
  /** True only for a recorded workspace whose pin has not landed yet. */
  isPending(required: { workspaceId: UUID }, optional?: Record<string, never>): Promise<boolean>;
  /** Resolves one pending workspace. A no-op for an unrecorded or already resolved id. */
  markPreserved(required: { workspaceId: UUID; preservedAt: string }): Promise<void>;
}

/** {@link SiteTitlePreservationStorePort} over a process-local set. */
export class InMemorySiteTitlePreservationStore implements SiteTitlePreservationStorePort {
  private readonly pending: Set<UUID>;

  constructor(pendingWorkspaceIds: readonly UUID[] = []) {
    this.pending = new Set(pendingWorkspaceIds);
  }

  async listPendingWorkspaceIds(): Promise<UUID[]> {
    return [...this.pending].sort();
  }

  async isPending({ workspaceId }: { workspaceId: UUID }, _optional = {}): Promise<boolean> {
    return this.pending.has(workspaceId);
  }

  async markPreserved(required: { workspaceId: UUID; preservedAt: string }): Promise<void> {
    this.pending.delete(required.workspaceId);
  }
}

/** Fixed text for a pin write that threw. Never interpolates the error. */
export const SITE_TITLE_PIN_FAILED_MESSAGE = "preserveLegacySiteTitles: workspace stays pending, pin failed";
/** Fixed text for a pin skipped because `core.site.title` is not registered yet. */
export const SITE_TITLE_PIN_UNREGISTERED_MESSAGE = "preserveLegacySiteTitles: workspace stays pending, pin failed: core.site/title is not registered";
/** Fixed text for a render read that threw and fell back to the legacy title. Never interpolates the error. */
export const SITE_TITLE_RENDER_FALLBACK_MESSAGE = "resolveSiteTitle: falling back to the legacy title";

/**
 * What a site-title failure reports: fixed text plus safe structured fields. The error's own message
 * is never carried, since a repository error can echo a connection string or a stored value.
 */
export interface SiteTitleFailureEvent {
  readonly message: typeof SITE_TITLE_PIN_FAILED_MESSAGE | typeof SITE_TITLE_PIN_UNREGISTERED_MESSAGE | typeof SITE_TITLE_RENDER_FALLBACK_MESSAGE;
  readonly workspaceId: UUID;
  /** The thrown value's class name when it is a plain identifier, else `"Unknown"`. Absent when nothing was thrown. */
  readonly errorClass?: string;
}

/** Host-bound sink for {@link SiteTitleFailureEvent} (its logger, metrics, or both). Should not throw. */
export type SiteTitleFailureReporter = (event: SiteTitleFailureEvent) => void;

/** Host-bound sink for one {@link preserveLegacySiteTitles} run's counts. Should not throw. */
export type SiteTitlePreservationSummaryReporter = (result: PreserveLegacySiteTitlesResult) => void;

const IDENTIFIER = /^[A-Za-z_$][\w$]{0,63}$/;

/** A thrown value's class name, only when it is a plain identifier (never the error's message). */
function errorClassOf({ err }: { err: unknown }, _optional: Record<string, never> = {}): string {
  const name: unknown = err instanceof Error ? err.constructor.name : undefined;
  return typeof name === "string" && IDENTIFIER.test(name) ? name : "Unknown";
}

export interface PreserveLegacySiteTitlesDeps extends EnsureSettingDefinitionsDeps {
  preservationStore: SiteTitlePreservationStorePort;
  /** The settings ledger's chokepoint write (`@jini-ai/core/settings` `set`), bound by the host. */
  set: typeof set;
  /** The settings ledger's definition lookup (`@jini-ai/core/settings` `resolveDefinitionRaw`), bound by the host. */
  resolveDefinitionRaw: typeof resolveDefinitionRaw;
  /** Told about each workspace whose pin failed (it stays pending for the next boot). */
  reportSiteTitleFailure: SiteTitleFailureReporter;
  /** Told the pinned/skipped/failed counts once per run that had pending workspaces. */
  reportPreservationSummary: SiteTitlePreservationSummaryReporter;
}

export interface PreserveLegacySiteTitlesInput {
  systemPrincipalId: UUID;
  /** The title each pending workspace is pinned to: the same value the host registered as the default. */
  legacySiteTitle: string;
}

/** REQ-11's report: every pending workspace lands in exactly one list. */
export interface PreserveLegacySiteTitlesResult {
  pinnedWorkspaceIds: UUID[];
  skippedWorkspaceIds: UUID[];
  failedWorkspaceIds: UUID[];
}

/** Always-allow shim scoped to this one system write, the same shape `settings migration` uses for its own. */
const allowSystemPin: AuthorizeFn = async () => ({ allowed: true, reason: "system_migration" });

type PinOutcome = "pinned" | "skipped" | "failed";

/**
 * REQ-06/REQ-11: pins every pending pre-existing workspace to `input.legacySiteTitle` with one
 * workspace-layer `set`, attributed to `systemPrincipalId`.
 *
 * - Skips a workspace that already has a workspace-layer row in any state (`set` or `cleared`), so an
 *   explicit owner action always wins (INV-02).
 * - Resolves the marker only AFTER the write. A crash between the two leaves a value row, which the
 *   next run skips, never a second pin.
 * - Reports a failed workspace (fixed text, no error message) and leaves it pending for the next boot. It never aborts the others or boot.
 *
 * Safe on every boot: with nothing pending it costs one marker read.
 *
 * @complexity O(p) sequential ledger writes for p pending workspaces, once per database.
 */
export async function preserveLegacySiteTitles(
  deps: PreserveLegacySiteTitlesDeps,
  input: PreserveLegacySiteTitlesInput
): Promise<PreserveLegacySiteTitlesResult> {
  const result: PreserveLegacySiteTitlesResult = { pinnedWorkspaceIds: [], skippedWorkspaceIds: [], failedWorkspaceIds: [] };
  const pendingWorkspaceIds = await deps.preservationStore.listPendingWorkspaceIds();
  if (pendingWorkspaceIds.length === 0) return result;

  const definition = await deps.resolveDefinitionRaw(
    { repo: deps.settingsRepo },
    { namespace: SITE_TITLE_NAMESPACE, key: SITE_TITLE_KEY, workspaceId: null }
  );
  for (const workspaceId of pendingWorkspaceIds) {
    const outcome: PinOutcome = definition
      ? await pinOneWorkspace(deps, { settingId: definition.settingId, workspaceId, systemPrincipalId: input.systemPrincipalId, legacySiteTitle: input.legacySiteTitle })
      : reportPinFailure(deps, { workspaceId, message: SITE_TITLE_PIN_UNREGISTERED_MESSAGE });
    if (outcome === "pinned") result.pinnedWorkspaceIds.push(workspaceId);
    else if (outcome === "skipped") result.skippedWorkspaceIds.push(workspaceId);
    else result.failedWorkspaceIds.push(workspaceId);
  }

  deps.reportPreservationSummary(result);
  return result;
}

/** One workspace of {@link preserveLegacySiteTitles}. Catch-log-continue is this function's contract. */
async function pinOneWorkspace(
  deps: PreserveLegacySiteTitlesDeps,
  required: { settingId: UUID; workspaceId: UUID; systemPrincipalId: UUID; legacySiteTitle: string }
): Promise<PinOutcome> {
  const { workspaceId } = required;
  try {
    const existing = await deps.settingsRepo.getWorkspaceValue({ workspaceId, settingId: required.settingId });
    if (!existing) {
      await deps.set({
        deps: { repo: deps.settingsRepo, clock: deps.clock, ids: deps.ids, authorize: allowSystemPin, principals: deps.principals },
        input: {
          namespace: SITE_TITLE_NAMESPACE,
          key: SITE_TITLE_KEY,
          scope: "workspace",
          workspaceId,
          authWorkspaceId: workspaceId,
          value: required.legacySiteTitle,
          callerPrincipalId: required.systemPrincipalId,
        },
      });
    }
    await deps.preservationStore.markPreserved({ workspaceId, preservedAt: clockNowIso({ clock: deps.clock }) });
    return existing ? "skipped" : "pinned";
  } catch (err) {
    return reportPinFailure(deps, { workspaceId, message: SITE_TITLE_PIN_FAILED_MESSAGE, errorClass: errorClassOf({ err }) });
  }
}

function reportPinFailure(deps: Pick<PreserveLegacySiteTitlesDeps, "reportSiteTitleFailure">, event: SiteTitleFailureEvent): "failed" {
  deps.reportSiteTitleFailure(event);
  return "failed";
}

/**
 * REQ-13: the served site's display name, read when a render needs it rather than captured once at
 * boot, so a `config.json` rename shows on the next render with no restart.
 */
export interface SiteDisplayNameSource {
  /**
   * The display name as it stands now, or `undefined` when there is none. The resolver normalizes it.
   * Should not throw; a throw renders the host's legacy title (REQ-09).
   */
  read(): string | undefined;
}

export interface ResolveSiteTitleDeps extends GetEffectivePort {
  settingsRepo: SettingsRepoPort;
  preservationStore: Pick<SiteTitlePreservationStorePort, "isPending">;
  /** The workspace row lookup (a host `WorkspaceRepoPort` fits); only `name` is read. */
  workspaceRepo: { findById(required: { id: UUID }): Promise<{ readonly name: string } | null> };
  /**
   * `config.json` `name` of the site directory this process serves (NC-2 = B), read at each
   * resolution that reaches it (REQ-13). A config rename and a `workspaces.name` rename both show on
   * the next render (OQ-01, EC-01). Reads `undefined` when there is no site directory.
   */
  siteDisplayName: SiteDisplayNameSource;
  /** The host's legacy title: the render fallback while a pin is pending, unregistered, or unreadable. */
  legacySiteTitle: string;
  /** Told when a read threw and the legacy title was rendered instead (fixed text, no error message). */
  reportSiteTitleFailure: SiteTitleFailureReporter;
}

/**
 * The site title a public render shows for `workspaceId` (REQ-03). Reads without a principal, so the
 * user layer never applies (INV-03). In order:
 * 1. a usable workspace-layer value (an owner title, or the pin);
 * 2. `deps.legacySiteTitle` while the workspace's pin is pending, or while the definition is not
 *    registered yet (REQ-07);
 * 3. the site display name, else `workspaces.name` (REQ-05);
 * 4. `deps.legacySiteTitle`.
 *
 * Never throws. Any failed read is reported (fixed text, no error message) and renders `deps.legacySiteTitle` rather than guess the tier, because
 * a pinned site that loses its settings read must not flip (REQ-09, INV-01).
 *
 * @complexity O(1) repo reads per call, at most one of them a workspace lookup, plus one bounded
 * display-name read on step 3 only (REQ-13).
 */
export async function resolveSiteTitle(deps: ResolveSiteTitleDeps, input: { workspaceId: UUID }): Promise<string> {
  try {
    // The marker is read BEFORE the value. The pin writes the value first and resolves the marker
    // second, so a pending marker can only be followed by no value or the pin, and both render the
    // legacy title. In the other order, a pin landing between the two reads would render the
    // display name for that request.
    const pending = await deps.preservationStore.isPending({ workspaceId: input.workspaceId });
    const resolved = await deps.getEffective(
      { deps: { repo: deps.settingsRepo }, namespace: SITE_TITLE_NAMESPACE, key: SITE_TITLE_KEY, scopeContext: { workspaceId: input.workspaceId } },
    );
    if (resolved === null) return deps.legacySiteTitle;
    const workspaceTitle = resolved.sourceLayer === "workspace" ? normalizeSiteTitle({ value: resolved.value }) : undefined;
    if (workspaceTitle !== undefined) return workspaceTitle;
    if (pending) return deps.legacySiteTitle;
    return (await resolveSiteDisplayName(deps, input.workspaceId)) ?? deps.legacySiteTitle;
  } catch (err) {
    deps.reportSiteTitleFailure({ message: SITE_TITLE_RENDER_FALLBACK_MESSAGE, workspaceId: input.workspaceId, errorClass: errorClassOf({ err }) });
    return deps.legacySiteTitle;
  }
}

/** NC-2 = B: the configured display name as it stands now (REQ-13), else the workspace row's name, each only if renderable. */
async function resolveSiteDisplayName(deps: ResolveSiteTitleDeps, workspaceId: UUID): Promise<string | undefined> {
  const configured = normalizeSiteTitle({ value: deps.siteDisplayName.read() });
  if (configured !== undefined) return configured;
  const workspace = await deps.workspaceRepo.findById({ id: workspaceId });
  return normalizeSiteTitle({ value: workspace?.name });
}
