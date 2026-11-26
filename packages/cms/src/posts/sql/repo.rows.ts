import type { ColumnType, Generated, SqlBool, Insertable, Selectable } from "kysely";

import { type JsonObject, resolveCreatorKind } from "@jini-ai/core/primitives";
import { toBool } from "@jini-ai/core/contracts/storage";
import { DEFAULT_BODY_JSON, type PostBodyFormat, type PostRecord, type PostRevisionInput, type PostRevisionOp, type PostRevisionRecord } from "@jini-ai/cms/posts/post";
import { presentScheduleFields } from "@jini-ai/cms/posts/post-write-fields";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";
import type { PostStatus } from "@jini-ai/cms/core";

/**
 * @file Row mapping for `posts` / `post_revisions`, shared by every dialect: the columns are the
 * generated `ContentDatabase` types (snake_case, JSON as text, booleans as `SqlBool`), and these
 * functions are the ONE place a record becomes a row and back. Neutral on purpose — no repo, no
 * driver — so nothing imports a dialect adapter to reach it.
 *
 * SPEC-005 (T021): `ext` is stored the same way `bodyJson` already is — JSON text in, parsed object
 * out. Its column is `NOT NULL DEFAULT '{}'`, so every pre-feature row reads back as "no plugin has
 * written anything" with zero backfill; an empty bag is normalized to an absent `ext` on the record
 * so an entry with no contributing plugin carries no `ext` at all (AC-14).
 */

interface PostRevisionsTable {
  id: string;
  post_id: string;
  workspace_id: string;
  seq: number;
  op: string;
  state_json: string;
  content_hash: string;
  actor_id: string;
  delegated_by_workspace_id: string | null;
  delegated_by_id: string | null;
  restored_from: string | null;
  recorded_at: string;
  actor_kind: string | null;
}

interface PostsTable {
  id: string;
  workspace_id: string;
  title: string;
  slug: string;
  body_json: string | null;
  status: string;
  kind: Generated<string>;
  body_format: Generated<string>;
  body_html: string | null;
  updated_at: string;
  version: number;
  seo_ext_json: string | null;
  ext: Generated<string>;
  deleted_at: string | null;
  template_choice: string | null;
  overrides_theme_page: ColumnType<SqlBool | null, boolean | null | undefined, boolean | null>;
  member_access_json: string | null;
  autosave_json: string | null;
  created_by_principal_id: string | null;
  created_at: string | null;
  publish_at: string | null;
  created_by_kind: Generated<string>;
  featured_media_id: string | null;
  author: string | null;
  show_author: ColumnType<SqlBool, boolean | undefined, boolean>;
}

export type PostTables = { posts: PostsTable; post_revisions: PostRevisionsTable };

export type PostRow = Selectable<PostTables["posts"]>;
export type PostRevisionRow = Selectable<PostTables["post_revisions"]>;

/** `{}` (the column default, and every pre-SPEC-005 row) reads back as no `ext` at all — AC-14. */
function parseExt({ rawExt }: { rawExt: string }, _optional: Record<string, never> = {}): JsonObject | undefined {
  const parsed = JSON.parse(rawExt) as JsonObject;
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function readPostAttribution({ row }: { row: PostRow }, _options: Record<string, never> = {}) {
  return {
    createdByPrincipalId: row.created_by_principal_id ?? null,
    createdByKind: resolveCreatorKind({ value: row.created_by_kind }),
    createdAt: row.created_at ?? null,
    author: row.author ?? null,
    showAuthor: toBool({ value: row.show_author }) ?? false,
  };
}

/** SQL nullable metadata and boolean representations normalized at the row boundary. */
function readPostMetadata({ row }: { row: PostRow }, _options: Record<string, never> = {}) {
  return {
    seoExtJson: row.seo_ext_json ?? null,
    deletedAt: row.deleted_at ?? null,
    templateChoice: row.template_choice ?? null,
    overridesThemePage: toBool({ value: row.overrides_theme_page }),
    memberAccessJson: row.member_access_json ?? null,
    ...readPostAttribution({ row }),
  };
}

/**
 * SPEC-047/ADR-056 Decision 3 — `body_json` is `NULL` for an `"html"`-format row (Pages
 * vibecoding, written by `PagesHtmlDocumentStore`, never by this repo's own `save()`).
 * `PostRecord.bodyJson` stays a required `JsonObject` (unwidened) so `DEFAULT_BODY_JSON` fills the
 * gap here rather than widening the type to `JsonObject | null` for every consumer. This placeholder
 * is inert only for a consumer that branches on `bodyFormat` before trusting `bodyJson` — widget
 * embeds and `entry_refs` extraction each have a separate `"html"`-format entry point that reads
 * `bodyHtml` instead (see `Jini/packages/cms/src/widgets/resolver-service.ts`'s and `core/entry-refs/extractor.ts`'s own
 * "HTML Page" sections), and search indexing in `save()` never runs against an `"html"` row at all
 * (that path is never called for one). SEO excerpting (`deriveExcerpt` in `Jini/packages/cms/src/seo/seo.ts`)
 * used to skip that branch and read this placeholder unconditionally — every `"html"`-format entry
 * silently got an empty derived description — until it was fixed to read `bodyHtml` the same way.
 * `toHeadlessPost` (SPEC-047 REQ-3's discriminated union) is the reference branch; any new consumer
 * of `bodyJson` must check `bodyFormat` the same way before trusting it.
 */
export function toRecord({ row }: { row: PostRow }, _optional: Record<string, never> = {}): PostRecord {
  const ext = parseExt({ rawExt: row.ext });
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    slug: row.slug,
    bodyJson: row.body_json === null ? DEFAULT_BODY_JSON : (JSON.parse(row.body_json) as JsonObject),
    bodyFormat: row.body_format as PostBodyFormat,
    bodyHtml: row.body_html ?? null,
    status: row.status as PostStatus,
    kind: row.kind as PostKind,
    updatedAt: row.updated_at,
    version: row.version,
    ...readPostMetadata({ row }),
    // Present only when set — see `presentScheduleFields` in `post.ts` for why absent, not `null`.
    ...presentScheduleFields({ publishAt: row.publish_at, featuredMediaId: row.featured_media_id }),
    ...(ext !== undefined ? { ext } : {}),
  };
}

function writePostAccessAndAttribution({ record }: { record: PostRecord }, _options: Record<string, never> = {}) {
  return {
    // Tri-state (2026-08-15) — `record.overridesThemePage` is `undefined` on every row a caller
    // never set an opinion on (every `createPost` call today: `CreatePostInput` has no field for
    // this, deliberately — see its own doc). Coalescing to `null`, NOT `false`, is the entire fix
    // this migration exists to enable: `false` would silently re-encode "never decided" as
    // "explicitly kept the theme page", exactly the ambiguity `pages.ts`'s resolver can no longer
    // tell apart from a real author choice. `null` stays honestly "undecided" all the way to the
    // resolver, which is the one place the current default policy is allowed to live.
    overrides_theme_page: record.overridesThemePage ?? null,
    member_access_json: record.memberAccessJson ?? null,
    // Authorship attribution (2026-09-18) — written here so a fresh INSERT (createPost's `save()`
    // upsert) carries them, but see `updatableColumns()` directly below: this same value is
    // deliberately EXCLUDED from the columns an existing-row write may touch, which is what actually
    // makes them write-once. See `posts.createdByPrincipalId`'s schema doc for the full contract.
    created_by_principal_id: record.createdByPrincipalId ?? null,
    // Same write-once rule: an unset kind is "person" (the column default), never an agent.
    created_by_kind: record.createdByKind ?? "person",
    created_at: record.createdAt ?? null,
  };
}

/** Persist nullable metadata, including restore markers and insert-only attribution. */
function writePostMetadata({ record }: { record: PostRecord }, _options: Record<string, never> = {}) {
  return {
    seo_ext_json: record.seoExtJson ?? null,
    // Persisted from the record like any other field, so `postDeleteReverter`'s restore — which
    // writes a record with `deletedAt: null` through `save()` — actually clears the marker.
    // SETTING a marker still goes through `softDelete` alone (see `PostRepoPort`'s own doc).
    deleted_at: record.deletedAt ?? null,
    template_choice: record.templateChoice ?? null,
    ...writePostAccessAndAttribution({ record }),
  };
}

function writePostPublication({ record }: { record: PostRecord }, _options: Record<string, never> = {}) {
  return {
    publish_at: record.publishAt ?? null,
    featured_media_id: record.featuredMediaId ?? null,
    author: record.author ?? null,
    show_author: record.showAuthor ?? false,
  };
}

/**
 * `toRecord`'s inverse: the exact column values one whole-row write persists.
 *
 * Extracted from `save()` (2026-09-07) because `saveIfVersion` writes the identical columns from the
 * identical record and a second hand-maintained copy of these rules is how one write path silently
 * stops honouring the body-format CHECK constraint or the `overridesThemePage` tri-state while its
 * sibling keeps doing it right.
 *
 * @complexity O(size of the record's JSON fields) — two `JSON.stringify` calls.
 */
export function toRow({ record }: { record: PostRecord }, _optional: Record<string, never> = {}) {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    title: record.title,
    slug: record.slug,
    // The exact inverse of `toRecord`'s `body_json === null ? DEFAULT_BODY_JSON : parse(...)`
    // substitution, and it has to be, or the pair is not a round trip. `toRecord` hands an
    // `"html"` row a placeholder `bodyJson` (the domain type keeps `bodyJson` a required
    // `JsonObject` — see `toRecord` for why it stays unwidened), so writing that placeholder back
    // down would populate both body columns at once and the table's CHECK constraint would reject
    // the write outright.
    body_json: record.bodyFormat === "html" ? null : JSON.stringify(record.bodyJson),
    body_format: record.bodyFormat,
    // Same guard from the other side: a `"doc"` record must not carry stray html, whatever a
    // caller assembled. The CHECK constraint enforces exactly one populated body column per
    // format; these two lines are what keep every write on the legal side of it.
    body_html: record.bodyFormat === "html" ? record.bodyHtml : null,
    status: record.status,
    kind: record.kind,
    updated_at: record.updatedAt,
    version: record.version,
    ...writePostMetadata({ record }),
    ...writePostPublication({ record }),
    ext: JSON.stringify(record.ext ?? {}),
  } satisfies Insertable<PostTables["posts"]>;
}

/**
 * The columns a write to an EXISTING row sets — `toRow` minus `id`, and minus every column this
 * repo is not the writer of.
 *
 * `autosave_json` is the one that matters and the reason this is a named list rather than a spread:
 * a standing-draft snapshot is written only by `writeAutosave`/`clearAutosave`, so a whole-row save
 * (which carries no such field on `PostRecord` at all) must leave that column exactly where it is.
 * `id` is excluded because it is the match key on both write paths.
 *
 * `created_by_principal_id`/`created_at` (2026-09-18) are excluded for the identical reason, by the
 * identical mechanism, for a different feature: they are write-once authorship attribution, set
 * only by `createPost`'s insert. `save()`/`saveIfVersion()` both route an UPDATE through this same
 * list, so omitting the pair here — not a runtime `if` in either method — is what makes
 * `updatePost` structurally incapable of overwriting them, regardless of what value the
 * `PostRecord` it was handed happens to carry for either field.
 *
 * @complexity O(1).
 */
export function updatableColumns({ row }: { row: ReturnType<typeof toRow> }, _optional: Record<string, never> = {}) {
  return {
    workspace_id: row.workspace_id,
    title: row.title,
    slug: row.slug,
    body_json: row.body_json,
    body_format: row.body_format,
    body_html: row.body_html,
    status: row.status,
    kind: row.kind,
    updated_at: row.updated_at,
    version: row.version,
    seo_ext_json: row.seo_ext_json,
    deleted_at: row.deleted_at,
    template_choice: row.template_choice,
    overrides_theme_page: row.overrides_theme_page,
    member_access_json: row.member_access_json,
    publish_at: row.publish_at,
    featured_media_id: row.featured_media_id,
    author: row.author,
    show_author: row.show_author,
    ext: row.ext,
  };
}

/** One `post_revisions` row as a {@link PostRevisionRecord}. */
export function toRevisionRecord({ row }: { row: PostRevisionRow }, _optional: Record<string, never> = {}): PostRevisionRecord {
  return {
    id: row.id,
    postId: row.post_id,
    workspaceId: row.workspace_id,
    seq: row.seq,
    op: row.op as PostRevisionOp,
    stateJson: JSON.parse(row.state_json) as PostRecord,
    contentHash: row.content_hash,
    actorId: row.actor_id,
    delegatedByWorkspaceId: row.delegated_by_workspace_id,
    delegatedById: row.delegated_by_id,
    restoredFrom: row.restored_from,
    recordedAt: row.recorded_at,
  };
}

/** The revision row `appendRevision` writes: `content_hash` is over the exact text written,
 *  computed here so no caller can hand in a hash that drifts from the bytes. */
export function toRevisionRow({ input, id, hashJsonText }: { input: PostRevisionInput; id: string; hashJsonText: (text: string) => string }, _optional: Record<string, never> = {}): Insertable<PostTables["post_revisions"]> {
  const stateJsonText = JSON.stringify(input.stateJson);
  return {
    id,
    post_id: input.postId,
    workspace_id: input.workspaceId,
    seq: input.seq,
    op: input.op,
    state_json: stateJsonText,
    content_hash: hashJsonText(stateJsonText),
    actor_id: input.actorId,
    delegated_by_workspace_id: input.delegatedByWorkspaceId ?? null,
    delegated_by_id: input.delegatedById ?? null,
    restored_from: input.restoredFrom ?? null,
    recorded_at: input.recordedAt,
    // Migration 0050: only a typed kind is written; without one the column stays NULL (unknown).
    ...(input.actorKind ? { actor_kind: input.actorKind } : {}),
  };
}
