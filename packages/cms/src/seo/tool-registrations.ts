/**
 * @file SEO's tool-registration wiring: maps `agent-tools.ts`'s 6 catalog entries onto the
 * per-entry meta/analyze/override and site-wide settings/sitemap operations `server/routes/admin/
 * seo/*.ts` expose, as `ToolRegistration`s. The entire catalog is wired — see `agent-tools.ts`'s own
 * file header for why nothing in this domain is withheld.
 *
 * Authorization shape is genuinely mixed within this one domain, and each handler below states
 * which half it is:
 *  - `getEntryMeta`/`analyzeEntry`/`getSeoSettings`/`regenerateSitemapCache` carry no `authorize()`
 *    call of their own (their `Deps` types don't even accept an `authorize` function) — the admin
 *    routes gate inline (`get-entry.ts`/`get-entry-analyze.ts`/`get-settings.ts`/
 *    `post-sitemap-regenerate.ts`), so the 4 matching handlers below call the kit's
 *    `requireToolPermission` themselves, mirroring those routes' identical check.
 *  - `setEntrySeoOverrides` (`write-service.ts`) and `setSeoSettings` (`settings.ts`, via the
 *    settings write-service's own `set()`) ARE self-enforcing chokepoints — each calls
 *    `authorize()` internally. Per the single-evaluator rule, the 2 matching handlers below
 *    do NOT also call `requireToolPermission` — that would be a second evaluation of the same
 *    permission. Exception: `seo_set_settings` does gate first (2026-10-05), because
 *    `setSeoSettings`' `defaultOgImage` image check reads the media library ahead of its own
 *    `set()` authorization — see that handler. `put-entry.ts`/`put-settings.ts`'s own inline route-layer check is redundant
 *    belt-and-braces at the HTTP layer (their own comments say so); the tool path reaches the
 *    chokepoint directly instead, the same shape Forms/Identity/content-types' self-enforcing
 *    tools already use (contrast `features/workspace/tool-registrations.ts`'s `workspace_update`,
 *    which self-enforces nothing and is checked only at the handler).
 */
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, requireNoInput, requireString, withSchemaOnRejection, type AgentToolSideEffect, type ToolHandler, type ToolRegistration, resolveHostReadRefs, resolveHostReadText, type HostReadVocabulary } from "@jini-ai/core";
import type { AuthorizeFn, EventBusPort, OutboxPort } from "@jini-ai/core/contracts/events";
import { withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";
import { requireExpectedVersion, versionConflictRule } from "@jini-ai/core/optimistic-concurrency";
import { adaptLegacyAuthorize, requireToolPermission } from "../core/tools/index.js";
import { getSeoAgentToolCatalog, type AgentToolDefinition } from "./agent-tools.js";
import { SeoFieldValidationError, SeoInvalidCanonicalUrlError, SeoSettingsValidationError } from "./errors.js";
import { analyzeEntry, getEntryMeta, type GetEntryMetaDeps } from "./seo.js";
import type { createSitemapService, SitemapInvalidationDeps } from "./sitemap.js";
import type { SeoExtFieldsPatch, SeoSettings } from "./types.js";
import { setEntrySeoOverrides, type SetEntrySeoOverridesRequired } from "./write-service.js";

const MANAGE_SEO_PERMISSION = "admin.seo.manage";


/**
 * Builds `setEntrySeoOverrides`'s `patch` from `ctx.input` by dropping only `entryId` (the one key
 * that is NOT part of the patch itself). Deliberately NOT an allowlist of known `SeoExtFields`
 * keys: `setEntrySeoOverrides`'s own `validateSeoExtFieldsPatch` already rejects any key outside
 * its `REGISTERED_KEYS` array (`SeoFieldValidationError`, decorated with the published schema by
 * `withSchemaOnRejection` below) — silently DROPPING an unrecognized key here instead of letting
 * the chokepoint reject it would teach a model that a field it sent was applied when it silently
 * wasn't, the same failure mode `Jini packages/core/src/registration-kit.ts`'s `requireNoInput` doc comment warns
 * against for a no-input tool.
 *
 * A `null` value for any field passes through unchanged — that is this catalog's clear sentinel
 * (see `SeoExtFieldsPatch`'s doc comment in `types.ts`); the chokepoint interprets it, this mapping
 * layer does not need to.
 */
function seoOverridesPatchFromInput(input: Record<string, unknown>): SeoExtFieldsPatch {
  const patch: Record<string, unknown> = { ...input };
  delete patch.entryId;
  delete patch.expectedVersion;
  return patch as SeoExtFieldsPatch;
}

/**
 * Builds `setSeoSettings`'s `patch` from `ctx.input` verbatim. `setSeoSettings`'s own
 * `validateSeoSettingsPatch` rejects both an empty patch and any key outside `SeoSettings`' own
 * 7 fields, the same "unrecognized/empty input must be rejected, not silently accepted" reasoning
 * `seoOverridesPatchFromInput`'s chokepoint (`validateSeoExtFieldsPatch`) already applies — passed
 * through as-is here either way, for the "let the chokepoint be the one validator" reason.
 */
function seoSettingsPatchFromInput(input: Record<string, unknown>): Partial<SeoSettings> {
  return { ...input } as Partial<SeoSettings>;
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const seoDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> getEntryMeta (seo.ts): read-only precedence resolution over postRepo/settingsRepo/media.
  ["seo_get_entry_meta", "none"],
  // -> analyzeEntry (seo.ts): read-only, itself calls getEntryMeta.
  ["seo_analyze_entry", "none"],
  // -> setEntrySeoOverrides (write-service.ts): postRepo.save (merge + version bump) + conditional
  //    sitemap-cache invalidation.
  ["seo_set_entry_overrides", "mutates-durable-state"],
  // -> getSeoSettings (settings.ts): read-only, resolves 8 site.seo.* ledger keys.
  ["seo_get_settings", "none"],
  // -> setSeoSettings (settings.ts): N settings-ledger set() writes, all-or-nothing.
  ["seo_set_settings", "mutates-durable-state"],
  // -> regenerateSitemapCache (sitemap.ts): recomputes and overwrites the in-process sitemap cache
  //    entry — no DB write, but a real effect the next public sitemap/robots read observes (see
  //    agent-tools.ts's file header for why this is classified 'mutates-durable-state' rather than
  //    'none').
  ["seo_regenerate_sitemap", "mutates-durable-state"],
]);

/** The settings operations the SEO tools call; the host binds them to its settings ledger. */
export interface SeoSettingsPort {
  get(input: { workspaceId: string }): Promise<SeoSettings>;
  set(input: { workspaceId: string; patch: Partial<SeoSettings>; callerPrincipalId: string }): Promise<SeoSettings>;
}

/**
 * The host bindings the SEO tools read, as the members they use: the entry-meta producer's ports,
 * the post repo that also takes the override write, and the outbox dispatcher.
 */
export interface SeoToolHostBindings extends GetEntryMetaDeps {
  postRepo: GetEntryMetaDeps["postRepo"] & SetEntrySeoOverridesRequired["deps"]["postRepo"];
  dispatch: SitemapInvalidationDeps["dispatch"];
}

/** Everything the SEO tool handlers read, as ports: the host supplies the settings operations. */
export interface SeoPackageToolDeps {
  readonly outbox: OutboxPort;
  readonly bus: EventBusPort;
  readonly authorize: AuthorizeFn;
  readonly workspaceId: string;
  readonly clock: { nowIso(): string };
  readonly idGen: { newId(): string };
  readonly seoReady: Promise<void>;
  readonly seoDeps: SeoToolHostBindings;
  readonly sitemapService: ReturnType<typeof createSitemapService>;
  readonly seoSettings: SeoSettingsPort;
}

/** What every handler factory reads: the package deps, the sitemap invalidation they share, and the catalog and entry-meta read wording resolved through the host's vocabulary. */
interface SeoHandlerArgs {
  deps: SeoPackageToolDeps;
  requestInvalidation: (input: { workspaceId: string }) => Promise<void>;
  catalog: ReadonlyMap<string, AgentToolDefinition>;
  entryMetaRead: string;
}

const seoGetEntryMetaHandler = ({ deps }: SeoHandlerArgs): ToolHandler => async (ctx) => {
  const entryId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "entryId" });
  await deps.seoReady;
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_SEO_PERMISSION }, { entityType: "seo-entry", entityId: entryId });

  const meta = await getEntryMeta({ deps: deps.seoDeps, input: { workspaceId: deps.workspaceId, entryId } }, {});
  return { meta };
};

const seoAnalyzeEntryHandler = ({ deps }: SeoHandlerArgs): ToolHandler => async (ctx) => {
  const entryId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "entryId" });
  await deps.seoReady;
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_SEO_PERMISSION }, { entityType: "seo-entry", entityId: entryId });

  const analysis = await analyzeEntry({ deps: deps.seoDeps, input: { workspaceId: deps.workspaceId, entryId } }, {});
  return { analysis };
};

const seoSetEntryOverridesHandler = ({ deps, requestInvalidation, catalog, entryMetaRead }: SeoHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const entryId = requireString({ input: input, key: "entryId" });
  const expectedVersion = requireExpectedVersion({ value: input.expectedVersion, readToolId: entryMetaRead });
  await deps.seoReady;

  // Self-enforcing chokepoint (see file header) — no requireToolPermission call here.
  ctx.signal.throwIfAborted();
  const { overrides } = await withSchemaOnRejection({
      toolId: "seo_set_entry_overrides",
      catalog,
      isShapeRejection: ({ error }) => error instanceof SeoFieldValidationError || error instanceof SeoInvalidCanonicalUrlError,
      fn: () =>
      setEntrySeoOverrides({
        deps: { postRepo: deps.seoDeps.postRepo, authorize: deps.authorize, invalidateSitemapCache: requestInvalidation, clock: { nowMs: () => Date.parse(deps.clock.nowIso()) }, media: deps.seoDeps.media },
        input: {
          workspaceId: deps.workspaceId,
          entryId,
          patch: seoOverridesPatchFromInput(input),
          callerPrincipalId: ctx.principal.id,
        },
      }, { expectedVersion }) });
  return { overrides };
};

const seoGetSettingsHandler = ({ deps }: SeoHandlerArgs): ToolHandler => async (ctx) => {
  requireNoInput({ input: ctx.input });
  await deps.seoReady;
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_SEO_PERMISSION }, { entityType: "seo-settings" });

  const settings = await deps.seoSettings.get({ workspaceId: deps.workspaceId });
  return { settings };
};

const seoSetSettingsHandler = ({ deps, requestInvalidation, catalog }: SeoHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  await deps.seoReady;
  // The one exception to the single-evaluator rule in the file header (2026-10-05):
  // `setSeoSettings` checks `defaultOgImage` against the media library BEFORE its own per-write
  // `set()` authorizes, so without this gate a denied caller could learn whether an asset it
  // names is a non-image. Same order as `put-settings.ts`: authorize, then the chokepoint.
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_SEO_PERMISSION }, { entityType: "seo-settings" });

  ctx.signal.throwIfAborted();
  const settings = await withSchemaOnRejection({ toolId: "seo_set_settings", catalog, isShapeRejection: ({ error }) => error instanceof SeoSettingsValidationError, fn: () =>
      deps.seoSettings.set({ workspaceId: deps.workspaceId, patch: seoSettingsPatchFromInput(input), callerPrincipalId: ctx.principal.id }) });
  return { settings };
};

const seoRegenerateSitemapHandler = ({ deps, requestInvalidation }: SeoHandlerArgs): ToolHandler => async (ctx) => {
  requireNoInput({ input: ctx.input });
  await deps.seoReady;
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_SEO_PERMISSION }, { entityType: "seo-sitemap" });

  await deps.sitemapService.regenerateSitemapCache({ workspaceId: deps.workspaceId }, {});
  await requestInvalidation({ workspaceId: deps.workspaceId });
  return { accepted: true };
};

/**
 * The package-side builder: the id -> handler table over the SEO catalog. It takes no host metadata
 * (search vocabulary, approval policy); the host binding adds it.
 */
export function buildSeoToolRegistrations(
  { deps }: { deps: SeoPackageToolDeps },
  { hostReads }: { hostReads?: HostReadVocabulary | undefined } = {},
): ToolRegistration[] {
  const catalog = indexCatalogById({ catalog: resolveHostReadRefs({ value: getSeoAgentToolCatalog() }, { hostReads }) });
  const entryMetaRead = resolveHostReadText({ text: "{{read:seo_entry_meta}}" }, { hostReads });
  // Bind delivery to the existing outbox owner; the same service handles local invalidation.
  const invalidationDeps = {
    outbox: deps.outbox, bus: deps.bus, clock: deps.clock,
    idGen: deps.idGen, dispatch: deps.seoDeps.dispatch,
  };
  const requestInvalidation = (input: { workspaceId: string }) =>
    deps.sitemapService.requestSitemapInvalidation({ deps: invalidationDeps, input }, {});
  const args: SeoHandlerArgs = { deps, requestInvalidation, catalog, entryMetaRead };
  const handlers: Record<string, ToolHandler> = {
    seo_get_entry_meta: seoGetEntryMetaHandler(args),
    seo_analyze_entry: seoAnalyzeEntryHandler(args),
    seo_set_entry_overrides: seoSetEntryOverridesHandler(args),
    seo_get_settings: seoGetSettingsHandler(args),
    seo_set_settings: seoSetSettingsHandler(args),
    seo_regenerate_sitemap: seoRegenerateSitemapHandler(args),
  };

  return buildDomainRegistrations({
    domain: "seo",
    catalogModule: "seo/agent-tools.ts",
    catalog,
    handlers: withModelFacingErrors({ handlers, rules: [versionConflictRule({ readToolId: entryMetaRead })] }),
    derivedRisk: seoDerivedRisk,
  });
}
