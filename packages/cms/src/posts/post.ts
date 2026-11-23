import type { UUID, JsonObject } from "@jini-ai/core/primitives";
import type { PostStatus, PublicPostKind } from "../core/index.js";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";

/**
 * The `posts.kind` of an email template (`features/email-templates`). Deliberately NOT a
 * public post/page: a template is stored as an `"html"`-format row through the Pages HTML store, the
 * same storage a bespoke Page uses, but it is never a post or a page — no admin list, no public URL.
 * Every reader that filters on `kind === "post"`/`"page"` therefore never sees one, and
 * {@link updatePost} refuses one as not-found, which is what keeps a template a `"draft"` forever:
 * `updatePost` is the only path that changes `status`, so a template can never be published onto
 * the public site through the kind-blind post tools.
 */
export const EMAIL_TEMPLATE_KIND = "email-template";

/** The kinds the Pages HTML store may birth as `"html"`-format rows. */
export const HTML_DOCUMENT_KINDS: ReadonlySet<string> = new Set(["page", EMAIL_TEMPLATE_KIND]);

/**
 * SPEC-047/ADR-056 Decision 3 — discriminates which body column a record actually carries.
 * `"doc"` (the only value this chokepoint ever writes in v1, see {@link resolveBodyFields}) is a
 * TipTap/ProseMirror document in `bodyJson`; `"html"` is a bespoke-HTML Page written only through
 * `PagesHtmlDocumentStore` (`features/pages/html-document-store.sqlite.ts`), a separate adapter that never calls
 * `createPost`/`updatePost` — this chokepoint can construct only `"doc"` records, by design (CIC-3).
 */
export type PostBodyFormat = "doc" | "html";

export interface PostRecord {
  id: UUID;
  workspaceId: UUID;
  title: string;
  slug: string;
  bodyJson: JsonObject;
  status: PostStatus;
  kind: PostKind;
  /**
   * SPEC-047/ADR-056 Decision 3 / CIC-3 — always `"doc"` for a record built by
   * `createPost`/`updatePost` (this chokepoint never accepts a caller-supplied value for this
   * field — see {@link resolveBodyFields}). An `"html"`-format Page is a real, distinct row this
   * same `posts` table can hold, but one only `PagesHtmlDocumentStore` ever writes.
   */
  bodyFormat: PostBodyFormat;
  /**
   * SPEC-047/ADR-056 Decision 3 — the bespoke-HTML body for an `"html"`-format Page. Always `null`
   * on a record built by `createPost`/`updatePost` (see {@link bodyFormat}'s doc); populated only by
   * `PagesHtmlDocumentStore`'s own direct write path.
   */
  bodyHtml: string | null;
  updatedAt: string;
  version: number;
  /**
   * SPEC-008 (ADR-PIPE-008 Decision §4) — the raw JSON-serialized per-entry
   * SEO override bag (`SeoExtFields`), or `null` when no overrides have ever
   * been written. Written ONLY through `Jini/packages/cms/src/seo/write-service.ts`'s
   * `setEntrySeoOverrides` chokepoint (INV-01) — no other caller may write
   * this field. Kept as an opaque string here (not parsed) so `post`/its repo
   * adapters stay ignorant of `seo`'s value shape; `seo.ts`/`write-service.ts`
   * own the `JSON.parse`/`JSON.stringify` boundary.
   */
  seoExtJson?: string | null;
  /**
   * SPEC-005 (ADR-005-ARCH REQ-06/BR-06) — the plugin extension-field bag, namespaced per plugin
   * (`{ [pluginId]: { …declaredFields } }`). Written ONLY by the `content.entry.beforeSave`
   * hook-merge step immediately before the single `deps.repo.save()` call below (CIC U-004), plus
   * the typed post-presentation preference merged by this same update owner, and
   * restored verbatim (never recomputed) by the gateway revert path (BR-08, CIC U-005).
   *
   * Absent — not `{}` — when no plugin has ever written to this entry, so an entry with no
   * contributing plugin carries no `ext` object at all on its DTO (AC-14). A namespace whose
   * plugin is later disabled or uninstalled is retained inert here, never deleted (INV-03).
   */
  ext?: JsonObject;
  /**
   * Soft-delete (trash) marker — the ISO timestamp at which this row was moved to trash, or
   * `null`/absent while it is live. Written ONLY through `PostRepoPort.softDelete` (below), which
   * `deletePost` is the sole caller of.
   *
   * Soft, not hard, and that is a decision about this codebase rather than a preference: nothing in
   * The host deletes a content row outright today, and the surrounding machinery is built to make
   * writes recoverable (the command gateway's change-set inverse, `core/commands/appliers.ts`'s
   * reverters, the restore-point/timeline concept). A trashed row keeps every field it had, so
   * `postDeleteReverter` (`appliers.ts`) restores it by clearing this one marker — a hard
   * `DELETE FROM` would have no pre-image to restore from and would break that guarantee.
   *
   * A trashed row STILL HOLDS ITS SLUG, deliberately. `posts_workspace_slug_unique` is a real
   * database constraint, so if trashing freed the slug for reuse, `createPost` would pass its own
   * uniqueness check and then die on a SQLite constraint violation instead of a clean
   * `PostConflictError`. Keeping the slug reserved also keeps a restore lossless. It holds the
   * slug only until a new write claims it, though (owner order 2026-10-08: the Trash never blocks
   * a slug): `createPost`/`updatePost` then move it aside to `<slug>-trashed` first — see
   * `releaseTrashedSlug`, which keeps it restorable. The repo port
   * therefore stays trash-BLIND (`findById`/`findBySlug`/`list` all still return trashed rows, so
   * uniqueness checks and reverters can see them); every trash-AWARE read filter lives in this
   * file's own domain functions, exactly the way `kind` filtering already does.
   */
  deletedAt?: string | null;
  /**
   * Template-picker feature (2026-08-10, unified 2026-08-11) — the `pages/*.html` filename (from the
   * active static theme's `theme.json` `templates` array, e.g. `"blog-post.html"`) this row renders
   * through. Shared by both Posts and Pages (one field, same as the one manifest array it resolves
   * against).
   *
   * Tri-state, and the `null`-vs-`""` difference is load-bearing: `null`/absent means *never chosen*
   * (falls back to the theme's first-listed template at render time for a Post — never for a Page,
   * see `isEligibleForTemplateBranch`'s doc), `""` means the author *explicitly opted out* via the
   * admin picker's "No template chosen" (renders the diagnostic page, not a silent fallback to
   * generic rendering). See `resolveTemplate` (`features/theme/static-render.ts`) for the full
   * rationale.
   */
  templateChoice?: string | null;
  /**
   * Slug-collision override (2026-08-10, tri-state 2026-08-15) — when this post's slug matches one
   * of the active static theme's own page filenames, one of the two resources must win. Tri-state,
   * and the `null`-vs-`false` difference is load-bearing (same shape as {@link templateChoice}'s own
   * `null`-vs-`""` split just above): `null`/absent means *never decided*, so the resolver applies
   * whatever the current default policy is (as of 2026-08-15, the post wins — see `pages.ts`); an
   * explicit `true`/`false` is a permanent author choice, made after the admin UI warns about the
   * collision, that always wins over the default regardless of which way the default is set.
   */
  overridesThemePage?: boolean | null;
  /**
   * Member-gating (2026-09-02 dispatch, ADR-030 §4) — the raw JSON-serialized
   * `MemberContentAccess`, or `null`/absent when nobody has ever gated this entry. Kept as an
   * opaque string here (not parsed) so `post`/its repo adapters stay ignorant of `members`' value
   * shape, the same "owning feature parses its own ext column" contract {@link seoExtJson} already
   * establishes — `features/members/access-resolver.ts`'s `resolvePostMemberAccess` owns the
   * `JSON.parse` boundary and decodes `null`/absent as `{visibility: "public"}`. No admin-facing
   * writer exists yet; see that file's module doc for what a future writer needs.
   */
  memberAccessJson?: string | null;
  /**
   * Authorship attribution (2026-09-18, `posts.created_by_principal_id`) — the id of the
   * {@link CreatePostInput.actorId} principal that created this row, or `null`/absent when that is
   * genuinely unknown (every pre-migration row, and any row created without a known caller). Unlike
   * {@link SYSTEM_ACTOR_ID} — the `post_revisions.actor_id` ledger's own fallback for the identical
   * omission — this field is never fabricated: `createPost` stamps it from `input.actorId` with NO
   * fallback, so an omitted actor stores `null` here even though the same call still attributes a
   * `"system"` revision. Write-once: `updatePost` never sets this field (see {@link buildUpdatedPost},
   * which carries it over unchanged via its `...carriedOver` spread) — `repo.sqlite.ts`'s
   * `updatableColumns()` is the second, structural enforcement of the same rule. This is an
   * ATTRIBUTION field, not an authorization one; nothing may key a permission check off it.
   */
  createdByPrincipalId?: string | null;
  /**
   * Authorship attribution (2026-09-18, `posts.created_at`) — the ISO timestamp `createPost` first
   * wrote this row at, or `null`/absent when that is genuinely unknown (every pre-migration row).
   * Same write-once contract as {@link createdByPrincipalId} — never set by `updatePost`.
   */
  createdAt?: string | null;
  /**
   * Scheduled publishing (2026-10-05, `posts.publish_at`) — the ISO UTC instant a `published` row
   * goes live, or `null`/absent for "live as soon as published". A published row whose `publishAt`
   * is still ahead is SCHEDULED: every public read hides it until then (`isLiveAt`,
   * `contracts/core/scheduled-publish.ts`, which explains why this is not a third status).
   */
  publishAt?: string | null;
  /** Featured image (2026-10-05, `posts.featured_media_id`) — a media asset id, or `null`/absent.
   *  Resolved to a URL only at render time; a trashed/missing asset renders as "no image". */
  featuredMediaId?: string | null;
  /** Editable display credit; independent of creator identity and permissions. */
  author?: string | null;
  /** Explicit opt-in to showing the byline; legacy rows default to false. */
  showAuthor?: boolean;
}

/** A post/page eligible for content readers; publication and trash checks remain separate. */
export interface PublicPostRecord extends PostRecord { kind: PublicPostKind }

/**
 * Narrows stored rows at content-reader boundaries, including accidentally published templates.
 * The scalar signature supports TypeScript's predicate and Array.filter contracts.
 * @complexity O(1) time and space; pure, with no errors or effects.
 */
export function isPublicPost(post: PostRecord | null | undefined): post is PublicPostRecord {
  return post?.kind === "post" || post?.kind === "page";
}

/**
 * Standing-draft autosave for one post/page row (2026-09-06 dispatch — see `posts.autosave_json`'s
 * own schema doc for the column this persists to). Captures exactly the fields the admin editors
 * let an operator change before a real Save/Publish — deliberately NOT `status`: a standing draft
 * never changes whether a row is live, so recovering one can never silently publish or unpublish
 * anything.
 *
 * `baseVersion` is the {@link PostRecord.version} this snapshot was captured against — the seam
 * both {@link PostRepoPort.writeAutosave} (write-time staleness guard) and the recovery-banner
 * caller (read-time "is this still relevant" check) key off, so a draft built on top of content a
 * real save has since superseded is never silently treated as current.
 */
export interface PostAutosaveSnapshot {
  readonly author?: string | null;
  readonly showAuthor?: boolean;
  readonly bodyFormat: PostBodyFormat;
  readonly bodyJson?: JsonObject;
  readonly bodyHtml?: string;
  /**
   * A Post's title also lives as a node inside its own `bodyJson` (the title-in-document feature,
   * `use-post-editor.hooks.ts`), but a Page's does not — its `<input>` is a plain sibling field with
   * nothing else to derive it from. Captured explicitly here so recovery is complete for both.
   */
  readonly title: string;
  readonly slug: string;
  readonly baseVersion: number;
  readonly savedAt: string;
  readonly savedByPrincipalId: UUID;
}

/**
 * One row `appendRevision` writes to `post_revisions` (`platform/db/schema.sqlite.ts`, migration
 * `0064_famous_omega_sentinel.sql`) — the full `PostRecord` snapshot, not the narrower shape
 * `postUpdateReverter`'s inverse payload captures (`reverters.ts` — that inverse drops
 * `seoExtJson`, `memberAccessJson`, `bodyHtml`/`bodyFormat`, `kind`, `deletedAt`, a documented,
 * disclosed gap). This ledger's whole reason to exist is to not repeat that gap, so `stateJson`
 * below is always the WHOLE `PostRecord` a caller just wrote, never a derived subset.
 */
export type PostRevisionOp = "create" | "update" | "delete" | "restore";

/**
 * `appendRevision`'s write contract. `seq` is `PostRecord.version` AFTER the write this revision
 * captures — the caller (`createPost`/`updatePost`/`deletePost` below) already has that value in
 * hand from building the record, so it travels in rather than being independently recomputed by
 * the repo (one fact, one name — see `schema.sqlite.ts`'s `postRevisions.seq` doc).
 */
export interface PostRevisionInput {
  postId: UUID;
  workspaceId: UUID;
  seq: number;
  op: PostRevisionOp;
  stateJson: PostRecord;
  actorId: string;
  delegatedByWorkspaceId?: UUID | null;
  delegatedById?: UUID | null;
  /** Id of the revision a `"restore"`-op row was restored from. `null`/absent for every other op —
   *  nothing writes a `"restore"` row yet (out of scope until a restore feature exists). */
  restoredFrom?: string | null;
  recordedAt: string;
}

/** One row read back from `post_revisions` — {@link PostRevisionInput} plus the two fields the
 *  repo itself computes at write time (`id`, `contentHash`). */
export interface PostRevisionRecord extends PostRevisionInput {
  id: string;
  contentHash: string;
}

/** {@link PostRepoPort.appendRevision}'s result: the new row's id, and the id of the immediately
 *  prior revision for the same `(workspaceId, postId)` — `null` when this is the first revision
 *  ever written for that post (true for every post that predates this feature; additive, no
 *  backfill). */
export interface PostRevisionAppendResult {
  id: string;
  previousId: string | null;
}

export interface PostRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<PostRecord | null>;
  findBySlug(required: { workspaceId: UUID; slug: string }): Promise<PostRecord | null>;
  list(required: { workspaceId: UUID }): Promise<PostRecord[]>;
  /** Bounded live HTML rows, filtered before body reads; timestamp/id keyset pagination. */
  listHtmlByKind?(required: { workspaceId: string; kind: PostKind; limit: number; before?: { updatedAt: string; id: string } }, options?: Record<string, never>): Promise<PostRecord[]>;
  /**
   * Bounded, query-pushed-down listing of published, non-trashed `kind: "post"` rows, newest
   * display date first (`comparePostsByDisplayDate`, `id` tie-break), skipping `offset` rows, capped at `limit` — the post-previews marker's own query
   * (`features/theme/static-render.ts`'s `injectPostPreviewsEmbeds`, wired through
   * `listPublishedPostPreviews` below). Mirrors the query-shape discipline
   * `Jini/packages/cms/src/widgets/resolvers/recent-entries.ts` already established for `entries` (REQ-25: "one bounded
   * query, no unbounded scan sorted/sliced in JS after the fact"), applied here to `posts`.
   *
   * `kind: "post"` is filtered IN THE QUERY, not after: filtering Pages out in JS after an already
   * `limit`-bounded fetch could silently return fewer than `limit` real posts even when more exist.
   * This is also what keeps a Page — including whichever one claims the reserved `/` root slug —
   * out of a post-previews listing, with no separate exclusion check needed at any caller.
   *
   * Deliberately NOT reused by {@link list}/`listPublishedPosts`/`listAdminPosts`/`listAdminPages`
   * above — those stay unbounded and unchanged; this is an ADDITIVE method for the one caller that
   * needs a bounded query, not a widening of the existing unbounded ones.
   *
   * Scheduled rows (`publishAt` after `nowIso`, default now) are excluded in the same query, for
   * the same "never fewer than `limit` real posts" reason.
   */
  listPublishedPreviews(required: { workspaceId: UUID; limit: number; nowIso?: string; offset?: number }): Promise<PostRecord[]>;
  /**
   * Unconditional upsert of one whole row — last write wins, by design.
   *
   * This is the right method for a writer that IS the authority on the row's next state: a create,
   * a change-set revert restoring a captured pre-image (which must land even though its `version`
   * is older than the row's current one), a backfill. It is the WRONG method for a
   * read-modify-write that has to survive a concurrent writer — see {@link saveIfVersion}.
   */
  save(record: PostRecord): Promise<void>;
  /**
   * The conditional half of an optimistic-concurrency compare-and-set: writes `record` over the
   * existing row ONLY while that row is still at `ifVersion`, and reports which happened.
   *
   * Why this exists as a separate method rather than a `version` predicate on {@link save} (2026-09-07,
   * fable bugs audit C01): `updatePost` compares the caller's `expectedVersion` against a row it read
   * two awaits earlier — a repo read and a plugin `beforeSave` hook of arbitrary, third-party latency
   * sit between the compare and the write. An unconditional `save()` therefore lands whatever happened
   * during those awaits, so two operators who both open a post at version 7 both get a 200 and one
   * document is silently erased. The compare has to travel INTO the write for the guard to mean
   * anything. {@link writeAutosave} has always done exactly this for the `autosave_json` column
   * (`eq(posts.version, baseVersion)` + `changes === 0`); this is the same predicate for the row.
   *
   * NEVER an upsert: a row that is not there cannot be at `ifVersion`, so a missing row is
   * `applied: false`, not a silent insert of a record some other writer just deleted.
   *
   * @returns `{ applied: true }` when the row was at `ifVersion` and now holds `record`;
   * `{ applied: false }` when the basis was superseded (or the row is gone) and NOTHING was written
   * — no partial write, no version bump. The caller decides what a rejection means; `updatePost`
   * turns it into `PostVersionConflictError`.
   */
  saveIfVersion(required: { record: PostRecord; ifVersion: number }): Promise<{ applied: boolean }>;
  /**
   * Stamps the trash marker onto one existing row (see {@link PostRecord.deletedAt}).
   *
   * A narrow method rather than "just call `save()` with `deletedAt` set", for the same reason
   * `seoExtJson` has a documented single writer: trashing is the one write that makes a row vanish
   * from every admin and public read, so it gets one auditable code path both adapters implement
   * identically instead of being reachable from any caller holding a whole record. `save()` still
   * persists whatever `deletedAt` a record carries (a reverter clearing the marker writes through
   * `save()`), but `deletePost` is the only thing that SETS one, and it does so through here.
   *
   * `updatedAt`/`version` travel with the marker because a trash is a state change like any other:
   * the version must advance so the command gateway's revert guard (`appliers.ts`'s
   * `currentVersion`) can tell a restored row from the trashed one it replaced.
   *
   * 2026-09-20: `deletePost` no longer calls this. Trashing now goes through {@link DeletePostDeps}'s
   * injected `remove`, which stamps the same three columns AND writes the Trash index row inside one
   * transaction — the two could not be made atomic while they were separate calls. This method
   * remains the port's narrow marker write (both adapters still implement it identically, and its
   * rule-of-two contract tests still run) and is what a test harness or an in-memory composition
   * binds `remove` to; nothing in the serving path reaches it any more.
   */
  softDelete(required: {
    workspaceId: UUID;
    id: UUID;
    deletedAt: string;
    updatedAt: string;
    version: number;
  }): Promise<void>;
  /**
   * Physically REMOVES one row, with the revision ledger and the parked autosave that belong to it.
   * The opposite of {@link softDelete} in every respect: nothing survives, nothing can be restored,
   * and the slug is released.
   *
   * Two callers, both of which need removal rather than a marker and neither of which is an
   * ordinary content delete:
   *
   *  - **the compensation for a failed CREATE.** A create has no pre-image, so the only correct
   *    undo is for the row never to have existed. Trashing it instead (what this path did before
   *    this method existed) leaves a row a user can find and restore, recording a creation that the
   *    system decided had not happened.
   *  - **the Trash purge**, once retention has expired or a user asks for permanent deletion. The
   *    ledger goes with the row deliberately, and for the same reason the durable purge already
   *    cascades it: `post_revisions` holds a full copy of every version, so keeping it would make
   *    "permanently deleted" false.
   *
   * A no-op for an unknown id or another workspace's row — like {@link softDelete}, and unlike a
   * throw, because both callers race a concurrent removal and "already gone" is the outcome they
   * both want.
   *
   * NOT reachable from any ordinary delete path: `deletePost` trashes, and the Trash screen's
   * restore depends on the row still being there. See {@link PostRecord.deletedAt}.
   */
  hardDelete(required: { workspaceId: UUID; id: UUID }): Promise<void>;
  /**
   * Reads the standing-draft autosave snapshot for one row, or `null` when none is parked — the
   * common case, and also what a caller gets after {@link clearAutosave} or once a
   * {@link writeAutosave} call has been rejected as stale (see that method's own doc). Deliberately
   * separate from {@link findById}: `PostRecord` never carries this field, so a recovery-banner
   * check is always an explicit second read a caller opts into, never something that leaks into an
   * ordinary post response by accident.
   */
  readAutosave(required: { workspaceId: UUID; id: UUID }): Promise<PostAutosaveSnapshot | null>;
  /**
   * Overwrites the standing-draft autosave snapshot for one row — ONLY when
   * `snapshot.baseVersion` still matches the row's current {@link PostRecord.version}. A caller
   * whose basis has already been superseded by a real Save/Publish (the only two things that ever
   * bump `version`) is silently ignored (`applied: false`) rather than resurrecting stale content
   * over newer real content. This is also what makes {@link clearAutosave} safe under a race: once
   * a real save bumps `version`, every still-in-flight autosave write captured before that save is
   * a guaranteed no-op, so a `clearAutosave` call right after that save can never be "un-cleared" by
   * one of those late arrivals.
   *
   * Deliberately NOT `save()`: this touches exactly the `autosave_json` column and nothing else —
   * never `bodyJson`/`bodyHtml`/`status`/`updatedAt`/`version` itself, never the
   * `content.entry.beforeSave` hook, never the search index. A published row's live content is
   * unreachable from this method by construction, which is what lets one implementation serve both
   * a draft-status and a published-status row with no branch between them.
   *
   * @returns `{ applied: true }` when the write landed, `{ applied: false }` when it was rejected
   * as stale — the route layer surfaces this so the caller can stop treating its own local edits as
   * the current basis for the row.
   */
  writeAutosave(required: {
    workspaceId: UUID;
    id: UUID;
    snapshot: PostAutosaveSnapshot;
  }): Promise<{ applied: boolean }>;
  /**
   * Clears the standing-draft autosave snapshot for one row (back to "nothing to recover").
   * Unconditional — unlike {@link writeAutosave}, there is no stale basis to guard against when the
   * intent is simply "there is no longer a draft to offer", whether because the operator explicitly
   * discarded it or because a real Save/Publish just superseded it.
   */
  clearAutosave(required: { workspaceId: UUID; id: UUID }): Promise<void>;
  /**
   * Appends one immutable row to this post's revision ledger (`post_revisions`) — never updates or
   * deletes an existing row (ADR-008 §items / ADR-022 §4a append-only discipline, the same
   * discipline `entryRevisions`/`settingRevisions` already follow). See {@link PostRevisionInput}
   * for the full-snapshot contract this exists to guarantee.
   *
   * Never called standalone by `createPost`/`updatePost`/`deletePost` below — each always calls
   * this from inside a {@link transaction} that also contains the post write itself, so a revision
   * is never recorded for a write that didn't really land, and a write never lands silently
   * unaccompanied by its revision.
   */
  appendRevision(input: PostRevisionInput): Promise<PostRevisionAppendResult>;
  /**
   * Reads back one post's revision ledger, oldest first (ascending `seq`) — the only read surface
   * over what {@link appendRevision} has written; `post_revisions` has no other consumer yet.
   */
  listRevisions(required: { workspaceId: UUID; postId: UUID }): Promise<PostRevisionRecord[]>;
  /**
   * Runs `fn` with the post write and its revision-ledger append as one atomic unit — either both
   * land or neither does. Needed because `createPost`/`updatePost`/`deletePost` each make TWO
   * separate repo calls (the record write, then {@link appendRevision}); without this, a failure
   * between them would leave a post write with no matching revision, silently breaking the
   * ledger's one guarantee (every write has a revision). Mirrors the manual `BEGIN IMMEDIATE`/
   * `COMMIT`/`ROLLBACK` `transaction()` already implemented by `SqliteSettingsRepo`,
   * `SqliteMemberConsentRepo`, and `SqliteRedirectRepo` in this codebase — chosen over Drizzle's
   * own `db.transaction()` wrapper because that wrapper requires a synchronous callback, and `fn`
   * here awaits other async repo calls.
   */
  transaction<T>(required: { fn: () => Promise<T> }, optional?: Record<string, never>): Promise<T>;
}

export class PostNotFoundError extends Error {}
export class PostValidationError extends Error {}
export class PostConflictError extends Error {}
/**
 * Optimistic-concurrency rejection (2026-09-06) — `updatePost` was handed an
 * {@link UpdatePostInput.expectedVersion} that no longer matches the row's current
 * {@link PostRecord.version}, meaning another save landed between the caller reading the post and
 * submitting its edit. Before this guard existed that second save simply won, erasing the first
 * operator's document with no error raised anywhere.
 *
 * Extends {@link PostConflictError} deliberately, which is what makes the guard additive at every
 * existing call site: `sendPostUpdateError` (`server/inbound/admin-http/routes/posts/update.ts`),
 * its `pages/update.ts` twin and the `content_post_update` tool handler all already map a
 * `PostConflictError` onto 409 — the right status for this too — so a caller that has not been
 * updated still responds correctly, while one that wants to tell "slug taken" apart from "someone
 * else saved first" narrows on this subclass. It is deliberately NOT a `PostValidationError`,
 * matching `tool-registrations.ts`'s `isPostShapeRejection` rule: resending the identical input
 * cannot fix it, the caller has to reload the row first.
 *
 * Both versions travel as fields, not only inside the message, so a route can build a structured
 * envelope (and a client can offer "reload and reapply") without parsing prose.
 */
export class PostVersionConflictError extends PostConflictError {
  public readonly expectedVersion: number;
  public readonly currentVersion: number;
  constructor({ message, expectedVersion, currentVersion }: { message: string; expectedVersion: number; currentVersion: number }) {
    super(message);
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}

/**
 * SPEC-002 api.spec.md `POST_CREATE`/`PAGE_CREATE` §4 documented `bodyJson` default —
 * an empty TipTap doc, not `{}` (the pre-fix behavior asserted the wrong shape).
 *
 * Exported (SPEC-047/ADR-056) so `repo.sqlite.ts`'s `toRecord` has one shared placeholder to fill
 * `PostRecord.bodyJson` with for an `"html"`-format row's `NULL` `body_json` column, rather than a
 * second, driftable empty-doc literal — see that file's own comment for why a placeholder is
 * correct there (an `"html"` row's `bodyJson` is never read by anything that branches on
 * `bodyFormat` correctly).
 */
export const DEFAULT_BODY_JSON: JsonObject = { type: "doc", content: [] };

/** {@link CreatePostInput.actorId}'s fallback — an omitted actor is attributed to the system
 *  rather than left blank, so `post_revisions.actor_id NOT NULL` never has a "whose write was
 *  this" gap. */
export const SYSTEM_ACTOR_ID = "system";

/**
 * Content-owned homepage — the literal root slug a `kind: "page"` row may claim so `GET /`
 * (`server/inbound/public-http/routes/site/pages.ts`) renders it instead of always falling back to
 * the active theme's own `index.html`. Deliberately NOT folded into {@link SLUG_FORMAT_PATTERN}
 * itself — that would loosen the regex to accept a slash generally, which is not the intended shape.
 * This is a single exact-string exception, checked ahead of the regex by `assertValidExplicitSlug`
 * (which both `resolveExplicitSlug` and `validateUpdatePostInput` call), and it is gated on `kind`: a `kind: "post"` row requesting it is
 * rejected with the SAME "slug must use lowercase letters, numbers, and dashes" message the format
 * check already raises for any other malformed slug — a Post's claim on `/` is simply never a valid
 * slug for a Post, not a distinct error case needing its own message. The fallback-to-theme behavior
 * when no page claims it is what keeps this reversible: see the route handler's own doc.
 */
export const ROOT_SLUG = "/";
