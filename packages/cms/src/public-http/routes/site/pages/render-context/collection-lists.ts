// Keep request rendering separate from theme installation, imports, and agent tools.
// C5 (collections plan, 2026-09-23): the route layer (`pages.ts`'s
  // `resolveCollectionListsForRender`) needs the same per-marker identity key and inner-content
  // splitter `injectCollectionEmbeds` uses, so both sides agree on how a `collection` marker is
  // addressed and how its authored `<template>` is found.
import { collectionMarkerKey, splitCollectionMarkerInner } from "../../../../../listing/index.js";
import { renderEntryList, type EntryListItem, type EntryListFieldValue } from "../../../../../listing/index.js";
import { markersOfType, COLLECTION_MARKER_TYPE, type EmbedMarker } from "../../../../../widgets/markers/index.js";
import { listingBatchPath, listingKeyOfAttributes, readListingBatch, renderListingMore, type ListingBatchRequest } from "../../../../../listing/index.js";
import type { ContentTypeFieldDef, ContentTypeRecord } from "@jini-ai/core/contracts/content-types";
import type { EntryRecord } from "../../../../../entries/index.js";
import { parseCollectionListConfig, humanizeFieldName, entryPublicHref, type EntryDisplayListPort, type ParseCollectionListConfigResult } from "../../../../../entries/site/public-list.js";
import { formatDateLabel, resolveSiteTimeZoneSafely, type SiteTimeZonePort } from "../../../../../widgets/date-label.js";

/**
 * The narrow render slice collection-marker resolution reads. The host binds its own repos;
 * `entryListAttribute` is the host's entry-list wrapper attribute (its theme styles are scoped to
 * it, so the name is host-owned and injected rather than spelled here).
 */
export interface CollectionListsRenderDeps {
  readonly workspaceId: string;
  readonly contentTypeRepo: { findByKey(params: { workspaceId: string; key: string }): Promise<ContentTypeRecord | null> };
  readonly entryRepo: EntryDisplayListPort;
  readonly listingBatch?: ListingBatchRequest;
  readonly siteTimeZone?: SiteTimeZonePort;
  readonly entryListAttribute: string;
}

/**
 * The most distinct `{"type":"collection"}` marker configs one page's `resolveCollectionListsForRender`
 * call will resolve. A theme/page author authors a small, fixed number of collection markers per page
 * (this is layout, not user-collection-sized data); a page that somehow carries more than this is
 * almost certainly an authoring mistake (e.g. a template loop that duplicated a marker with a
 * per-iteration filter), not a legitimate design, so the excess configs are left on their authored
 * fallback rather than firing an unbounded number of content-type/entry queries per request.
 */
const MAX_DISTINCT_COLLECTION_MARKERS_PER_PAGE = 10;

/**
 * Reads one custom field's value out of an entry's namespaced `fields.ext.site.<name>` bag, the
 * route-layer twin of `repo.sqlite.ts`'s `json_extract($.ext.site.<name>)` and
 * Jini's `TrashAwareInMemoryEntryRepo`'s own private `siteFieldValue` — duplicated rather than imported
 * because both of those live inside `features/entries/`'s repo-adapter internals with no barrel
 * re-export, and this route-level display mapping must not deep-import across that feature boundary
 * just to read a value out of a record it already has in hand.
 *
 * @complexity O(1).
 */
function collectionEntryFieldValue({ row, field }: { row: EntryRecord; field: string }, _optional = {}): unknown {
  const fields = row.fieldsJson as { ext?: { site?: Record<string, unknown> } } | null | undefined;
  return fields?.ext?.site?.[field];
}

/**
 * Reduces one fetched {@link EntryRecord} plus the content type's resolved display fields
 * (`parseCollectionListConfig`'s `display.fields`, already validated and ordered) into the
 * {@link EntryListItem} `entry-list-render.ts`'s pure renderer needs. `href` is always `null` (D1:
 * entry pages are off) via {@link entryPublicHref}'s seam; `dateIso`/`dateLabel` prefer
 * `publishedAt`, falling back to `updatedAt` for the rare row with no `publishedAt` yet (draft rows
 * never reach here — `listPublishedForDisplay` only returns published entries — but a defensive
 * fallback costs nothing and matches `formatPostPreviewDate`'s own "degrade, don't throw" posture).
 *
 * @complexity O(f) over `fields`' length — one `collectionEntryFieldValue` lookup per displayed
 * field, f being the content type's own declared/authored field count, never user-collection-sized.
 */
function toCollectionEntryListItem({ row, fields, timeZone }: { row: EntryRecord; fields: readonly ContentTypeFieldDef[]; timeZone: string }, _optional = {}): EntryListItem {
  const dateIso = row.publishedAt ?? row.updatedAt;
  return {
    title: row.title,
    href: entryPublicHref({ _typeKey: row.type, _slug: row.slug }),
    dateIso,
    // `formatPostPreviewDate` (the host's post-preview label) is exactly this call.
    dateLabel: formatDateLabel({ iso: dateIso }, { timeZone }),
    fields: fields.map(
      (field): EntryListFieldValue => ({
        name: field.name,
        label: humanizeFieldName({ name: field.name }),
        kind: field.kind,
        value: collectionEntryFieldValue({ row, field: field.name }),
      })
    ),
  };
}

/**
 * The content-type key a `{"type":"collection"}` marker names. `id` is the documented form (the
 * collections plan, the admin "Copy embed code" snippet and the docs page all write
 * `{"type":"collection","id":"<typeKey>"}`, the same `id` every other marker type uses for its
 * target); `typeKey` is accepted as an alias because early markers and tests were written with it.
 * `undefined` when neither is a non-empty string. @complexity O(1).
 */
function collectionMarkerTypeKey(config: Readonly<Record<string, unknown>>): string | undefined {
  for (const candidate of [config.id, config.typeKey]) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return undefined;
}

/** A collection marker config that parsed: its bounded query plus its display options. */
type ParsedCollectionListConfig = Extract<ParseCollectionListConfigResult, { ok: true }>;

/** A collection marker's validated content-type key and parsed list config, or `undefined` (with
 *  its `[collection]` warning) for every config-level miss. @complexity One `findByKey` read. */
async function resolveCollectionMarkerConfig(
  deps: Pick<CollectionListsRenderDeps, "workspaceId" | "contentTypeRepo">,
  marker: EmbedMarker
): Promise<{ typeKey: string; parsed: ParsedCollectionListConfig } | undefined> {
  const typeKey = collectionMarkerTypeKey(marker.config);
  if (typeKey === undefined) {
    console.warn('[collection] marker names no content type (a string "id"); leaving its authored fallback content');
    return undefined;
  }

  const contentType = await deps.contentTypeRepo.findByKey({ workspaceId: deps.workspaceId, key: typeKey });
  if (contentType === null) {
    console.warn(`[collection] no content type registered for typeKey "${typeKey}"; leaving its authored fallback content`);
    return undefined;
  }

  const parsed = parseCollectionListConfig({ config: marker.config, contentType });
  if (!parsed.ok) {
    console.warn(`[collection] rejected marker config for typeKey "${typeKey}": ${parsed.reason}; leaving its authored fallback content`);
    return undefined;
  }
  return { typeKey, parsed };
}

/** The published entries one collection marker lists: its whole bounded query for a plain marker,
 *  or — for a see-more marker — its batch (from `after` when this request asks for its key) plus
 *  whether a next batch exists. @complexity One bounded `listPublishedForDisplay` read. */
async function readCollectionBatch({ deps, query, listingKey }: { deps: Pick<CollectionListsRenderDeps, "workspaceId" | "entryRepo" | "listingBatch">; query: ParsedCollectionListConfig["query"]; listingKey: number | undefined }, _optional = {}) {
  // A see-more marker reads its batch (from `after` when this request asks for its key) plus one row
  // to learn whether a next batch exists; entries carry no member access, so every row is visible.
  if (listingKey === undefined) {
    return { items: await deps.entryRepo.listPublishedForDisplay({ workspaceId: deps.workspaceId, query }), hasMore: false, next: 0 };
  }
  return readListingBatch({
    source: ({ offset, limit }) => deps.entryRepo.listPublishedForDisplay({ workspaceId: deps.workspaceId, query: { ...query, offset, limit } }),
    after: deps.listingBatch?.key === listingKey ? deps.listingBatch.after : 0,
    size: query.limit,
  });
}

/**
 * Resolves one already-deduplicated `{"type":"collection"}` marker to its rendered entry-list markup,
 * or `undefined` for every kind of miss: no content-type key, an unknown/system/tombstoned content
 * type (`parseCollectionListConfig`'s own rejections, which include D8's `SYSTEM_CONTENT_TYPES`), an
 * invalid config (unknown `where`/`sort`/`fields` name, non-scalar `where` value), or zero matching
 * published entries (`renderEntryList`'s own "no data ⇒ nothing to substitute" contract). Every
 * rejection is a `console.warn`, not a thrown error — one bad marker must never fail the whole page
 * render, matching this file's existing `[theme]` warning convention.
 *
 * @complexity One `contentTypeRepo.findByKey` plus, only when that succeeds and the config parses,
 * one bounded `entryRepo.listPublishedForDisplay` query (capped at the marker's own clamped `limit`,
 * `parseCollectionListConfig`'s own resource bound) — never an unbounded scan.
 */
async function resolveOneCollectionMarker({ deps, marker, pagePath }: { deps: Pick<CollectionListsRenderDeps, "workspaceId" | "contentTypeRepo" | "entryRepo" | "listingBatch" | "siteTimeZone" | "entryListAttribute">; marker: EmbedMarker; pagePath: string }, _optional = {}): Promise<string | undefined> {
  const config = await resolveCollectionMarkerConfig(deps, marker);
  if (config === undefined) return undefined;
  const { typeKey, parsed } = config;

  const listingKey = listingKeyOfAttributes({ attrs: marker.attrs });
  const batch = await readCollectionBatch({ deps, query: parsed.query, listingKey });
  const timeZone = await resolveSiteTimeZoneSafely({ workspaceId: deps.workspaceId }, deps.siteTimeZone ? { siteTimeZone: deps.siteTimeZone } : {});
  const items = batch.items.map((row) => toCollectionEntryListItem({ row, fields: parsed.display.fields, timeZone }));
  const { template } = splitCollectionMarkerInner({ inner: marker.inner });
  const { columns, layout, structuredData } = parsed.display;
  const list = renderEntryList({ items, attribute: deps.entryListAttribute, options: { ...(template === undefined ? {} : { template }), columns, layout, typeKey, ...(structuredData === undefined ? {} : { structuredData }), ...(listingKey === undefined ? {} : { listingKey }) } });
  if (list === undefined || listingKey === undefined || !batch.hasMore) return list;
  return list + renderListingMore({ key: listingKey, href: listingBatchPath({ pagePath, key: listingKey, after: batch.next }) });
}

/**
 * Collection-marker resolution (C5, 2026-09-23) — resolves every distinct `{"type":"collection"}`
 * marker config found in `html` into the `ReadonlyMap<string, string | undefined>`
 * {@link renderStaticPage}'s own `collectionLists` param expects, keyed by {@link collectionMarkerKey}
 * so `static-render.ts`'s `injectCollectionEmbeds` (the other half of this contract) can look each
 * one back up by the identical key.
 *
 * Two or more markers sharing the exact same config (the common case: one marker repeated, or two
 * authored identically) resolve as ONE query, not one per occurrence — `collectionMarkerKey` is the
 * de-dup key precisely so a page cannot multiply its query cost by how many times a marker happens to
 * be pasted. Every distinct config beyond {@link MAX_DISTINCT_COLLECTION_MARKERS_PER_PAGE} is left
 * out of the returned map entirely (not queried at all) with one `console.warn`, which
 * `injectCollectionEmbeds` reads exactly like any other miss — its own authored fallback survives.
 *
 * A distinct config's own {@link resolveOneCollectionMarker} result — including `undefined` for a
 * miss — is always recorded under its key, per {@link StaticCollectionList}'s own doc: this lets the
 * caller (and any future re-scan) tell "already resolved, nothing to show" apart from "never looked
 * at", even though this route layer, only ever building the map once per request, has no re-scan of
 * its own that would need the distinction today.
 *
 * @complexity O(m) `collectionMarkerKey` computations over `m` markers found by `markersOfType`, plus
 * up to `MAX_DISTINCT_COLLECTION_MARKERS_PER_PAGE` independent `resolveOneCollectionMarker` calls run
 * concurrently via `Promise.all` — never one query per marker OCCURRENCE, only per distinct config.
 */
export async function resolveCollectionListsForRender({ deps, html, pagePath }: { deps: Pick<CollectionListsRenderDeps, "workspaceId" | "contentTypeRepo" | "entryRepo" | "listingBatch" | "entryListAttribute"> & Partial<Pick<CollectionListsRenderDeps, "siteTimeZone">>; html: string; pagePath: string }, _optional = {}): Promise<ReadonlyMap<string, string | undefined>> {
  const markers = markersOfType({ html: html, type: COLLECTION_MARKER_TYPE });
  if (markers.length === 0) return new Map();

  const distinctByKey = new Map<string, EmbedMarker>();
  for (const marker of markers) {
    const key = collectionMarkerKey(marker);
    if (!distinctByKey.has(key)) distinctByKey.set(key, marker);
  }

  const withinCap = Array.from(distinctByKey.entries()).slice(0, MAX_DISTINCT_COLLECTION_MARKERS_PER_PAGE);
  if (distinctByKey.size > withinCap.length) {
    console.warn(
      `[collection] page carries ${distinctByKey.size} distinct collection marker configs; only the first ${withinCap.length} are resolved, the rest keep their authored fallback content`
    );
  }

  const resolvedEntries = await Promise.all(
    withinCap.map(async ([key, marker]): Promise<readonly [string, string | undefined]> => [key, await resolveOneCollectionMarker({ deps, marker, pagePath })])
  );

  return new Map(resolvedEntries);
}
