/**
 * @file The CMS's posts and pages as `@jini-ai/search` document sources (collections `post` and
 * `page`, the two `kind`s of the bespoke `posts` table). The generic indexer never trusts an event:
 * it asks {@link SearchDocumentSource.load} for the row's current truth, and this file is that truth.
 *
 * What may be indexed is exactly what the public site shows: `isLiveAt` (published, not trashed,
 * past its go-live time — `contracts/core/scheduled-publish.ts`). Everything else loads as
 * `document: null`, which the indexer turns into a tombstone.
 *
 * Bespoke HTML page edits: `SqlPagesHtmlDocumentStore.write` (and its doc→html conversion) does not
 * go through `post.ts`, so it enqueues the same `entry.updated` itself (its `outbox` dep). Without it
 * such an edit reached the index only through a backfill/reindex `scan`, never through `load` on an
 * event — and the backfill watermark is complete after the first pass, so never again.
 *
 * The host owns the publish rule, the public URL, the text extraction and the member-gate decoding;
 * it passes each in as a required field (see this folder's README, `## Wiring`).
 */
import type { Kysely, Selectable } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { PublicPostKind } from "@jini-ai/core/contracts/site/cms-core";
import type { SearchDocument, SearchVisibility } from "../contract.js";
import type { SearchDocumentSource, SearchSourceEvent, SearchSourceRecord } from "../ports.js";

/** The `posts` columns search reads: a local structural slice of the host's table. */
export interface CmsSearchPostsTable {
  id: string;
  workspace_id: string;
  kind: string;
  slug: string;
  status: string;
  updated_at: string;
  version: number;
  publish_at: string | null;
  deleted_at: string | null;
  member_access_json: string | null;
}

/** The slice of the host database search queries. */
export interface CmsSearchDatabase { posts: CmsSearchPostsTable }

export type CmsSearchPostRow = Selectable<CmsSearchPostsTable>;

/** The host kernel seen through {@link CmsSearchDatabase}; no connection work. */
export type CmsSearchKernel = StorageKernel<Kysely<CmsSearchDatabase>, CmsSearchDatabase>;

/** A whole host `posts` row (`selectAll` returns every column of the host's table). */
export type CmsHostPostRow<DB> = DB extends { posts: infer Table } ? Selectable<Table> : never;

/** The host's publish rule over a row's raw columns (published, not trashed, past its go-live time). */
export type CmsSearchIsLiveAt = (required: {
  record: { readonly status: string; readonly publishAt?: string | null; readonly deletedAt?: string | null };
  nowIso: string;
}) => boolean;

/** A decoded member gate. */
export interface CmsMemberAccess { readonly visibility: string; readonly tierIds?: readonly string[] }

/** The host's decoder of a row's raw `member_access_json` (fails open to `public` only for a never-gated row). */
export type CmsSearchResolveMemberAccess = (required: { raw: string | null }) => CmsMemberAccess;

/** The host rules both the document sources and the access port apply. */
export interface CmsSearchRules {
  readonly isLiveAt: CmsSearchIsLiveAt;
  readonly resolveMemberAccess: CmsSearchResolveMemberAccess;
}

/** The host collaborators the document sources need beyond {@link CmsSearchRules}. */
export interface CmsSearchDocumentRules<DB> extends CmsSearchRules {
  /** The site-relative URL the public site routes a post's slug to. */
  readonly postPublicPath: (required: { slug: string }) => string;
  /** Plain-text title and body of a row (the host's post FTS projection's extraction). */
  readonly toSearchText: (required: { row: CmsHostPostRow<DB> }) => { readonly title: string; readonly bodyText: string };
}

/** The events `post.ts` emits on a public-facing status transition (`classifyStatusTransition`).
 *  Trashing a published row emits `entry.unpublished`, so trash needs no event of its own. */
export const CMS_SEARCH_EVENTS = ["entry.published", "entry.updated", "entry.unpublished"] as const;

export const CMS_SEARCH_COLLECTIONS: readonly PublicPostKind[] = ["post", "page"];

/**
 * Audience tokens for member-gated entries. A viewer's audiences are built from the same tokens by
 * `memberSearchAudiences` (`access.ts`); prefixed so a tier id can never spell `members` or `paid`.
 */
export const MEMBER_AUDIENCE = { members: "members", paid: "paid", tier: ({ tierId }: { tierId: string }, _optional = {}) => `tier:${tierId}` } as const;

/**
 * Who may see an entry, from its raw `member_access_json`. Mirrors `DefaultMemberAccessResolver.decide`:
 * a never-gated row is public; `tiers` with no tier ids and any malformed/unknown visibility become
 * restricted to no audience at all (fail closed, never public).
 * @complexity O(t) in the tier-id count.
 */
export function cmsSearchVisibility(
  required: { memberAccessJson: string | null; resolveMemberAccess: CmsSearchResolveMemberAccess },
  _optional: Record<string, never> = {},
): SearchVisibility {
  const access = required.resolveMemberAccess({ raw: required.memberAccessJson });
  switch (access.visibility) {
    case "public": return { kind: "public" };
    case "members": return { kind: "restricted", audiences: [MEMBER_AUDIENCE.members] };
    case "paid": return { kind: "restricted", audiences: [MEMBER_AUDIENCE.paid] };
    case "tiers": return { kind: "restricted", audiences: (Array.isArray(access.tierIds) ? access.tierIds : []).map((tierId) => MEMBER_AUDIENCE.tier({ tierId })) };
    default: return { kind: "restricted", audiences: [] };
  }
}

/** The ISO instant `isLiveAt` compares `publishAt` against. */
export const toNowIso = ({ nowMs }: { nowMs: number }, _optional = {}): string => new Date(nowMs).toISOString();

/** Whether a stored row is publicly visible right now (`isLiveAt` on its raw columns). @complexity O(1). */
export function isRowLive(
  { row, nowIso, isLiveAt }: { row: Pick<CmsSearchPostRow, "status" | "publish_at" | "deleted_at">; nowIso: string; isLiveAt: CmsSearchIsLiveAt },
  _optional = {},
): boolean {
  return isLiveAt({ record: { status: row.status, publishAt: row.publish_at, deletedAt: row.deleted_at }, nowIso });
}

/**
 * Search revisions. Every write the indexer makes must carry a revision strictly greater than the
 * last one for its key, tombstones included, or the provider ignores it as stale. Hence:
 *
 * - The instant is epoch ms, scaled by 1000 with `version % 1000` added: `version` grows on every
 *   save (reverts too, INV-04), so two saves in the same millisecond still order. 1000 saves of one
 *   row inside one millisecond cannot happen, and the result stays a safe integer until ~2255.
 * - A LIVE row's instant is `max(updatedAt, publishAt)`. A scheduled post was tombstoned while
 *   embargoed (its `entry.published` fires at go-live, owned by the go-live fix), and that
 *   tombstone's instant is at most the event time, which precedes `publishAt`; so going live
 *   outranks it with no new save. A live revision depends on the row alone: a replayed event
 *   re-derives the same number and is harmlessly stale.
 * - A NOT-LIVE row's instant is `max(updatedAt, occurredAt)`, so the tombstone outranks the last
 *   indexed revision even when the event that removed it is newer than the row's own timestamp.
 * - A MISSING row (permanently deleted) uses `occurredAt` with the top tie-break, outranking every
 *   revision of that millisecond.
 */
const scaled = ({ instantMs, tieBreak }: { instantMs: number; tieBreak: number }, _optional = {}) => instantMs * 1000 + tieBreak;
const ms = ({ iso }: { iso: string | null }, _optional = {}) => (iso === null ? 0 : Date.parse(iso));

/** @complexity O(1). */
export function cmsSearchRevision(
  required: { row: Pick<CmsSearchPostRow, "updated_at" | "publish_at" | "version"> | null; live: boolean; occurredAtMs: number },
  _optional: Record<string, never> = {},
): number {
  const { row, live, occurredAtMs } = required;
  if (row === null) return scaled({ instantMs: occurredAtMs, tieBreak: 999 });
  const instant = Math.max(ms({ iso: row.updated_at }), live ? ms({ iso: row.publish_at }) : occurredAtMs);
  return scaled({ instantMs: instant, tieBreak: row.version % 1000 });
}

/** The indexable document for a live row. Title and body are plain text (the post FTS projection's
 *  own extraction, TipTap and bespoke-HTML alike); the URL is the one the public site routes. */
function toDocument<DB>(required: { siteId: string; collection: string; row: CmsSearchPostRow; revision: number; rules: CmsSearchDocumentRules<DB> }): SearchDocument {
  const { siteId, collection, row, revision, rules } = required;
  // `selectAll` read every host column; the slice type only names the ones this file uses.
  const text = rules.toSearchText({ row: row as unknown as CmsHostPostRow<DB> });
  return {
    key: { siteId, workspaceId: row.workspace_id, collection, documentId: row.id },
    revision,
    url: rules.postPublicPath({ slug: row.slug }),
    title: text.title,
    body: text.bodyText,
    visibility: cmsSearchVisibility({ memberAccessJson: row.member_access_json, resolveMemberAccess: rules.resolveMemberAccess }),
  };
}

/** A row's current truth for the index. @complexity O(body size) for the text extraction. */
function toSourceRecord<DB>(required: { siteId: string; workspaceId: string; collection: string; documentId: string; row: CmsSearchPostRow | null; nowMs: number; occurredAtMs: number; rules: CmsSearchDocumentRules<DB> }): SearchSourceRecord {
  const { siteId, workspaceId, collection, documentId, nowMs, occurredAtMs, rules } = required;
  // A row of the other kind is not a document of this collection: treat it as missing here.
  const row = required.row?.kind === collection ? required.row : null;
  const live = row !== null && isRowLive({ row, nowIso: toNowIso({ nowMs }), isLiveAt: rules.isLiveAt });
  const revision = cmsSearchRevision({ row, live, occurredAtMs });
  const key = { siteId, workspaceId, collection, documentId };
  return { key, revision, document: live ? toDocument({ siteId, collection, row, revision, rules }) : null };
}

/** The document id an event names for `collection`: post.ts's payload `{ entryId, contentType }`.
 *  Generic `entries` emit the same event names without `contentType`, so they are never claimed. */
function documentIdFor(event: SearchSourceEvent, collection: string): string | null {
  if (!(CMS_SEARCH_EVENTS as readonly string[]).includes(event.name)) return null;
  const payload = (typeof event.payload === "object" && event.payload !== null ? event.payload : {}) as { entryId?: unknown; contentType?: unknown };
  return payload.contentType === collection && typeof payload.entryId === "string" ? payload.entryId : null;
}

/** One collection's source. @complexity load: one primary-key read; scan: one keyset page. */
function createSource<DB>(required: { kernel: CmsSearchKernel; now: () => number; collection: string; rules: CmsSearchDocumentRules<DB> }): SearchDocumentSource {
  const { kernel, now, collection, rules } = required;
  return {
    collection,
    events: CMS_SEARCH_EVENTS,
    documentIdOf: ({ event }) => documentIdFor(event, collection),
    async load({ siteId, workspaceId, documentId, occurredAtMs }) {
      const row = await kernel.run(db => db.selectFrom("posts").selectAll()
        .where("workspace_id", "=", workspaceId).where("id", "=", documentId).executeTakeFirst());
      return toSourceRecord({ siteId, workspaceId, collection, documentId, row: row ?? null, nowMs: now(), occurredAtMs, rules });
    },
    async scan({ siteId, workspaceId, limit }, optional = {}) {
      const nowMs = now();
      const nowIso = toNowIso({ nowMs });
      const rows = await kernel.run(db => {
        let query = db.selectFrom("posts").selectAll()
          .where("workspace_id", "=", workspaceId).where("kind", "=", collection)
          .where("status", "=", "published").where("deleted_at", "is", null)
          // Same rule as `isLiveAt`: ISO UTC strings compare in time order.
          .where(eb => eb.or([eb("publish_at", "is", null), eb("publish_at", "<=", nowIso)]));
        if (optional.cursor !== undefined) query = query.where("id", ">", optional.cursor);
        // Keyset on the primary key: stable under concurrent writes, never repeats or skips a row.
        return query.orderBy("id", "asc").limit(limit).execute();
      });
      const records = rows.map(row => toSourceRecord({ siteId, workspaceId, collection, documentId: row.id, row, nowMs, occurredAtMs: nowMs, rules }));
      const last = rows.at(-1);
      // A short (or empty) page is the last one; a full page may have more after its last id.
      return last === undefined || rows.length < limit ? { records } : { records, nextCursor: last.id };
    },
  };
}

/**
 * The `post` and `page` sources over one site's content database (one workspace per content.db).
 * Generic over the host's schema `DB`: the host kernel is borrowed through {@link CmsSearchDatabase}.
 * @example registerMany(SEARCH_DOCUMENT_SOURCES, createCmsSearchDocumentSources({ kernel, now, isLiveAt, resolveMemberAccess, postPublicPath, toSearchText }))
 * @complexity O(1) to build.
 */
export function createCmsSearchDocumentSources<DB>(
  required: { readonly kernel: StorageKernel<Kysely<DB>, DB>; readonly now: () => number } & CmsSearchDocumentRules<DB>,
  optional: { readonly collections?: readonly string[] } = {},
): SearchDocumentSource[] {
  const { kernel, now, ...rules } = required;
  const slice = kernel as unknown as CmsSearchKernel;
  return (optional.collections ?? CMS_SEARCH_COLLECTIONS).map(collection => createSource({ kernel: slice, now, collection, rules }));
}
