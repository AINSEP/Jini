import type { MutationActor } from "@jini-ai/core/contracts/events";
import { checkedMutationActor } from "../core/mutation-actor.js";
import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
import { validateContentJoin } from "./validation-chain.js";
import type { EntryTermRepoPort, WriteServiceDeps } from "./write-contracts.js";
import { TermRecordNotFoundError, ContentRecordNotFoundError, authorizeTaxonomyManage } from "./write-validation.js";

/** The hardcoded post/page taxonomy allow-list (permanent, see
 * `docs/decisions/taxonomy-content-type-allow-list.md`) — every taxonomy is applicable to
 * `post`/`page` content. This set is never grown to admit a Collection's content-type key; a
 * Collection entry instead becomes eligible through {@link ContentTypeTaxonomyPolicyPort} above,
 * an intentionally parallel (not layered) per-content-type policy carried by a host's own
 * `content_types` registry. */
export const TAXONOMY_ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set(["post", "page"]);

export function isContentTypeOnAllowList(requiredArgs: { contentType: string }, optionalArgs: Record<string, never> = {}): boolean {
  const { contentType } = requiredArgs;
  return TAXONOMY_ALLOWED_CONTENT_TYPES.has(contentType);
}

export interface AssignTermsRequired {
  deps: WriteServiceDeps;
  principalId: string;
  /** Trusted attribution from the caller's execution channel (admin route `user`, assistant tool
   *  `agent`); its `id` must be `principalId`. Optional for now: omitted, the event records no actor. */
  actor?: MutationActor | undefined;
  contentType: string;
  contentId: string;
  termIds: string[];
}

/**
 * A1 (taxonomy plan) — shared by `assignTerms` and `unassignTerms`: resolves whether
 * `(contentType, contentId)` is a real, eligible target and validates every `termId` against it,
 * BEFORE either caller writes anything. Extracted from `assignTerms` verbatim (same order, same
 * errors) so `unassignTerms` inherits the exact same content-join guarantees rather than a
 * re-derived copy that could drift.
 *
 * `post`/`page` keep today's behavior exactly: `isPostOrPage` short-circuits before
 * `contentTypeTaxonomyPolicy` is ever consulted. A non-post/page `contentType` is
 * resolvable only when a policy is wired AND that policy doesn't return `null` (not applicable) —
 * an unknown `contentType` (no policy, or a policy returning `null`) stays unresolvable, so it
 * still fails at `validateContentJoin`'s allow-list check (`TaxonomyNotApplicableError`), not a
 * `ContentRecordNotFoundError` — this is what keeps `"product"` a 400, not a 404.
 * See docs/decisions/DR-005-ordered-taxonomy-validation.md.
 */
async function validateAssignmentTarget(required: {
  deps: WriteServiceDeps;
  contentType: string;
  contentId: string;
  termIds: string[];
}): Promise<void> {
  const { deps, contentType, contentId, termIds } = required;
  const { isPostOrPage, policy } = await resolveTaxonomyPolicy({ deps, contentType });
  const content = await resolveAssignmentContent({ deps, contentType, contentId, isResolvable: isPostOrPage || policy !== null });

  for (const termId of termIds) {
    const term = await deps.terms.findById({ id: termId });
    if (!term) {
      throw new TermRecordNotFoundError({ message: `term '${termId}' was not found` });
    }
    validateContentJoin({
      taxonomyId: term.taxonomyId,
      isOnAllowList: isTaxonomyAllowedForTarget({ isPostOrPage, policy, taxonomyId: term.taxonomyId }),
      callerWorkspaceId: deps.workspaceId,
      // `SqliteTermRepo`/`SqliteEntryTermRepo` are workspace-BOUND at construction (single
      // workspace per content.db) — a term/content row that resolves via those adapters at all
      // is, by construction, already in the caller's own workspace. See this file's header.
      resolvedTermWorkspaceId: deps.workspaceId,
      resolvedContentWorkspaceId: content?.workspaceId ?? deps.workspaceId,
      suppliedContentType: contentType,
      resolvedContentKind: content?.kind ?? contentType,
    });
  }
}

/** `post`/`page` short-circuit before `contentTypeTaxonomyPolicy` is ever consulted; any other
 * `contentType` gets the wired policy's answer, or `null` (not applicable) when none is wired. */
async function resolveTaxonomyPolicy(required: {
  deps: WriteServiceDeps;
  contentType: string;
}): Promise<{ isPostOrPage: boolean; policy: "all" | ReadonlySet<string> | null }> {
  const { deps, contentType } = required;
  const isPostOrPage = isContentTypeOnAllowList({ contentType: contentType });
  if (isPostOrPage || !deps.contentTypeTaxonomyPolicy) return { isPostOrPage, policy: null };
  return { isPostOrPage, policy: await deps.contentTypeTaxonomyPolicy.taxonomiesFor({ contentType }) };
}

/** Resolves the assignment target once per call. An unresolvable `contentType` is never looked up
 * (`null`) so it fails later at the allow-list check, not here; a resolvable one must exist. */
async function resolveAssignmentContent(required: {
  deps: WriteServiceDeps;
  contentType: string;
  contentId: string;
  isResolvable: boolean;
}): Promise<{ workspaceId: string; kind: string } | null> {
  const { deps, contentType, contentId, isResolvable } = required;
  if (!isResolvable) return null;
  const content = await deps.contentLookup.resolve({ contentType, contentId });
  if (!content) {
    throw new ContentRecordNotFoundError({ message: `content '${contentType}:${contentId}' was not found` });
  }
  return content;
}

/** Whether a term's taxonomy is applicable to the target: always for `post`/`page`, else per the
 * policy (`"all"`, or membership in its Set). */
function isTaxonomyAllowedForTarget(required: {
  isPostOrPage: boolean;
  policy: "all" | ReadonlySet<string> | null;
  taxonomyId: string;
}): boolean {
  const { isPostOrPage, policy, taxonomyId } = required;
  return isPostOrPage || policy === "all" || (policy instanceof Set && policy.has(taxonomyId));
}

/** — upserts every `entry_terms` row (idempotent on-conflict per
 * `entry_terms_unique`), then stamps the watermark and enqueues the outbox event exactly
 * ONCE per call regardless of `termIds.length` — never once per term. Never produces a
 * `taxonomy_revisions` row (see this file's header for the disclosed narrowing this implements).
 *
 * Finding 1 fix (TM-adr041-043-044-045-audit-001): every `termId` is validated via
 * `validateContentJoin` (allow-list -> workspace -> lens, `validation-chain.ts`'s fixed order)
 * BEFORE any `entry_terms` row is written — every termId must resolve to a real term, and the
 * target content must resolve to a real row whose kind matches the caller-supplied `contentType`.
 * Validation runs for ALL termIds before ANY write, so a failure partway through never leaves a
 * partial assignment. Content is resolved once per call (not once per term) since every term in
 * one call shares the same `(contentType, contentId)` target.
 * See docs/decisions/DR-005-ordered-taxonomy-validation.md.
 */
export async function assignTerms(
  required: AssignTermsRequired,
  _optional: Record<string, never> = {}
): Promise<void> {
  const { deps, principalId, contentType, contentId, termIds } = required;
  // The execution channel supplies attribution, the principal ID still governs authorization, and
  // the two are not interchangeable: refuse an actor naming someone else before any write.
  const actor = checkedMutationActor({ principalId, actor: required.actor });
  await authorizeTaxonomyManage(deps, principalId);

  await validateAssignmentTarget({ deps, contentType, contentId, termIds });

  const now = kernelNowIso({ clock: deps.clock });
  for (const termId of termIds) {
    await deps.entryTerms.upsert({ contentType, contentId, termId, addedAt: now });
  }

  await deps.stampWatermark({});
  await deps.outbox.enqueue({
    event: {
      name: "taxonomy.terms_assigned",
      contentType,
      contentId,
      termIds,
      actorId: principalId,
      ...(actor ? { actor } : {}),
      occurredAt: now,
    }
  });
}

/** A2 (taxonomy plan) — the removal half of `assignTerms`. `remove()` lives on an additive port
 * (`UnassignableEntryTermRepoPort`) rather than widening the certified `EntryTermRepoPort`, the
 * same precedent `AssignmentCountEntryTermRepoPort` already set for `deleteTerm`/`deleteTaxonomy`. */
export interface UnassignableEntryTermRepoPort {
  remove(row: { contentType: string; contentId: string; termId: string }): Promise<number>;
}

export interface UnassignTermsRequired {
  deps: Omit<WriteServiceDeps, "entryTerms"> & { entryTerms: EntryTermRepoPort & UnassignableEntryTermRepoPort };
  principalId: string;
  /** Trusted attribution from the caller's execution channel (admin route `user`, assistant tool
   *  `agent`); its `id` must be `principalId`. Optional for now: omitted, the event records no actor. */
  actor?: MutationActor | undefined;
  contentType: string;
  contentId: string;
  termIds: string[];
}

/** — spec debt this codebase never built (the spec
 * always named "assign/unassign tools"; only `assignTerms` shipped). Same
 * authorize -> validateAssignmentTarget -> write -> stamp -> outbox chokepoint as `assignTerms`,
 * and — like `assignTerms` — never produces a `taxonomy_revisions` row ( disclosed
 * narrowing applies equally to removal). Idempotent: unassigning a row that isn't there is a no-op,
 * not an error. Only removed ids are returned, stamped, and emitted; an entirely absent set is a no-op. Chosen over
 * a "set terms" replace call — see the taxonomy plan's "What the docs settle" #3 for why replace
 * risks silently erasing a concurrent assignment.
 * See docs/decisions/DR-005-ordered-taxonomy-validation.md.
 */
export async function unassignTerms(
  required: UnassignTermsRequired,
  _optional: Record<string, never> = {}
): Promise<{ removedTermIds: string[] }> {
  const { deps, principalId, contentType, contentId, termIds } = required;
  // The execution channel supplies attribution, the principal ID still governs authorization, and
  // the two are not interchangeable: refuse an actor naming someone else before any write.
  const actor = checkedMutationActor({ principalId, actor: required.actor });
  await authorizeTaxonomyManage(deps, principalId);

  await validateAssignmentTarget({ deps, contentType, contentId, termIds });

  const removedTermIds: string[] = [];
  for (const termId of termIds) {
    if (await deps.entryTerms.remove({ contentType, contentId, termId }) > 0) removedTermIds.push(termId);
  }
  if (removedTermIds.length === 0) return { removedTermIds };

  const now = kernelNowIso({ clock: deps.clock });
  await deps.stampWatermark({});
  await deps.outbox.enqueue({
    event: {
      name: "taxonomy.terms_unassigned",
      contentType,
      contentId,
      termIds: removedTermIds,
      actorId: principalId,
      ...(actor ? { actor } : {}),
      occurredAt: now,
    }
  });
  return { removedTermIds };
}
