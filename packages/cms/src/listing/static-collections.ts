import { COLLECTION_MARKER_TYPE, substituteMarkers, withInnerContentFinal, type EmbedMarker } from "../widgets/markers/marker.js";
import { listingKeyOfAttributes } from "./html.js";


/**
 * One collection marker's already-rendered entry list, keyed by {@link collectionMarkerKey}. The
 * route layer (`pages.ts`'s `resolveCollectionListsForRender`, C5) builds these — one query per
 * distinct marker config found on the page, run through `entry-list-render.ts`'s `renderEntryList` —
 * and hands the result to {@link renderStaticPage} as a `ReadonlyMap<string, string | undefined>`.
 * `html` is `undefined` for a marker this file's caller looked up but found nothing to show for
 * (unknown type, invalid config, or zero matching entries): the map still records the key so
 * {@link injectCollectionEmbeds} treats it as a deliberate miss rather than re-querying, but the
 * marker's authored fallback survives either way (`collectionLists`'s own contract, same as
 * `postPreviews`'s "absent input, absent effect").
 */
export interface StaticCollectionList {
  /** {@link collectionMarkerKey}'s output for the marker this list answers. */
  readonly key: string;
  readonly html: string;
}

/**
 * A stable identity for one `{"type":"collection",…}` marker's config, so a page with several
 * differently-configured collection markers (or the same config repeated) can be resolved as
 * independent entries in a `Map` — the same per-marker addressing `withAddedId`'s own `id` field
 * gives markers that need one, done here via the WHOLE config instead because two collection markers
 * can differ in `typeKey`/`sort`/`where`/`limit` without either carrying an `id`. `JSON.stringify` of
 * the parsed config as-is (no key filtering) is deterministic for a given authored marker: both this
 * file's {@link injectCollectionEmbeds} and the route layer's map-builder parse the identical marker
 * text into the identical `config` object, so they always agree on the key.
 *
 * The authored `<template>` ({@link splitCollectionMarkerInner}) is part of the identity too: the
 * rendered list depends on it, so two markers with the same config but different templates must not
 * share one map entry (the route layer dedupes by this key and renders with the FIRST marker's
 * template). A template-less marker keeps the plain config-JSON key; a templated one uses a JSON
 * array `[config, template]`, which starts with `[` and so can never equal an object key.
 *
 * @complexity O(k + n) over the config's own key count and the marker's inner length — independent of
 * the surrounding document.
 */
export function collectionMarkerKey(marker: EmbedMarker): string {
  const { template } = splitCollectionMarkerInner({ inner: marker.inner });
  const key = template === undefined ? JSON.stringify(marker.config) : JSON.stringify([marker.config, template]);
  // A see-more listing renders its own key's batch, so it never shares an entry with another marker.
  const listingKey = listingKeyOfAttributes({ attrs: marker.attrs });
  return listingKey === undefined ? key : `listing:${listingKey}:${key}`;
}

/**
 * Splits a collection marker's authored inner content into an optional per-item `template` (the
 * first `<template>…</template>` found, exclusive of the tags themselves) and the remaining
 * `fallback` markup (everything else, shown untouched on a miss — see {@link injectCollectionEmbeds}).
 * A marker authored with no `<template>` returns its whole inner content as `fallback` and no
 * `template`, which routes the route layer's renderer into its built-in cards/list markup instead of
 * per-item template mode (`entry-list-render.ts`'s `EntryListRenderOptions.template`).
 *
 * @complexity O(n) over `inner`'s length for the two substring scans plus the slice/concat.
 */
export function splitCollectionMarkerInner({ inner }: { inner: string }, _optional = {}): { template?: string; fallback: string } {
  const openTag = "<template>";
  const closeTag = "</template>";
  const start = inner.indexOf(openTag);
  if (start === -1) return { fallback: inner };
  const end = inner.indexOf(closeTag, start + openTag.length);
  if (end === -1) return { fallback: inner };
  const template = inner.slice(start + openTag.length, end);
  const fallback = inner.slice(0, start) + inner.slice(end + closeTag.length);
  return { template, fallback };
}

/**
 * Substitutes each `{"type":"collection"}` marker with its pre-resolved, pre-rendered entry list from
 * `lists` (looked up by {@link collectionMarkerKey}), preserving the marker element's own tag and
 * authored attributes but stripping `data-embed-config` on the hit path so a later re-scan of the
 * same output can never rediscover and re-resolve it (D3: matches the widget rule via
 * {@link withInnerContentFinal}, unlike {@link injectPostPreviewsEmbeds}'s `withInnerContent`). A miss
 * — no entry in `lists` for this marker's key, or an entry whose `html` is `undefined` — leaves the
 * marker exactly as authored, so its fallback/empty-state markup survives untouched (same "absent
 * input, absent effect" contract {@link injectMenuEmbeds}/{@link injectPostPreviewsEmbeds} already
 * establish for their own marker types).
 *
 * @complexity O(n) over `html`'s length — one `substituteMarkers` scan-and-splice pass, plus O(1)
 * per collection marker for the map lookup.
 */
export function injectCollectionEmbeds({ html, lists }: { html: string; lists: ReadonlyMap<string, string | undefined> }, _optional = {}): string {
  return substituteMarkers({ html: html, resolve: (marker) => {
    if (marker.type !== COLLECTION_MARKER_TYPE) return undefined;
    const rendered = lists.get(collectionMarkerKey(marker));
    if (rendered === undefined) return undefined;
    const listingKey = listingKeyOfAttributes({ attrs: marker.attrs });
    const html = withInnerContentFinal({ marker: marker, inner: rendered });
    // A built-in layout's own wrapper is the see-more container, so the marker element gives up the
    // key; in template mode the items sit directly in the marker element, which keeps it.
    return listingKey === undefined || splitCollectionMarkerInner({ inner: marker.inner }).template !== undefined
      ? html
      : html.replace(` data-jini-listing="${listingKey}"`, "");
  } });
}
