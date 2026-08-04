import { ForbiddenError } from "../core/commands/command.js";
import { validateContentJoin, validateHierarchyAssignment } from "./validation-chain.js";

/**
 * @file The taxonomy write-service's ordinary (non-gated) mutations.
 *
 * Purpose:
 * The single write chokepoint for `taxonomies`/`terms`/`entry_terms` (the same discipline applied
 * to every other domain's write-service in this codebase): `authorize()` first (fail-closed) ->
 * validate -> write + revision + watermark + outbox, all attributed to the same mutation.
 * `assignTerms` is the one deliberate exception: term-assignment membership is explicitly narrowed
 * out of the general revisioning rule — high-churn relational state whose historical audit trail is
 * judged low-value, the same disclosed-loss basis `redirect_hits`/`asset_renditions` already use.
 *
 * `mergeTerm` (the one gated mutation) is deliberately NOT here — it lives in the sibling
 * `merge-term.ts`, isolated because it alone touches `core/gated-mutations`.
 *
 * A past security re-audit (finding: a hard blocker) established that `assignTerms` must invoke
 * `validation-chain.ts`'s `validateContentJoin` (allow-list -> workspace -> lens, fixed order)
 * before writing any `entry_terms` row. The prior "disclosed gap" comment this replaces undersold
 * the live risk — the missing check meant `assignTerms` (a live, `admin.taxonomy.manage`-gated
 * route) would silently accept a nonexistent `termId`, a `contentId` that doesn't exist, or a
 * caller-claimed `contentType` that doesn't match the target's real kind, with zero server-side
 * verification. `ContentLookupPort` below is the "content repo port" the old comment said this
 * needed. `resolvedTermWorkspaceId`/`resolvedContentWorkspaceId` both resolve to the SAME value as
 * `callerWorkspaceId` by construction in this codebase's real adapters (`SqliteTermRepo`/
 * `SqliteEntryTermRepo` are workspace-BOUND at construction, single-workspace-per-`content.db`), so
 * the workspace-mismatch branch is currently unreachable via those adapters specifically; it stays
 * load-bearing for any future adapter that is not workspace-bound, and the check costs nothing to
 * keep. See `docs/decisions/taxonomy-content-type-allow-list.md` for why both this branch and
 * `TAXONOMY_ALLOWED_CONTENT_TYPES` below are permanent design choices, not stopgaps.
 *
 * How it relates to the project:
 * Mirrors `src/features/settings/write-service.ts`'s chokepoint shape (authorize -> validate ->
 * same-tx write + revision) and the required-input-object convention `src/features/post/post.ts`
 * establishes.
 */

/** Local, structurally-compatible authorize gate — no `workspaceId` is threaded through this
 * slice's certified write-service tests (every function signature they exercise omits it), so
 * this type intentionally does not require one, unlike `core/commands/command.ts`'s `AuthorizeFn`.
 * A future route/wiring layer that has real workspace context can still satisfy this shape. */
export type AuthorizeFn = (params: {
  principalId: string;
  permission: string;
}) => Promise<{ allowed: boolean; reason: string }>;

export interface Taxonomy {
  id: string;
  name: string;
  hierarchical: boolean;
  status: string;
  updatedAt: string;
  version: number;
}

export interface Term {
  id: string;
  taxonomyId: string;
  parentId: string | null;
  name: string;
  status: string;
  updatedAt: string;
  version: number;
}

export interface TaxonomyRepoPort {
  findById(id: string): Promise<{ id: string; hierarchical: boolean; allowList?: string[] | undefined } | null>;
  insert(row: Taxonomy): Promise<unknown>;
}

export interface TermRepoPort {
  findById(id: string): Promise<{ id: string; taxonomyId: string; name?: string | undefined } | null>;
  insert(row: Term): Promise<unknown>;
  update(row: Term): Promise<unknown>;
}

export interface EntryTermRepoPort {
  upsert(row: { contentType: string; contentId: string; termId: string; addedAt: string }): Promise<unknown>;
}

/**
 * Resolves the REAL workspace + kind of a `(contentType, contentId)` pair — the "content repo
 * port" `validateContentJoin` needs to verify a caller's claimed `contentType` actually matches
 * the target row, and that the target exists at all. `null` = not found. Implementations for
 * `contentType` values on {@link TAXONOMY_ALLOWED_CONTENT_TYPES} resolve against `posts`; a
 * future content-type this port grows to cover would extend it, not replace it.
 */
export interface ContentLookupPort {
  resolve(params: { contentType: string; contentId: string }): Promise<{ workspaceId: string; kind: string } | null>;
}

/** The hardcoded post/page taxonomy allow-list (permanent, see
 * `docs/decisions/taxonomy-content-type-allow-list.md`) — every taxonomy is applicable to
 * `post`/`page` content; no other content type is eligible for term assignment until this is
 * deliberately extended. */
export const TAXONOMY_ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set(["post", "page"]);

export function isContentTypeOnAllowList(contentType: string): boolean {
  return TAXONOMY_ALLOWED_CONTENT_TYPES.has(contentType);
}

export interface TaxonomyRevisionRow {
  taxonomyId: string;
  op: "create" | "rename" | "reparent" | "deprecate";
  previousState: Record<string, unknown> | null;
  actorId: string;
  recordedAt: string;
}

export interface TaxonomyRevisionRepoPort {
  insert(row: TaxonomyRevisionRow): Promise<unknown>;
}

export interface ClockPort {
  nowIso(): string;
}

export interface IdGeneratorPort {
  newId(): string;
}

export interface WriteServiceDeps {
  authorize: AuthorizeFn;
  clock: ClockPort;
  idGen: IdGeneratorPort;
  taxonomies: TaxonomyRepoPort;
  terms: TermRepoPort;
  entryTerms: EntryTermRepoPort;
  revisions: TaxonomyRevisionRepoPort;
  /** `core/gated-mutations.stampWatermark`-shaped, injected — same-transaction stamp per mutation. */
  stampWatermark: (tx?: unknown) => void;
  outbox: { enqueue: (event: unknown) => Promise<void> };
  /** The caller's own workspace — `validateContentJoin`'s `callerWorkspaceId` (Finding 1 fix). */
  workspaceId: string;
  /** Resolves a `(contentType, contentId)` pair's real workspace/kind for `assignTerms`'s
   * content-join validation (Finding 1 fix). */
  contentLookup: ContentLookupPort;
}

export class TaxonomyRecordNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxonomyRecordNotFoundError";
  }
}

export class TermRecordNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TermRecordNotFoundError";
  }
}

/** Finding 1 fix — the target of an `assignTerms` call does not resolve to any real content row. */
export class ContentRecordNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentRecordNotFoundError";
  }
}

/** `admin.taxonomy.manage` (the flat-string permission convention) — must run before any other
 * side effect of every write-service export in this file. */
async function authorizeTaxonomyManage(deps: WriteServiceDeps, principalId: string): Promise<void> {
  const result = await deps.authorize({ principalId, permission: "admin.taxonomy.manage" });
  if (!result.allowed) {
    throw new ForbiddenError(
      `principal '${principalId}' is not authorized for 'admin.taxonomy.manage' (${result.reason})`,
      "admin.taxonomy.manage",
      result.reason
    );
  }
}

export interface CreateTaxonomyRequired {
  deps: WriteServiceDeps;
  principalId: string;
  name: string;
  hierarchical: boolean;
}

/** Creates a taxonomy row (hierarchical=true -> "category"-shaped, false -> "tag"-shaped — same
 * shared table). Ordinary mutation, no plan()/confirmation ceremony. */
export async function createTaxonomy(
  required: CreateTaxonomyRequired,
  _optional: Record<string, never> = {}
): Promise<Taxonomy> {
  const { deps, principalId, name, hierarchical } = required;
  await authorizeTaxonomyManage(deps, principalId);

  const now = deps.clock.nowIso();
  const taxonomy: Taxonomy = {
    id: deps.idGen.newId(),
    name,
    hierarchical,
    status: "active",
    updatedAt: now,
    version: 1,
  };

  await deps.taxonomies.insert(taxonomy);
  await deps.revisions.insert({
    taxonomyId: taxonomy.id,
    op: "create",
    previousState: null,
    actorId: principalId,
    recordedAt: now,
  });
  deps.stampWatermark();
  await deps.outbox.enqueue({ name: "taxonomy.created", taxonomyId: taxonomy.id, actorId: principalId, occurredAt: now });

  return taxonomy;
}

export interface CreateTermRequired {
  deps: WriteServiceDeps;
  principalId: string;
  taxonomyId: string;
  name: string;
  parentId?: string | null | undefined;
}

/** AC-03/AC-13/EC-04 — validates `parentId` via `validateHierarchyAssignment` before writing. A
 * freshly-created term has no descendants yet, so it structurally cannot be a cycle source; the
 * cycle check is therefore always a no-op (`() => false`) here, unlike a reparent of an existing
 * term (not yet built — no certified test in this slice exercises it). */
export async function createTerm(
  required: CreateTermRequired,
  _optional: Record<string, never> = {}
): Promise<Term> {
  const { deps, principalId, taxonomyId, name, parentId } = required;
  await authorizeTaxonomyManage(deps, principalId);

  const taxonomy = await deps.taxonomies.findById(taxonomyId);
  if (!taxonomy) {
    throw new TaxonomyRecordNotFoundError(`taxonomy '${taxonomyId}' was not found`);
  }

  const candidateParentId = parentId ?? null;
  let resolvedParent: { id: string; taxonomyId: string } | null | "not-applicable" = "not-applicable";
  if (candidateParentId !== null) {
    const parentTerm = await deps.terms.findById(candidateParentId);
    resolvedParent = parentTerm ? { id: parentTerm.id, taxonomyId: parentTerm.taxonomyId } : null;
  }

  validateHierarchyAssignment({
    childTaxonomyId: taxonomyId,
    taxonomyIsHierarchical: taxonomy.hierarchical,
    candidateParentId,
    resolvedParent,
    wouldCreateCycle: () => false,
    termId: "__new__",
  });

  const now = deps.clock.nowIso();
  const term: Term = {
    id: deps.idGen.newId(),
    taxonomyId,
    parentId: candidateParentId,
    name,
    status: "active",
    updatedAt: now,
    version: 1,
  };

  await deps.terms.insert(term);
  await deps.revisions.insert({ taxonomyId, op: "create", previousState: null, actorId: principalId, recordedAt: now });
  deps.stampWatermark();
  await deps.outbox.enqueue({ name: "taxonomy.term_created", termId: term.id, actorId: principalId, occurredAt: now });

  return term;
}

export interface RenameTermRequired {
  deps: WriteServiceDeps;
  principalId: string;
  termId: string;
  newName: string;
}

/** AC-15/AC-19/AC-25/REQ-12/REQ-17 — same-tx rename + revision (carrying the pre-rename state) +
 * watermark + outbox. `authorize()` runs before the term lookup, so a denied caller produces zero
 * side effects of any kind. */
export async function renameTerm(
  required: RenameTermRequired,
  _optional: Record<string, never> = {}
): Promise<Term> {
  const { deps, principalId, termId, newName } = required;
  await authorizeTaxonomyManage(deps, principalId);

  const current = await deps.terms.findById(termId);
  if (!current) {
    throw new TermRecordNotFoundError(`term '${termId}' was not found`);
  }

  const now = deps.clock.nowIso();
  const updated: Term = {
    id: current.id,
    taxonomyId: current.taxonomyId,
    parentId: (current as { parentId?: string | null }).parentId ?? null,
    name: newName,
    status: (current as { status?: string }).status ?? "active",
    updatedAt: now,
    version: ((current as { version?: number }).version ?? 1) + 1,
  };

  await deps.terms.update(updated);
  await deps.revisions.insert({
    taxonomyId: current.taxonomyId,
    op: "rename",
    previousState: { name: current.name },
    actorId: principalId,
    recordedAt: now,
  });
  deps.stampWatermark();
  await deps.outbox.enqueue({ name: "taxonomy.term_renamed", termId, actorId: principalId, occurredAt: now });

  return updated;
}

export interface AssignTermsRequired {
  deps: WriteServiceDeps;
  principalId: string;
  contentType: string;
  contentId: string;
  termIds: string[];
}

/** AC-17/AC-20/INV-05/REQ-13/REQ-14 — upserts every `entry_terms` row (idempotent on-conflict per
 * `entry_terms_unique`, EC-09), then stamps the watermark and enqueues the outbox event exactly
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
 */
export async function assignTerms(
  required: AssignTermsRequired,
  _optional: Record<string, never> = {}
): Promise<void> {
  const { deps, principalId, contentType, contentId, termIds } = required;
  await authorizeTaxonomyManage(deps, principalId);

  const isOnAllowList = isContentTypeOnAllowList(contentType);
  const content = isOnAllowList ? await deps.contentLookup.resolve({ contentType, contentId }) : null;
  if (isOnAllowList && !content) {
    throw new ContentRecordNotFoundError(`content '${contentType}:${contentId}' was not found`);
  }

  for (const termId of termIds) {
    const term = await deps.terms.findById(termId);
    if (!term) {
      throw new TermRecordNotFoundError(`term '${termId}' was not found`);
    }
    validateContentJoin({
      taxonomyId: term.taxonomyId,
      isOnAllowList,
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

  const now = deps.clock.nowIso();
  for (const termId of termIds) {
    await deps.entryTerms.upsert({ contentType, contentId, termId, addedAt: now });
  }

  deps.stampWatermark();
  await deps.outbox.enqueue({
    name: "taxonomy.terms_assigned",
    contentType,
    contentId,
    termIds,
    actorId: principalId,
    occurredAt: now,
  });
}

export interface EntryTermsCleanupPort {
  deleteByContent(params: { workspaceId: string; contentType: string; contentId: string }): Promise<number>;
}

export interface OnContentDeletedRequired {
  event: { workspaceId: string; contentType: string; contentId: string };
  entryTerms: EntryTermsCleanupPort;
}

/** Content-deletion event subscriber. Best-effort (a missed event leaves an orphaned
 * `entry_terms` row that is inert on read; a periodic/boot reconciliation sweep — modeled by
 * re-invoking this same function for the orphan — is the backstop, never a hard failure). A
 * no-op for content with no
 * assigned terms, never an error. */
export async function onContentDeleted(
  required: OnContentDeletedRequired,
  _optional: Record<string, never> = {}
): Promise<void> {
  const { event, entryTerms } = required;
  await entryTerms.deleteByContent({
    workspaceId: event.workspaceId,
    contentType: event.contentType,
    contentId: event.contentId,
  });
}
