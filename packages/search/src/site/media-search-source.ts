import { encodeSearchKey, type SearchAccessPort, type SearchDocumentSource, type SearchSourceEvent, type SearchSourceRecord } from "@jini-ai/search";
import { cmsSearchRevision } from "@jini-ai/search/site/cms-document-source";
import type { DomainEvent } from "@jini-ai/core/contracts/events";
import type { MediaRecord } from "@jini-ai/core/contracts/site/cms-media";

/**
 * @file Public image descriptions as a site-search document source (P10-M5.T2).
 *
 * The source indexes the stored, human-authored `description` of a current, eligible PUBLIC image
 * and nothing else from the record: never the generation prompt in `source.provenance`, never
 * Library documents, private ingress, trashed rows, or non-image media. The SAME publication rule
 * ({@link isPublicSearchImage} by default, injected as `publicAccess`) decides both what `load`
 * emits and what the query-time access port lets through, so a lagging index can never show what
 * `load` would refuse.
 *
 * Change events: {@link createMediaSearchChangeSink} is the media repo's change sink, so every
 * committed write (save, CAS save, file replace or restore, insert, trash marker, purge) enqueues one
 * {@link MEDIA_SEARCH_CHANGED_EVENT} through the outbox in the SAME transaction as the write. The event only names the asset; delivery re-reads current
 * state, so redelivery and an older event arriving after a newer change converge.
 */

/** The search collection of public images (grammar `^[a-z][a-z0-9_]{0,63}$`). */
export const MEDIA_SEARCH_COLLECTION = "media_image";

/** The outbox event a committed media write enqueues; payload-free beyond the asset id. */
export const MEDIA_SEARCH_CHANGED_EVENT = "media.search_changed";

/** Host ports for {@link createMediaSearchSource} and {@link createMediaSearchAccessPort}. */
export interface MediaSearchPorts {
  /** The current row, or null when it no longer exists (purged). */
  loadMedia(required: { readonly workspaceId: string; readonly id: string }): Promise<MediaRecord | null>;
  /** One stable-order page of rows for backfill; `nextCursor` absent means done. */
  scanMedia(required: { readonly workspaceId: string; readonly limit: number }, optional?: { readonly cursor?: string }): Promise<{ readonly records: readonly MediaRecord[]; readonly nextCursor?: string }>;
  /** The publication rule: whether this row is a public search document right now. */
  publicAccess(required: { readonly record: MediaRecord }): boolean;
  /** The site-relative public URL of the image (its sanitized public rendition). */
  publicPath(required: { readonly record: MediaRecord }): string;
  now(): number;
}

/**
 * The default publication rule: an active, non-Library, non-private raster or vector image with a
 * known image MIME. Unknown MIME fails closed.
 * @complexity O(1).
 */
export function isPublicSearchImage(required: { readonly record: MediaRecord }, _optional: Record<string, never> = {}): boolean {
  const { record } = required;
  // A file an admin can read is not necessarily a public search document.
  if (record.kind === "document" || record.status !== "active" || record.source.private === true) return false;
  return typeof record.source.contentType === "string" && record.source.contentType.startsWith("image/");
}

/** One record for a row (or its absence), with the CMS revision scheme so tombstones always outrank. */
function toRecord(
  required: { siteId: string; workspaceId: string; documentId: string; record: MediaRecord | null; occurredAtMs: number; ports: MediaSearchPorts },
  _optional: Record<string, never> = {},
): SearchSourceRecord {
  const { siteId, workspaceId, documentId, record, occurredAtMs, ports } = required;
  const key = { siteId, workspaceId, collection: MEDIA_SEARCH_COLLECTION, documentId };
  const live = record !== null && record.workspaceId === workspaceId && ports.publicAccess({ record });
  const row = record === null ? null : { updated_at: record.updatedAt, publish_at: null, version: record.version };
  const revision = cmsSearchRevision({ row, live, occurredAtMs });
  if (!live) return { key, revision, document: null };
  // Index the stored description only; the title is the editorial display name, never a prompt.
  return {
    key, revision,
    document: { key, revision, url: ports.publicPath({ record }), title: record.title, body: record.description ?? "", visibility: { kind: "public" } },
  };
}

/**
 * The media search source: emits only current, eligible public images.
 * @complexity load O(1) port calls; scan O(page).
 */
export function createMediaSearchSource(required: MediaSearchPorts, _optional: Record<string, never> = {}): SearchDocumentSource {
  const ports = required;
  return {
    collection: MEDIA_SEARCH_COLLECTION,
    events: [MEDIA_SEARCH_CHANGED_EVENT],
    documentIdOf: ({ event }: { readonly event: SearchSourceEvent }) =>
      (event.name === MEDIA_SEARCH_CHANGED_EVENT && typeof event.aggregateId === "string" && event.aggregateId !== "" ? event.aggregateId : null),
    async load({ siteId, workspaceId, documentId, occurredAtMs }) {
      const record = await ports.loadMedia({ workspaceId, id: documentId });
      return toRecord({ siteId, workspaceId, documentId, record, occurredAtMs, ports });
    },
    async scan({ siteId, workspaceId, limit }, optional = {}) {
      const page = await ports.scanMedia({ workspaceId, limit }, optional.cursor === undefined ? {} : { cursor: optional.cursor });
      const occurredAtMs = ports.now();
      const records = page.records
        .filter(record => record.workspaceId === workspaceId && ports.publicAccess({ record }))
        .map(record => toRecord({ siteId, workspaceId, documentId: record.id, record, occurredAtMs, ports }));
      return page.nextCursor === undefined ? { records } : { records, nextCursor: page.nextCursor };
    },
  };
}

/**
 * Query-time access for media keys: re-reads each named row and applies the same publication rule
 * as `load`. Keys of other sites, workspaces or collections are dropped (fail closed).
 * @complexity O(k) row reads.
 */
export function createMediaSearchAccessPort(required: Pick<MediaSearchPorts, "loadMedia" | "publicAccess">, _optional: Record<string, never> = {}): SearchAccessPort {
  const { loadMedia, publicAccess } = required;
  return {
    async visibleKeys({ siteId, keys }) {
      const visible = new Set<string>();
      for (const key of keys) {
        if (key.siteId !== siteId || key.collection !== MEDIA_SEARCH_COLLECTION) continue;
        const record = await loadMedia({ workspaceId: key.workspaceId, id: key.documentId });
        if (record !== null && record.workspaceId === key.workspaceId && publicAccess({ record })) visible.add(encodeSearchKey({ key }));
      }
      return visible;
    },
  };
}

/**
 * Several access ports as one: a key is visible when the port owning its collection says so. Each
 * port already drops collections it does not own, so the union never widens any one port's rule.
 * @complexity O(ports) calls.
 */
export function unionSearchAccessPorts(required: { readonly ports: readonly SearchAccessPort[] }, _optional: Record<string, never> = {}): SearchAccessPort {
  return {
    async visibleKeys(input) {
      const sets = await Promise.all(required.ports.map(port => port.visibleKeys(input)));
      return new Set(sets.flatMap(set => [...set]));
    },
  };
}

/** Ids are deterministic per committed write, so a retried enqueue of the same write is one event. */
function changeEvent(required: { workspaceId: string; mediaId: string; marker: string; occurredAt: string }, _optional: Record<string, never> = {}): DomainEvent {
  const { workspaceId, mediaId, marker, occurredAt } = required;
  return {
    id: `${MEDIA_SEARCH_CHANGED_EVENT}:${workspaceId}:${mediaId}:${marker}`, name: MEDIA_SEARCH_CHANGED_EVENT,
    occurredAt, workspaceId, aggregateId: mediaId, payload: { mediaId },
  } as DomainEvent;
}

/** The outbox slice the sink writes through; its `enqueue` must join the caller's transaction. */
export interface MediaSearchOutbox {
  enqueue(event: DomainEvent): Promise<void>;
}

/**
 * The media repo's change sink for site search: each committed description change, restore, trash
 * or purge of ordinary media enqueues one {@link MEDIA_SEARCH_CHANGED_EVENT}. The repo calls it
 * INSIDE the write's transaction and `outbox` runs on the same kernel, so the event row commits or
 * rolls back with the media write: a failed write leaves no event, and a failed enqueue undoes the
 * write. Library documents never emit. The event only names the asset; delivery re-reads current state.
 * @complexity O(1) per change.
 */
export function createMediaSearchChangeSink(
  required: { readonly outbox: MediaSearchOutbox; readonly nowIso: () => string },
  _optional: Record<string, never> = {},
): { changed(required: { workspaceId: string; mediaId: string; kind: string; marker: string }): Promise<void> } {
  const { outbox, nowIso } = required;
  return {
    async changed({ workspaceId, mediaId, kind, marker }) {
      // A file an admin can read is not necessarily a public search document.
      if (kind === "document") return;
      await outbox.enqueue(changeEvent({ workspaceId, mediaId, marker, occurredAt: nowIso() }));
    },
  };
}
