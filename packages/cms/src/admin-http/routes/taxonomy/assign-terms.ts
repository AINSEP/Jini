import type { MutationActor } from "@jini-ai/core/contracts/events";
import { defineJsonRoute, ok, type JsonRouteSpec } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { EntityNotLiveError, ForbiddenError } from "../../../core/index.js";
import { authorizeContentEdit, createContentTargetPorts } from "../../../taxonomy/site/content-targets.js";
import {
  TaxonomyNotApplicableError,
  WorkspaceMismatchError,
  ContentTypeMismatchError,
  assignTerms,
  unassignTerms,
  ContentRecordNotFoundError,
  TermRecordNotFoundError,
  type CollectionOwnerLookupPort,
  type EntryRecordLookupPort,
  type EntryTermRepoPort,
  type UnassignableEntryTermRepoPort,
} from "../../../taxonomy/index.js";
import {
  rejectTaxonomyError,
  taxonomyPrincipal,
  taxonomyWriteServiceDeps,
  type TaxonomyErrorRefusal,
  type TaxonomyRoutePrincipal,
  type TaxonomyWriteRouteDeps,
} from "./shared.js";

/** The deps these routes read: the write deps plus the entry/collection lookups tagging resolves
 *  content through, and an assignment repo that can also remove and list a target's terms. */
export interface TaxonomyAssignTermsRouteDeps extends TaxonomyWriteRouteDeps {
  entryTermRepo: EntryTermRepoPort & UnassignableEntryTermRepoPort & {
    listForContent(params: { contentType: string; contentId: string }): Promise<readonly { termId: string }[]>;
  };
  entryRepo: EntryRecordLookupPort;
  contentTypeRepo: CollectionOwnerLookupPort;
}

/** The shared `{ contentType, contentId, termIds }` body. */
export interface TaxonomyAssignmentInput { contentType: string; contentId: string; termIds: string[] }

/** The content target `assigned-terms` reads. */
export interface TaxonomyAssignedTermsInput { contentType: string; contentId: string }

type AssignmentSpec<Input, Output> = JsonRouteSpec<Input, Output, TaxonomyAssignTermsRouteDeps, TaxonomyRoutePrincipal>;

/** The `EntityNotLiveError` arm is S10 (web-high fix plan, 2026-09-24) — assigning terms to a
 * trashed post/page now 409s instead of silently joining terms to it. */
const ASSIGNMENT_REFUSALS: readonly TaxonomyErrorRefusal[] = [
  { classes: [EntityNotLiveError], status: 409 },
  { classes: [ForbiddenError], status: 403, code: "FORBIDDEN" },
  { classes: [TermRecordNotFoundError], status: 404, code: "TERM_NOT_FOUND" },
  { classes: [ContentRecordNotFoundError], status: 404, code: "CONTENT_NOT_FOUND" },
  { classes: [TaxonomyNotApplicableError, WorkspaceMismatchError, ContentTypeMismatchError], status: 400, code: "VALIDATION_ERROR" },
];

const TAXONOMY_PERMISSION = "admin.taxonomy.manage";

/** The write service's deps for one assignment call: posts/pages and collection entries both
 *  resolve, and an entry takes any taxonomy while its collection is live (`createContentTargetPorts`).
 * @complexity O(1) — builds adapters, no I/O. */
function assignmentDeps({ deps }: { deps: TaxonomyAssignTermsRouteDeps }, _optional: Record<string, never> = {}) {
  return { ...taxonomyWriteServiceDeps({ deps, contentTargets: createContentTargetPorts(deps) }), entryTerms: deps.entryTermRepo };
}

/** The shared `{ contentType, contentId, termIds }` body, or the 400 refusal.
 * @complexity O(1). */
const parseAssignmentBody: AssignmentSpec<TaxonomyAssignmentInput, void>["parse"] = (raw) => {
  const { contentType, contentId, termIds } = (raw.body ?? {}) as Record<string, unknown>;
  if (typeof contentType !== "string" || typeof contentId !== "string" || !Array.isArray(termIds)) {
    rejectRoute({ status: 400, error: "'contentType', 'contentId' (strings), and 'termIds' (array) are required", code: "VALIDATION_ERROR" });
  }
  return ok({ value: { contentType, contentId, termIds: termIds as string[] } });
};

/** One assignment write: the content's own edit permission, then `write` (which checks
 *  `admin.taxonomy.manage` itself); 204 on success.
 * @complexity O(1) beyond the write service. */
function assignmentWriteRoute(
  { path, write }: { path: string; write: (required: { deps: ReturnType<typeof assignmentDeps>; principalId: string; actor: MutationActor | undefined } & TaxonomyAssignmentInput) => Promise<unknown> },
  _optional: Record<string, never> = {},
): AssignmentSpec<TaxonomyAssignmentInput, void> {
  return defineJsonRoute<TaxonomyAssignmentInput, void, TaxonomyAssignTermsRouteDeps, TaxonomyRoutePrincipal>({
    method: "post",
    path,
    parse: parseAssignmentBody,
    handle: async ({ input, deps, context }) => {
      const principal = taxonomyPrincipal({ context });
      try {
        await authorizeContentEdit({ deps, principalId: principal.id, contentType: input.contentType });
        await write({ deps: assignmentDeps({ deps }), principalId: principal.id, actor: deps.mutationActor?.({ principalId: principal.id }), ...input });
        return ok({ value: undefined });
      } catch (err) {
        return rejectTaxonomyError({ err, outwardErrorMessage: deps.outwardErrorMessage, refusals: ASSIGNMENT_REFUSALS });
      }
    },
  }, { successStatus: 204 });
}

/**
 * @file design-spec.md §1.6/§2.8 — `POST /api/admin/v1/taxonomy/assign-terms` (the `<TermPicker>`
 * shared by Collections §1.6 and Categories & Tags §2.2, AC-17/AC-20/INV-05/REQ-13/REQ-14).
 * Gated by `admin.taxonomy.manage`.
 *
 * ADR-041/043/044/045 re-audit (2026-07-16, TM-adr041-043-044-045-audit-001, Finding 1 fix):
 * `assignTerms` now runs `validation-chain.ts`'s `validateContentJoin` allow-list/workspace/lens
 * chain via a content lookup (the "content repo port" the old disclosed-gap comment said this
 * needed). Since 2026-09-26 that lookup also resolves collection entries, admitted by the same
 * live-collection policy publishing uses. Tagging also needs the content's own edit permission:
 * `content.write` for a post/page, `admin.collections.manage` for an entry.
 */
export const taxonomyAssignTermsRoute = assignmentWriteRoute({ path: "/api/admin/v1/taxonomy/assign-terms", write: assignTerms });

/**
 * `POST /api/admin/v1/taxonomy/unassign-terms` — the removal half the post, page and entry editors'
 * Categories & Tags box saves with (`unassignTerms`: same permission, target and term checks as assign;
 * removing a term that is not assigned is a no-op).
 */
export const taxonomyUnassignTermsRoute = assignmentWriteRoute({ path: "/api/admin/v1/taxonomy/unassign-terms", write: unassignTerms });

/**
 * `GET /api/admin/v1/taxonomy/assigned-terms?contentType=&contentId=` — `{ termIds }`, the terms one
 * post, page or entry holds now, so the editor shows them ticked. Same permissions as a write.
 */
export const taxonomyAssignedTermsRoute = defineJsonRoute<TaxonomyAssignedTermsInput, { termIds: string[] }, TaxonomyAssignTermsRouteDeps, TaxonomyRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/taxonomy/assigned-terms",
  parse: (raw) => {
    const { contentType, contentId } = raw.query;
    if (typeof contentType !== "string" || typeof contentId !== "string" || contentType === "" || contentId === "") {
      rejectRoute({ status: 400, error: "'contentType' and 'contentId' query parameters are required", code: "VALIDATION_ERROR" });
    }
    return ok({ value: { contentType, contentId } });
  },
  handle: async ({ input, deps, context }) => {
    const principal = taxonomyPrincipal({ context });
    try {
      const allowed = await deps.authorize({ principalId: principal.id, permission: TAXONOMY_PERMISSION, workspaceId: deps.workspaceId });
      if (!allowed.allowed) {
        throw new ForbiddenError({ message: `principal '${principal.id}' is not authorized for '${TAXONOMY_PERMISSION}' (${allowed.reason})`, permission: TAXONOMY_PERMISSION, reason: allowed.reason });
      }
      await authorizeContentEdit({ deps, principalId: principal.id, contentType: input.contentType });
      const rows = await deps.entryTermRepo.listForContent(input);
      return ok({ value: { termIds: rows.map((row) => row.termId).sort() } });
    } catch (err) {
      return rejectTaxonomyError({ err, outwardErrorMessage: deps.outwardErrorMessage, refusals: ASSIGNMENT_REFUSALS });
    }
  },
});
