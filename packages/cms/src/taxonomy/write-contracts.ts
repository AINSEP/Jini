import type { Clock, IdGenerator } from "@jini-ai/core/primitives";

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
  findById({ id }: { id: string }): Promise<{ id: string; hierarchical: boolean; allowList?: string[] | undefined } | null>;
  insert(row: Taxonomy): Promise<unknown>;
}

export interface TermRepoPort {
  findById({ id }: { id: string }): Promise<{ id: string; taxonomyId: string; name?: string | undefined } | null>;
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

/** : the content_types registry's per-type taxonomy allow-list for Collections entries
 * (parallel to, never folded into, TAXONOMY_ALLOWED_CONTENT_TYPES — see the decision note).
 * `null` = not a live registry type (not applicable).
 * See docs/decisions/DR-005-ordered-taxonomy-validation.md.
 */
type ApplicableTaxonomies = "all" | ReadonlySet<string> | null;
export interface ContentTypeTaxonomyPolicyPort {
  taxonomiesFor(params: { contentType: string }): Promise<ApplicableTaxonomies>;
}

export interface TaxonomyRevisionRow {
  taxonomyId: string;
  /** `"delete"` added for `deleteTerm`/`deleteTaxonomy` below — unlike `mergeTerm`'s reuse of
   * `"deprecate"` (that ceremony's own header explains why widening this union was out of its
   * scope), a delete has no honest fit among the other four ops, so this widens the union rather
   * than overloading an existing member. */
  op: "create" | "rename" | "reparent" | "deprecate" | "delete" | "import";
  previousState: Record<string, unknown> | null;
  actorId: string;
  recordedAt: string;
}

export interface TaxonomyRevisionRepoPort {
  insert(row: TaxonomyRevisionRow): Promise<unknown>;
}


export interface WriteServiceDeps {
  authorize: AuthorizeFn;
  clock: Clock;
  idGen: IdGenerator;
  taxonomies: TaxonomyRepoPort;
  terms: TermRepoPort;
  entryTerms: EntryTermRepoPort;
  revisions: TaxonomyRevisionRepoPort;
  /** `core/gated-mutations.stampWatermark`-shaped, injected — same-transaction stamp per mutation.
   * May be sync (SQLite) or async (PGlite/Postgres); every call site awaits it, so an async stamp
   * finishes, and its failure fails the write, before the mutation returns. */
  stampWatermark: (required: Record<string, never>, optional?: { tx?: unknown }) => Promise<void> | void;
  outbox: { enqueue: ({ event }: { event: unknown }) => Promise<void> };
  /** The caller's own workspace — `validateContentJoin`'s `callerWorkspaceId` (Finding 1 fix). */
  workspaceId: string;
  /** Resolves a `(contentType, contentId)` pair's real workspace/kind for `assignTerms`'s
   * content-join validation (Finding 1 fix). */
  contentLookup: ContentLookupPort;
  /** Per-content-type taxonomy allow-list for Collections entries (A1, taxonomy plan). Optional so
   * other hosts (and every existing test double) don't break — a host that omits it simply never
   * makes a non-post/page `contentType` resolvable, matching today's behavior exactly. */
  contentTypeTaxonomyPolicy?: ContentTypeTaxonomyPolicyPort;
}
