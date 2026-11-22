/**
 * @file Redirects' half of the agent-tool wiring: maps `agent-tools.ts`'s 7 catalog entries onto
 * the list/get/hits/create/update/tombstone/import operations a host's admin redirect routes
 * expose, as `ToolRegistration`s. All 7 are wired (`redirects_import` joined the other 6 — see
 * `agent-tools.ts`'s own file header for why).
 *
 * Authorization shape: none of `createRedirect`/`updateRedirect`/`tombstoneRedirect`
 * (`redirects.ts`) accept an `authorize` dependency at all — `RedirectsWriteDeps` has no such field,
 * so the chokepoint itself never gates. Every admin route therefore calls `authorize()` inline as
 * its own first line, and every handler below does the same via the kit's `requireToolPermission`,
 * mirroring those routes' identical check (the single permission evaluator, located at the handler
 * here rather than inside the domain function).
 *
 * Host policy is bound by the host, not here: the host's tool metadata (search vocabulary,
 * approval/confirmation policy) is applied around these registrations with `withToolMetadata`.
 */
import { buildDomainRegistrations, indexCatalogById, isRecord, optionalBoolean, optionalNumber, optionalOneOf, optionalString, requireInputRecord, requireNumber, requireString, ToolInputError, type AgentToolSideEffect, type ToolHandler, type ToolRegistration, resolveHostReadRefs, type HostReadVocabulary } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { forbiddenRule, withModelFacingErrors, type ModelFacingErrorRule } from "@jini-ai/core/model-facing-tool-errors";
import { ForbiddenError } from "../core/commands/command.js";
import { adaptLegacyAuthorize, requireToolPermission } from "../core/tools/args.js";
import { getRedirectsAgentToolCatalog, MANAGE_REDIRECTS_PERMISSION } from "./agent-tools.js";
import type { RedirectHitSink, RedirectRepoPort } from "./ports.js";
import { createRedirect, importRedirects, listRedirects, MAX_IMPORT_BATCH_SIZE, tombstoneRedirect, updateRedirect, type RedirectsWriteDeps } from "./redirects.js";
import { REDIRECT_MATCH_TYPES, REDIRECT_SOURCES, REDIRECT_STATUSES, RedirectConflictError, RedirectLoopError, RedirectNotFoundError, RedirectTargetNotAllowedError, RedirectValidationError, type CreateRedirectInput, type RedirectMatchType, type RedirectRecord, type RedirectStatus, type RedirectStatusCode } from "./types.js";


/**
 * The exact slice of a host's route-deps bag the Redirects tool handlers read. Declared
 * structurally so this module carries no back-edge into any host's composition root: a host's
 * route layer satisfies it by passing the route-deps object it already has.
 */
export interface RedirectsPackageToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  redirectRepo: RedirectRepoPort;
  redirectHitSink: RedirectHitSink;
  redirectsWriteDeps: RedirectsWriteDeps;
}

/** What each handler factory receives (handlers never read a surface store: none opens a dialog). */
interface RedirectsHandlerArgs {
  deps: RedirectsPackageToolDeps;
}

/** Model-facing redirect-rule view — drops `workspaceId` (redundant: every call is already scoped
 * to the caller's own workspace) and the actor/lineage-attribution internals
 * (`createdByPrincipal`/`createdByPluginId`/`sourceEntryId`/`fromPathAtCapture`/`toPathAtCapture`)
 * that no wired tool's follow-up call consumes — the same reasoning other domains' model-facing
 * views use for dropping actor attribution. */
function toRedirectToolView(record: RedirectRecord) {
  return {
    id: record.id,
    matchType: record.matchType,
    fromPattern: record.fromPattern,
    toTarget: record.toTarget,
    statusCode: record.statusCode,
    status: record.status,
    override: record.override,
    priority: record.priority,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
  };
}

/** The actor plugin id an assistant-driven tombstone records. Duplicated from the trash tool's
 *  identical constant rather than imported, the same "structurally typed, no cross-domain import"
 *  convention this domain's `TombstoneRedirectRequired.input.pluginId` already follows. */
const ASSISTANT_ACTOR_PLUGIN_ID = "assistant";

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const redirectsDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> listRedirects (redirectRepo.list() minus rules in the Trash): read only.
  ["redirects_list", "none"],
  // -> redirectRepo.findById(): read only.
  ["redirects_get", "none"],
  // -> redirectRepo.findById() + redirectHitSink.getStats(): read only.
  ["redirects_get_hits", "none"],
  // -> createRedirect (redirects.ts): validate -> write record + revision in one tx -> enqueue event.
  ["redirects_create", "mutates-durable-state"],
  // -> updateRedirect (redirects.ts): same write shape as create.
  ["redirects_update", "mutates-durable-state"],
  // -> tombstoneRedirect (redirects.ts): moves the rule to the Trash — status flip + Trash row +
  //    revision write (no-op if already in the Trash).
  ["redirects_tombstone", "mutates-durable-state"],
  // -> importRedirects (redirects.ts): createRedirect in a loop, one call each — same write shape
  //    as redirects_create, N times, with a per-item try/catch (EC-08).
  ["redirects_import", "mutates-durable-state"],
]);

/**
 * Redirects' model-facing allowlist. Every `Redirect*Error` and the kit's
 * `ForbiddenError` extend plain `Error`, so before this wrap `ToolExecutor` classified each refusal
 * as `internal` and the model saw only a redacted INTERNAL_ERROR — it could not tell "that id does
 * not exist" or "that would loop" from a crash, and could not correct its call.
 *
 * Message safety, checked against every construction site in `redirects.ts`/`matcher.ts`/this
 * file: each message is fixed text plus the caller's own input (id, pattern, target, numbers) or a
 * fixed `siteRelativeTargetReason`/`siteRelativeRefusalReason` phrase — no paths, SQL, or other
 * tenants' data. `RedirectTargetNotAllowedError` names only the caller's `toTarget` and a fixed
 * reason. `EntityNotLiveError` (a trashed rule) is not listed: it already extends `ToolInputError`.
 * The plain `Error` for a missing Trash adapter is deliberately NOT listed: it is a wiring fault and
 * stays redacted.
 */
const REDIRECTS_MODEL_FACING_RULES: readonly ModelFacingErrorRule[] = [
  forbiddenRule({ domainPrefix: "REDIRECTS", error: ForbiddenError }),
  { error: RedirectNotFoundError, code: "REDIRECTS_NOT_FOUND" },
  { error: RedirectValidationError, code: "REDIRECTS_VALIDATION" },
  { error: RedirectLoopError, code: "REDIRECTS_LOOP" },
  { error: RedirectTargetNotAllowedError, code: "REDIRECTS_TARGET_NOT_ALLOWED" },
  { error: RedirectConflictError, code: "REDIRECTS_CONFLICT" },
];

const redirectsListHandler = ({ deps }: RedirectsHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_REDIRECTS_PERMISSION }, { entityType: "redirect" });

  // Rules in the Trash are left out (Bug B) — the same list the admin Redirects screen shows.
  const rules = await listRedirects({
    deps: { repo: deps.redirectRepo, isInTrash: deps.redirectsWriteDeps.isInTrash },
    filter: {
      workspaceId: deps.workspaceId,
      status: optionalOneOf({ input, key: "status", values: REDIRECT_STATUSES }),
      source: optionalOneOf({ input, key: "source", values: REDIRECT_SOURCES }),
      matchType: optionalOneOf({ input, key: "matchType", values: REDIRECT_MATCH_TYPES }),
    },
  });
  return { rules: rules.map(toRedirectToolView) };
};

const redirectsGetHandler = ({ deps }: RedirectsHandlerArgs): ToolHandler => async (ctx) => {
  const id = requireString({ input: requireInputRecord({ input: ctx.input }), key: "id" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_REDIRECTS_PERMISSION }, { entityType: "redirect", entityId: id });

  const rule = await deps.redirectRepo.findById({ workspaceId: deps.workspaceId, id });
  if (!rule) throw new RedirectNotFoundError(`redirect '${id}' was not found`);
  return { rule: toRedirectToolView(rule) };
};

const redirectsGetHitsHandler = ({ deps }: RedirectsHandlerArgs): ToolHandler => async (ctx) => {
  const id = requireString({ input: requireInputRecord({ input: ctx.input }), key: "id" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_REDIRECTS_PERMISSION }, { entityType: "redirect", entityId: id });

  const rule = await deps.redirectRepo.findById({ workspaceId: deps.workspaceId, id });
  if (!rule) throw new RedirectNotFoundError(`redirect '${id}' was not found`);

  const stats = await deps.redirectHitSink.getStats({ workspaceId: deps.workspaceId, redirectId: id });
  return { stats: stats ?? { redirectId: id, workspaceId: deps.workspaceId, hitCount: 0, lastHitAt: undefined } };
};

const redirectsCreateHandler = ({ deps }: RedirectsHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_REDIRECTS_PERMISSION }, { entityType: "redirect" });

  ctx.signal.throwIfAborted();
  const { record } = await createRedirect({
    deps: deps.redirectsWriteDeps,
    input: {
      workspaceId: deps.workspaceId,
      matchType: requireString({ input: input, key: "matchType" }) as RedirectMatchType,
      fromPattern: requireString({ input: input, key: "fromPattern" }),
      toTarget: requireString({ input: input, key: "toTarget" }),
      statusCode: requireNumber({ input: input, key: "statusCode" }) as RedirectStatusCode,
      override: optionalBoolean({ input: input, key: "override" }),
      priority: optionalNumber({ input: input, key: "priority" }),
      actorId: ctx.principal.id,
    },
  });
  return { rule: toRedirectToolView(record) };
};

const redirectsUpdateHandler = ({ deps }: RedirectsHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const id = requireString({ input: input, key: "id" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_REDIRECTS_PERMISSION }, { entityType: "redirect", entityId: id });

  ctx.signal.throwIfAborted();
  const { record } = await updateRedirect({
    deps: deps.redirectsWriteDeps,
    input: {
      workspaceId: deps.workspaceId,
      id,
      matchType: optionalString({ input: input, key: "matchType" }) as RedirectMatchType | undefined,
      fromPattern: optionalString({ input: input, key: "fromPattern" }),
      toTarget: optionalString({ input: input, key: "toTarget" }),
      statusCode: optionalNumber({ input: input, key: "statusCode" }) as RedirectStatusCode | undefined,
      status: optionalString({ input: input, key: "status" }) as RedirectStatus | undefined,
      override: optionalBoolean({ input: input, key: "override" }),
      priority: optionalNumber({ input: input, key: "priority" }),
      actorId: ctx.principal.id,
    },
  });
  return { rule: toRedirectToolView(record) };
};

/** Moves the redirect to the Trash after authorization; removing one already there is a no-op. */
const redirectsTombstoneHandler = ({ deps }: RedirectsHandlerArgs): ToolHandler => async (ctx) => {
  const id = requireString({ input: requireInputRecord({ input: ctx.input }), key: "id" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_REDIRECTS_PERMISSION }, { entityType: "redirect", entityId: id });

  const rule = await deps.redirectRepo.findById({ workspaceId: deps.workspaceId, id });
  if (!rule) throw new RedirectNotFoundError(`redirect '${id}' was not found`);

  const { record } = await tombstoneRedirect({
    deps: deps.redirectsWriteDeps,
    input: { workspaceId: deps.workspaceId, id, actorId: ctx.principal.id, pluginId: ASSISTANT_ACTOR_PLUGIN_ID },
  });
  return { tombstoned: true, cancelled: false, rule: toRedirectToolView(record) };
};

// Wired 2026-09-24 (tool-design audit F2/F3, dispatch item 3) — see `agent-tools.ts`'s file
// header for why the earlier "mass autonomous change" exclusion no longer holds. No confirmation
// gate: same reversible, single-chokepoint risk envelope as `redirects_create`, just N rows.
const redirectsImportHandler = ({ deps }: RedirectsHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_REDIRECTS_PERMISSION }, { entityType: "redirect" });

  if (!Array.isArray(input.rules) || input.rules.length < 1 || input.rules.length > MAX_IMPORT_BATCH_SIZE) {
    throw new ToolInputError({ message: `'rules' (array of 1-${MAX_IMPORT_BATCH_SIZE} items) is required` });
  }

  const rules: CreateRedirectInput[] = input.rules.map((raw, index) => {
    const candidate = { value: raw };
    if (!isRecord(candidate)) throw new ToolInputError({ message: `rules[${index}] must be an object` });
    const rule = candidate.value;
    return {
      workspaceId: deps.workspaceId,
      matchType: requireString({ input: rule, key: "matchType" }) as RedirectMatchType,
      fromPattern: requireString({ input: rule, key: "fromPattern" }),
      toTarget: requireString({ input: rule, key: "toTarget" }),
      statusCode: requireNumber({ input: rule, key: "statusCode" }) as RedirectStatusCode,
      override: optionalBoolean({ input: rule, key: "override" }),
      priority: optionalNumber({ input: rule, key: "priority" }),
      actorId: ctx.principal.id,
    };
  });

  ctx.signal.throwIfAborted();
  const { created, failed } = await importRedirects({
    deps: deps.redirectsWriteDeps,
    input: { workspaceId: deps.workspaceId, actorId: ctx.principal.id, rules },
  });
  return { created: created.map(toRedirectToolView), failed };
};

/**
 * The package-side builder: the seven redirects tools, their model-facing error mapping and the
 * authored risk map, with no host metadata or default surface store bound.
 *
 * @param required.deps - The ports the handlers read.
 * @param optional.hostReads - How the host names its read tools in model-facing text (neutral wording when absent).
 * @returns One registration per catalog entry, in catalog order.
 * @throws {Error} When a catalog entry is neither wired nor declared unwired (the kit's tripwire).
 * @complexity O(t) in the seven catalog entries.
 */
export function buildRedirectsToolRegistrations(
  { deps }: { deps: RedirectsPackageToolDeps },
  { hostReads }: { hostReads?: HostReadVocabulary | undefined } = {},
): ToolRegistration[] {
  const args: RedirectsHandlerArgs = { deps };
  const handlers: Record<string, ToolHandler> = {
    redirects_list: redirectsListHandler(args),
    redirects_get: redirectsGetHandler(args),
    redirects_get_hits: redirectsGetHitsHandler(args),
    redirects_create: redirectsCreateHandler(args),
    redirects_update: redirectsUpdateHandler(args),
    redirects_tombstone: redirectsTombstoneHandler(args),
    redirects_import: redirectsImportHandler(args),
  };

  return buildDomainRegistrations({
    domain: "redirects",
    catalogModule: "redirects/agent-tools.ts",
    catalog: indexCatalogById({ catalog: resolveHostReadRefs({ value: getRedirectsAgentToolCatalog() }, { hostReads }) }),
    handlers: withModelFacingErrors({ handlers, rules: REDIRECTS_MODEL_FACING_RULES }),
    derivedRisk: redirectsDerivedRisk,
  });
}
