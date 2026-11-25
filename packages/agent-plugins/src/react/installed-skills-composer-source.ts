import { isAbortError } from '@jini-ai/core/text';
interface ComposerCapability {
  readonly groupId: string;
  readonly groupLabel: string;
  readonly item: { id: string; label: string; description: string; kind: string; keywords: readonly string[]; insertText: string };
  readonly resolve: (required: { argument: string | null | undefined }, optional?: Record<string, never>) => { readonly kind: "installed-skill"; readonly toolId: string };
}
interface ComposerCapabilitySource { readonly id: string; list(): Promise<readonly ComposerCapability[]> }

/** Installed standalone skills use a conditional snapshot scoped to this source's lifetime.
 * Selection pins guidance behind a removable composer chip; dispatch adds it to the run prompt. */

/** The three wire fields C-002 (`server/http/admin/skills.ts`) projects — never `markdown` or
 *  `bundledFiles` (INV-002); this type only needs to describe what actually crosses the wire. */
interface InstalledSkillSummary {
  readonly enabled?: boolean;
  readonly toolId: string;
  readonly name: string;
  readonly description: string;
}

interface InstalledSkillsResponse {
  readonly skills?: unknown;
}

const INSTALLED_SKILLS_GROUP_ID = "installed-skills";
const INSTALLED_SKILLS_GROUP_LABEL = "Installed Skills";

/** See this file's own module doc: the one prefix guaranteed not to collide with the bundled
 *  catalog's `skill:` entries. */
const INSTALLED_SKILL_ID_PREFIX = "installed-skill:";

type SkillsSnapshot = { etag: string | undefined; capabilities: readonly ComposerCapability[] };

function skillsSnapshotFromBody({ body, cached, etag }: {
  body: InstalledSkillsResponse;
  cached: SkillsSnapshot | undefined;
  etag: string | undefined;
}, _options = {}): SkillsSnapshot {
  if (!Array.isArray(body.skills)) throw new TypeError("Installed skills response must contain a skills array");
  if (cached?.etag && etag === cached.etag) return cached;
  return { etag, capabilities: body.skills.filter(isInstalledSkillSummary).filter(s => s.enabled !== false).map(toCapability) };
}

/** Reuse authenticated transport and translate only its 304 error into the exact cached snapshot.
 * Invalid bodies and failures throw, so they never become successful cache entries.
 * @complexity O(n) time/space for n summaries; one request, no guidance bodies cached.
 */
async function readSkillsSnapshot(
  { request, path, isNotModified, cached }: Pick<Parameters<typeof createInstalledSkillsComposerCapabilitySource>[0], "request" | "path" | "isNotModified"> & { cached: SkillsSnapshot | undefined },
  _options = {},
): Promise<SkillsSnapshot> {
  let etag: string | undefined;
  try {
    const body = await request<InstalledSkillsResponse>({ path, method: "GET" }, {
      headers: cached?.etag ? { "If-None-Match": cached.etag } : {},
      onOk: ({ response }, _optional = {}) => { etag = response.headers?.get("ETag") ?? undefined; },
    });
    return skillsSnapshotFromBody({ body, cached, etag });
  } catch (error) {
    if (isNotModified(error) && cached) return cached;
    throw error;
  }
}

function isInstalledSkillSummary(value: unknown): value is InstalledSkillSummary {
  if (typeof value !== "object" || value === null) return false;
  const summary = value as { toolId?: unknown; name?: unknown; description?: unknown };
  return typeof summary.toolId === "string" && typeof summary.name === "string" && typeof summary.description === "string";
}

/**
 * Turns one wire summary into a discoverable, actionable composer row.
 *
 * `insertText: ""`, not omitted: an absent `insertText` on the slash-trigger path falls back to
 * `label`, typing the skill's bare name into the draft with no instruction to act on it — the
 * exact trap `composer-capabilities.ts` documents fixing on 2026-08-21. The `resolve` binding
 * below loads the agent guidance behind the chip.
 */
function toCapability(summary: InstalledSkillSummary): ComposerCapability {
  return {
    groupId: INSTALLED_SKILLS_GROUP_ID,
    groupLabel: INSTALLED_SKILLS_GROUP_LABEL,
    item: {
      id: `${INSTALLED_SKILL_ID_PREFIX}${summary.toolId}`,
      label: summary.name,
      description: summary.description,
      kind: "skill",
      keywords: ["skill", summary.name],
      insertText: "",
    },
    resolve: () => ({ kind: "installed-skill", toolId: summary.toolId }),
  };
}

/**
 * Builds a {@link ComposerCapabilitySource} backed by the installed-Skills route.
 *
 * Degrades to an empty list on ANY failure — non-2xx, network error, or a body that isn't the
 * expected `{skills: [...]}` shape — rather than throwing. Load-bearing, not defensive polish
 * (INV-001): `projectComposerCapabilities` awaits every source's `list()` through one
 * `Promise.all`, so a single REJECTING source takes the WHOLE projection down with it, including
 * the bundled catalog's always-available `/search` and `/mcp` rows. A workspace with zero
 * installed skills, an unauthorized session, or a route that 500s on a duplicate-frontmatter-name
 * conflict must cost this one capability — never the rest of the composer.
 *
 * @param _input - No required inputs; defaults preserve the existing no-argument callers.
 * @param options.request - Authenticated request port, replaceable for direct failure-path tests.
 * @returns A source whose list uses its cache; reload conditionally revalidates. Force supersedes
 * pending work but still sends the validator. Failures resolve to the last good list (else empty); aborts are silent.
 * @example createInstalledSkillsComposerCapabilitySource().list();
 * @complexity Cached reads O(1); revalidation O(n) time/space for n installed skills, one request.
 */
export function createInstalledSkillsComposerCapabilitySource(
  { request, path, isNotModified, reportFailure }: {
    request: <T>(required: { path: string; method: string }, optional: { headers: Record<string, string>; onOk: (required: { response: Pick<Response, "headers"> }, optional?: Record<string, never>) => void }) => Promise<T>;
    path: string;
    isNotModified: (error: unknown) => boolean;
    reportFailure: (message: string, error: unknown) => void;
  },
  _optional: Record<string, never> = {},
): ComposerCapabilitySource & { reload: (_input?: Record<string, never>, options?: { force?: boolean }) => Promise<readonly ComposerCapability[]> } {
  let cached: SkillsSnapshot | undefined;
  let pending: Promise<readonly ComposerCapability[]> | undefined;
  let generation = 0;
  /** Revalidate once per pending request; force prevents pre-event work from publishing a cache. */
  const reload = (_required: Record<string, never> = {}, { force = false } = {}) => {
    if (pending && !force) return pending;
    generation += 1;
    const current = generation;
    pending = readSkillsSnapshot({ request, path, isNotModified, cached }).then(snapshot => {
      if (current === generation) cached = snapshot;
      return snapshot.capabilities;
    }).catch(error => {
      // Leaving the page cancels the shared transport; it does not mean skill enumeration failed.
      // Every failure costs this capability alone: Promise.all must retain the bundled catalog.
      // A failed 60 s revalidation keeps the last good list rather than blanking typed skills.
      if (!isAbortError({ error })) reportFailure(
        "[installed-skills-composer-source] installed-skills enumeration failed; falling back to the bundled catalog only",
        error,
      );
      return cached?.capabilities ?? [];
    }).finally(() => { if (current === generation) pending = undefined; });
    return pending;
  };
  return {
    id: "installed-skills",
    list: () => cached ? Promise.resolve(cached.capabilities) : reload(),
    reload,
  };
}
