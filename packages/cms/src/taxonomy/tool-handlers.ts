/**
 * @file Taxonomy's agent-tool handlers: maps the catalog's tools onto `write-service.ts`'s ordinary
 * mutations, `list.ts`'s read, and `merge-term.ts`'s plan-only slice of the gated-mutation ceremony.
 *
 * Authorization shape, mixed and deliberately so: `createTaxonomy`/`createTerm`/`renameTerm`/
 * `assignTerms` each call the manage-taxonomies permission as their own first line, so those
 * handlers must NOT re-check (one evaluator). The tagging tools first check a DIFFERENT permission,
 * the content's own edit one, exactly as an admin assign/unassign route does. `listTaxonomiesWithTerms`
 * has no authorization of its own, so `taxonomy_list` performs that check inline.
 * `taxonomy_plan_merge_term` is a THIRD shape: the gateway's `plan()` itself authorizes before
 * computing anything. `taxonomy_execute_merge_term` asks the human in chat first: a merge deletes
 * the source term's assignments with no Trash or undo. On the human's click it confirms as that
 * human and executes as the agent acting for them.
 */
import { AGENT_TOOL_PRINCIPAL_KIND, optionalString, requireInputRecord, requireString, ToolInputError, type HumanConfirmer, type ToolExecutionContext, type ToolHandler } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "../core/tools/index.js";
import { listTaxonomiesWithTerms } from "./list.js";
import { confirmMergeTerm, executeMergeTerm, planMergeTerm } from "./merge-term.js";
import { toTaxonomyOutbox } from "./repo.memory.js";
import type { TaxonomyHandlerArgs, TaxonomyPackageToolDeps } from "./tool-handlers.types.js";
import { assignTerms, createTaxonomy, createTerm, isContentTypeOnAllowList, renameTerm, unassignTerms, type WriteServiceDeps } from "./write-service.js";

export const MERGE_TOOL_ID = "taxonomy_execute_merge_term";

/** Shared read/assignment validation: posts, pages and live collections can carry terms.
 * @throws {ToolInputError} For widget, unknown or tombstoned collection types.
 * @complexity O(1), at most one indexed content-type read.
 */
async function requireTaggableContentType(
  { deps, contentType }: { deps: TaxonomyPackageToolDeps; contentType: string },
  _optional = {},
): Promise<void> {
  if (isContentTypeOnAllowList({ contentType })) return;
  if (await deps.collectionTermPolicy().taxonomiesFor({ contentType }) !== null) return;
  throw new ToolInputError({ message: `content type '${contentType}' does not support taxonomy assignments. Use post, page, or a live collection key.` });
}

/** Shared dependency bag for `write-service.ts` calls — every mutating handler here takes this
 * identical shape, mirroring each admin route's own inline construction. */
function taxonomyDeps(routeDeps: TaxonomyPackageToolDeps): WriteServiceDeps {
  return {
    authorize: (params) => routeDeps.authorize({ ...params, workspaceId: routeDeps.workspaceId }),
    clock: routeDeps.clock,
    idGen: routeDeps.idGen,
    taxonomies: routeDeps.taxonomyRepo,
    terms: routeDeps.termRepo,
    entryTerms: routeDeps.entryTermRepo,
    revisions: routeDeps.taxonomyRevisionRepo,
    stampWatermark: routeDeps.stampWatermark,
    outbox: toTaxonomyOutbox(routeDeps),
    workspaceId: routeDeps.workspaceId,
    ...routeDeps.contentTargetPorts(),
  };
}

const termName = async ({ deps, id }: { deps: TaxonomyPackageToolDeps; id: string }, _optional = {}) => (await deps.termRepo.findById({ id }))?.name ?? `${id} (not found)`;

function mergeHooksFor(
  { deps, ctx, fromTermId, intoTermId }: { deps: TaxonomyPackageToolDeps; ctx: { principal: { id: string } }; fromTermId: string; intoTermId: string },
  _optional = {},
) {
  return deps.mergeTermHooks({ fromTermId, intoTermId, actorId: ctx.principal.id });
}

/** Uses the live, workspace-bound repository, including its parent-taxonomy Trash filter. */
export const taxonomyGetTermHandler = ({ deps }: TaxonomyHandlerArgs): ToolHandler => async (ctx) => {
  const termId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "termId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.taxonomy.manage" }, { entityType: "term", entityId: termId });
  const term = await deps.termRepo.findByIdFull({ id: termId });
  if (!term) throw new ToolInputError({ message: `term '${termId}' was not found — call content_read.taxonomy to list valid terms` });
  return { term };
};

export const taxonomyListHandler = ({ deps }: TaxonomyHandlerArgs): ToolHandler => async (ctx) => {
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.taxonomy.manage" }, { entityType: "taxonomy" });
  return listTaxonomiesWithTerms({ taxonomies: deps.taxonomyRepo, terms: deps.termRepo });
};

export const taxonomyGetAssignedTermsHandler = ({ deps }: TaxonomyHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const contentType = requireString({ input: input, key: "contentType" });
  const contentId = requireString({ input: input, key: "contentId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.taxonomy.manage" }, { entityType: "taxonomy" });
  await deps.authorizeContentEdit({ principalId: ctx.principal.id, contentType });
  await requireTaggableContentType({ deps, contentType });
  const assignments = await deps.entryTermRepo.listForContent({ contentType, contentId });
  if (!assignments.length) return { contentType, contentId, terms: [] };
  const assigned = new Set(assignments.map(row => row.termId));
  // Bulk lists resolve names without one query per assignment. O(all terms + a log a)
  // time, O(all terms) space, a = assigned terms; no assignment or revision writes.
  const { items } = await listTaxonomiesWithTerms({ taxonomies: deps.taxonomyRepo, terms: deps.termRepo });
  const terms = items.flatMap(({ taxonomy, terms }) => terms.filter(term => assigned.has(term.id)).map(term => ({
    termId: term.id, name: term.name, slug: deps.toSlug({ text: term.name }), taxonomyId: taxonomy.id, taxonomyName: taxonomy.name,
  })));
  terms.sort((a, b) => a.taxonomyName.localeCompare(b.taxonomyName) || a.name.localeCompare(b.name) || a.termId.localeCompare(b.termId));
  return { contentType, contentId, terms };
};

export const taxonomyCreateTaxonomyHandler = ({ deps }: TaxonomyHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const taxonomy = await createTaxonomy({
    deps: taxonomyDeps(deps),
    principalId: ctx.principal.id,
    name: requireString({ input: input, key: "name" }),
    hierarchical: input.hierarchical === true,
  });
  return { taxonomy };
};

export const taxonomyCreateTermHandler = ({ deps }: TaxonomyHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const term = await createTerm({
    deps: taxonomyDeps(deps),
    principalId: ctx.principal.id,
    taxonomyId: requireString({ input: input, key: "taxonomyId" }),
    name: requireString({ input: input, key: "name" }),
  }, { parentId: optionalString({ input: input, key: "parentId" }) ?? null });
  return { term };
};

export const taxonomyRenameTermHandler = ({ deps }: TaxonomyHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const term = await renameTerm({
    deps: { ...taxonomyDeps(deps), transaction: (required) => deps.taxonomyRepo.transaction(required) },
    principalId: ctx.principal.id,
    termId: requireString({ input: input, key: "termId" }),
    newName: requireString({ input: input, key: "newName" }),
  });
  return { term };
};

export const taxonomyAssignTermsHandler = ({ deps }: TaxonomyHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const contentType = requireString({ input: input, key: "contentType" });
  const contentId = requireString({ input: input, key: "contentId" });
  if (!Array.isArray(input.termIds) || !input.termIds.every((id: unknown) => typeof id === "string")) {
    throw new ToolInputError({ message: "'termIds' (string array) is required" });
  }
  const termIds = input.termIds as string[];

  // The content's own edit permission first, as the admin route does; assignTerms then checks
  // admin.taxonomy.manage itself.
  await deps.authorizeContentEdit({ principalId: ctx.principal.id, contentType });
  const writeDeps = taxonomyDeps(deps);
  await assignTerms({
    deps: { ...writeDeps, authorize: async params => {
      const result = await writeDeps.authorize(params);
      // The service owns the taxonomy permission check. Validate the shared content-type
      // contract only after that grant, including empty assignment requests, before writes.
      if (result.allowed) await requireTaggableContentType({ deps, contentType });
      return result;
    } },
    principalId: ctx.principal.id, contentType, contentId, termIds,
  });
  return { contentType, contentId, assignedTermIds: termIds };
};

export const taxonomyUnassignTermsHandler = ({ deps }: TaxonomyHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const contentType = requireString({ input: input, key: "contentType" });
  const contentId = requireString({ input: input, key: "contentId" });
  if (!Array.isArray(input.termIds) || !input.termIds.every((id: unknown) => typeof id === "string")) {
    throw new ToolInputError({ message: "'termIds' (string array) is required" });
  }
  const termIds = input.termIds as string[];

  await deps.authorizeContentEdit({ principalId: ctx.principal.id, contentType });
  // `taxonomyDeps(deps)` is typed as the base `WriteServiceDeps` (its `entryTerms` narrowed
  // to plain `EntryTermRepoPort`), but `unassignTerms` needs the `UnassignableEntryTermRepoPort`
  // capability too — override `entryTerms` back to `deps.entryTermRepo`'s own wider type
  // rather than widening `taxonomyDeps`'s return type for every OTHER handler that doesn't need it.
  const { removedTermIds } = await unassignTerms({
    deps: { ...taxonomyDeps(deps), entryTerms: deps.entryTermRepo },
    principalId: ctx.principal.id,
    contentType,
    contentId,
    termIds,
  });
  const removed = new Set(removedTermIds);
  return { contentType, contentId, unassignedTermIds: removedTermIds, notAssignedTermIds: termIds.filter(id => !removed.has(id)) };
};

export const taxonomyPlanMergeTermHandler = ({ deps }: TaxonomyHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const fromTermId = requireString({ input: input, key: "fromTermId" });
  const intoTermId = requireString({ input: input, key: "intoTermId" });

  const hooks = mergeHooksFor({ deps, ctx, fromTermId, intoTermId });

  // No explicit pre-check here: `gateway.ts`'s plan() calls authorize() unconditionally, BEFORE
  // hooks.computePlan() ever runs (see `taxonomyDerivedRisk`'s comment for this tool). Adding a
  // second check here would be the duplicate evaluator ADR-021 §2 forbids.
  return planMergeTerm({
    principalId: ctx.principal.id,
    principalKind: AGENT_TOOL_PRINCIPAL_KIND,
    fromTermId,
    intoTermId,
    computeOverlap: async () => ({ overlappingContentCount: await deps.entryTermRepo.countOverlap({ fromTermId, intoTermId }) }),
    gatewayPlan: async () =>
      deps.mergeGateway.plan({
        principalId: ctx.principal.id,
        principalKind: AGENT_TOOL_PRINCIPAL_KIND,
        hooks,
      }),
  });
};

type MergePrepared = {
  hooks: ReturnType<typeof mergeHooksFor>;
  plan: Awaited<ReturnType<typeof planMergeTerm>>;
  fromName: string;
  intoName: string;
};

async function mergePrepare({ deps, ctx }: { deps: TaxonomyPackageToolDeps; ctx: ToolExecutionContext }, _optional = {}): Promise<MergePrepared> {
  const input = requireInputRecord({ input: ctx.input });
  deps.refuseUnexpectedKeys(input, ["fromTermId", "intoTermId"]);
  const fromTermId = requireString({ input: input, key: "fromTermId" });
  const intoTermId = requireString({ input: input, key: "intoTermId" });
  const hooks = mergeHooksFor({ deps, ctx, fromTermId, intoTermId });
  const plan = await planMergeTerm({
    principalId: ctx.principal.id,
    principalKind: AGENT_TOOL_PRINCIPAL_KIND,
    fromTermId,
    intoTermId,
    computeOverlap: async () => ({ overlappingContentCount: await deps.entryTermRepo.countOverlap({ fromTermId, intoTermId }) }),
    gatewayPlan: async () =>
      deps.mergeGateway.plan({ principalId: ctx.principal.id, principalKind: AGENT_TOOL_PRINCIPAL_KIND, hooks }),
  });
  return { hooks, plan, fromName: await termName({ deps, id: fromTermId }), intoName: await termName({ deps, id: intoTermId }) };
}

function mergeDialog({ plan, fromName, intoName }: MergePrepared, _optional = {}) {
  return {
    toolId: MERGE_TOOL_ID,
    errorCode: "TAXONOMY",
    title: `Merge ${fromName} into ${intoName}?`,
    details: [
      { label: "Merge away", value: fromName },
      { label: "Keep", value: intoName },
      ...(plan.details.overlappingContentCount > 0
        ? [{ label: "Tagged with both", value: String(plan.details.overlappingContentCount) }]
        : []),
    ],
    warning: `Everything tagged ${fromName} is re-tagged ${intoName}, and ${fromName} is retired. This can't be undone.`,
    danger: true,
    confirmLabel: "Merge terms",
  };
}

async function mergeRun(
  { deps, ctx, prepared: { hooks, plan }, confirmer }: { deps: TaxonomyPackageToolDeps; ctx: ToolExecutionContext; prepared: MergePrepared; confirmer: HumanConfirmer },
  _optional = {},
): Promise<unknown> {
  const { token } = await confirmMergeTerm({
    principalId: confirmer.id,
    principalKind: confirmer.kind,
    planId: plan.planId,
    planHash: plan.planHash,
    gatewayConfirm: async (params) => {
      const record = await deps.mergeGateway.confirm({
        principalId: confirmer.id,
        principalKind: confirmer.kind,
        hooks,
        planId: params.planId,
        planHash: params.planHash,
      });
      return { token: record.confirmationToken };
    },
  });
  const result = await executeMergeTerm({
    confirmationToken: token,
    gatewayExecute: (params) =>
      deps.mergeGateway.execute({
        principalId: ctx.principal.id,
        principalKind: AGENT_TOOL_PRINCIPAL_KIND,
        hooks,
        confirmationToken: params.confirmationToken,
      }),
  });
  return { merged: true, ...result };
}

// Plans as the agent, asks the human, then confirms as the human and executes as the agent —
// the gateway's own check sequence (authorize, token, actor-class, plan hash) runs unchanged.
export const taxonomyExecuteMergeTermHandler = ({ deps, surfaces }: TaxonomyHandlerArgs): ToolHandler =>
  deps.humanConfirmedHandler(surfaces, {
    flag: "merged",
    prepare: ({ ctx }) => mergePrepare({ deps, ctx }),
    dialog: (prepared) => mergeDialog(prepared),
    run: ({ ctx, prepared, confirmer }) => mergeRun({ deps, ctx, prepared, confirmer }),
  });
