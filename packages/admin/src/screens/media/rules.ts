import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { MediaHtmlAttributeError } from "../../media/index.js";
import type { RowMenuItem } from "../../react/index.js";
import type { QueryKey } from "@jini-ai/core/fetch";
import type { MediaContentTabId } from "./hooks/use-media-tabs.hooks.js";

/** The host's dictionary lookup (`{ locale, key }` to the translated string), passed in by each caller that renders copy. */
export type MediaTranslate = (args: { locale: string; key: string }) => string;
/** The host's API-error describer, passed in by the caller that surfaces list/trash/restore failures. */
export type DescribeMediaApiError = (args: { e: unknown; fallback: string }) => string;

/**
 * @file Pure logic for the `media` feature — everything that computes a value rather than
 * rendering one. One shared module for `Media.tsx`'s four components (`Media`, `MediaPreview`,
 * `EditMediaPanel`, `MediaLightbox`), matching `features/posts/rules.ts`'s convention: the
 * decisions live in one importable, directly testable module with no React in it.
 *
 * `KEYS` (fetch-query migration, 2026-08-12): one cache identity for the whole media grid. No
 * separate "detail" key — unlike `forms`/`collections`, `EditMediaPanel` never independently reads
 * an item; it receives `item: AdminMedia` as a prop, already resolved from the list by
 * `findEditingItem` below. So the sibling-vs-nested-key trap `@jini-ai/admin/forms` rules.ts's `KEYS` doc and
 * `collections/rules.ts`'s `KEYS` doc both document does not apply here — there is only ever one
 * query on this resource, and every write (`upload`/`trash`/`deleteMedia`/`updateMedia`, whether
 * fired from `use-media.hooks.ts` or `use-edit-media-panel.hooks.ts`) invalidates it.
 */
export const KEYS = {
  list: ["media"] as QueryKey,
};

/**
 * This screen's name on `lib/content-refresh-bus.ts` — see `taxonomy/rules.ts`'s `TAXONOMY_RESOURCE`
 * for why this is a plain colocated constant rather than a shared registry, and
 * `use-content-refresh-subscription.hooks.ts` for the hook that reads it. No agent tool writes media
 * today (the host has no `media/agent-tools.ts`), but the grid still subscribes:
 * the bus's own "unknown scope, refresh everything" default (`contentRefreshApplies`'s `null` case)
 * means every finished assistant run already notifies this resource whether or not the run touched
 * it, and wiring it now is a one-line, zero-risk way for this screen to inherit a future media tool's
 * writes automatically instead of needing a fourth staleness bug fixed later.
 */
export const MEDIA_RESOURCE = "media";

/** Read-only provenance: never derive facts from editorial credit. The caller localizes Unknown.
 *  `userNames` maps principal id -> username; an id with no known user (API key, removed user,
 *  or a caller who may not list users) still shows the raw id rather than nothing. */
export function mediaCreatedByLabel(required: {
  item: Pick<AdminMedia, "createdBy">; unknownLabel: string;
}, optional: { userNames?: ReadonlyMap<string, string> } = {}): string {
  const id = required.item.createdBy;
  if (!id) return required.unknownLabel;
  return optional.userNames?.get(id) ?? id;
}

/** Editable metadata fields `api.updateMedia` accepts — kept as its own type so the diffing
 * helper below stays exhaustive if the patch shape ever grows.
 *
 * `width`/`height`/`cssClass` (owner-directed quick-and-dirty sizing fix): `null` means "not set" —
 * both size fields are optional, blank-means-render-at-native-size, never defaulted/computed. */
export type MediaMetadataPatch = {
  title?: string;
  /** Independent of `title` (2026-09-07) — see `AdminMedia.slug`'s own doc. Never `null`: unlike
   *  `cssClass`, a media asset's slug has no "cleared" representation to fall back to. */
  slug?: string;
  alt?: string;
  caption?: string;
  credit?: string;
  width?: number | null;
  height?: number | null;
  cssClass?: string | null;
  /** Same undefined/null/value contract as `cssClass` above (2026-09-07) — see `AdminMedia
   *  .htmlAttributes`'s own doc. */
  htmlAttributes?: string | null;
};

/** Builds a partial patch containing only the fields whose draft value differs from `item`'s
 * current value — the backend's own contract is optional-field/partial-patch, so this never
 * sends an unchanged field (AC-01's "field left unchanged is not overwritten" proof).
 *
 * `item` MUST be the same snapshot `draft` was seeded from, frozen for the caller's whole edit
 * session — never a live value that can advance independently of `draft` (2026-08-12 audit,
 * TM-2026-08-12-A). If `item` moves out from under a frozen `draft`, an untouched field whose
 * server value changed in the interim reads as "changed" here and gets wrongly included in the
 * patch, silently reverting whatever changed it. See `use-edit-media-panel.hooks.ts`'s
 * `baselineRef` for the caller-side guarantee. */
export function diffMediaMetadata(required: {
  item: AdminMedia;
  draft: Required<MediaMetadataPatch>;
}): MediaMetadataPatch {
  const { item, draft } = required;
  const patch: Record<string, unknown> = {};
  for (const field of MEDIA_METADATA_PATCH_FIELDS) {
    if (draft[field] !== item[field]) patch[field] = draft[field];
  }
  return patch as MediaMetadataPatch;
}

/** Every editable field {@link diffMediaMetadata} compares, in patch order. A list rather than one
 *  `if` per field so adding a field is one entry, not one more branch in that function. */
const MEDIA_METADATA_PATCH_FIELDS: readonly (keyof MediaMetadataPatch)[] = [
  "title",
  "slug",
  "alt",
  "caption",
  "credit",
  "width",
  "height",
  "cssClass",
  "htmlAttributes",
];

/** Parses a `<input type="number">`'s string value into the `number | null` shape
 *  `MediaMetadataPatch.width`/`height` need: blank -> `null` (native size), otherwise `Number(...)`.
 *  Not guarded against `NaN` here — the input's own `type="number"` keeps free-text out in
 *  practice, and a stray `NaN` would fail `updateMediaMetadata`'s positive-integer check server-side
 *  rather than silently save, matching this fix's "quick and dirty, not silently wrong" bar. */
export function parseOptionalPixelSize({ value }: { value: string }, _optional: Record<string, never> = {}): number | null {
  return value.trim() === "" ? null : Number(value);
}

// The HTML-attribute allowlist and parser belong to the content domain (`@jini-ai/cms/widgets/markers`); `integrations/jini-admin/embed-policy-ports.ts` binds them to `@jini-ai/admin/media`'s `parseMediaHtmlAttributes`, and the host keeps only the translated message.
/** Formats a {@link MediaHtmlAttributeError} into the specific, visible message the edit form
 *  shows — always names the rejected attribute or fragment (owner requirement). Same
 *  `media-i18n.ts`'s `t` (COMMON_I18N-falling-back) + `.replace("{placeholder}", ...)` idiom
 *  `ThemePageDetailsModal.tsx`'s collision warning already uses for an interpolated value.
 *
 * @complexity O(1).
 */
export function describeMediaHtmlAttributeError({ error, locale, translate }: { error: MediaHtmlAttributeError; locale: string; translate: MediaTranslate }, _optional: Record<string, never> = {}): string {
  const t = (key: string): string => translate({ locale: locale, key: key });
  const ATTRIBUTE_PLACEHOLDER = "{attribute}";
  if (error.reason === "event-handler") {
    return t("Event handler attributes like '{attribute}' are not allowed.").replace(ATTRIBUTE_PLACEHOLDER, () => error.attribute);
  }
  if (error.reason === "unsafe-url") {
    // Message text unchanged across the 2026-09-23 `javascript-url` -> `unsafe-url` rename (plan
    // §2) — every locale already carries this key.
    return t("'{attribute}' cannot use a javascript: value.").replace(ATTRIBUTE_PLACEHOLDER, () => error.attribute);
  }
  if (error.reason === "unsafe-style") {
    return t("'{attribute}' cannot use an unsafe style value.").replace(ATTRIBUTE_PLACEHOLDER, () => error.attribute);
  }
  if (error.reason === "malformed") {
    return t("Could not parse HTML attributes near '{fragment}'.").replace("{fragment}", () => error.attribute);
  }
  return t("'{attribute}' is not an allowed HTML attribute.").replace(ATTRIBUTE_PLACEHOLDER, () => error.attribute);
}

/** The slice of the browser's `FileReader` {@link readFileAsBase64} drives, so tests can hand it a
 *  plain-object reader that fails, answers `null`, or answers a bare (comma-less) payload. */
export interface Base64FileReader {
  readonly error: unknown;
  readonly result: string | ArrayBuffer | null;
  onerror: (() => void) | null;
  onload: (() => void) | null;
  readAsDataURL(file: Blob): void;
}

/** Reads a browser `File` into a base64 string (no data: URL prefix).
 *  @param optional.createReader - Builds the reader; defaults to the browser's `FileReader`. */
export function readFileAsBase64(
  { file }: { file: File },
  optional: { createReader?: () => Base64FileReader } = {},
): Promise<string> {
  const createReader = optional.createReader ?? (() => new FileReader());
  return new Promise((resolve, reject) => {
    const reader = createReader();
    reader.onerror = () => reject(reader.error ?? new Error("failed to read file"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * The grid contents for one tab: every non-trashed asset on "all", only non-trashed assets whose
 * sniffed `contentType` is in the matching family on "images"/"videos", and only trashed assets on
 * "trash".
 *
 * Prefix matching on `image/`/`video/` rather than an enumerated list of the sniffer's current
 * outputs: the server's sniffer allowlist can gain a format (another image codec, say) without
 * this file having to learn about it, and a prefix cannot mis-sort a type it has never seen.
 *
 * Three kinds of asset are deliberately NOT in either filtered tab:
 * - `application/octet-stream` — a REAL answer from the sniffer (an unrecognized file), not a
 *   missing one. It is neither an image nor a video, so All is where it belongs.
 * - `text/html`/`image/svg+xml` — markup the byte-serving route force-downloads as a stored-XSS
 *   defusal. `image/svg+xml` does match the `image/` prefix and so DOES appear under Images, which
 *   is correct: it is genuinely an image, and its card falls back to the non-previewable
 *   placeholder exactly as it does on All.
 * - `null` — see {@link hasUntypedMedia}.
 *
 * @complexity Time O(n), space O(n).
 */
export function filterMediaByTab({ media, tab }: { media: AdminMedia[]; tab: MediaContentTabId }, _optional: Record<string, never> = {}): AdminMedia[] {
  // Trash is its own tab (owner, 2026-10-23): the list route returns every status, so trashed rows
  // are split off here and appear on no other tab.
  if (tab === "trash") return media.filter((item) => item.status === "trashed");
  const active = media.filter((item) => item.status !== "trashed");
  if (tab === "images") return active.filter((item) => item.contentType?.startsWith("image/") ?? false);
  if (tab === "videos") return active.filter((item) => item.contentType?.startsWith("video/") ?? false);
  return active;
}

/**
 * Item counts for the "all"/"images"/"videos"/"trash" tabs (owner ask, 2026-09-26: a count next to each
 * Media tab, e.g. "All 42 · Images 30 · Videos 12"). Reuses {@link filterMediaByTab} for the two
 * filtered tabs rather than a separate count-only pass, so a tab's badge number can never disagree
 * with what switching to it actually shows.
 *
 * Returns `{}` — no key at all, not a `0` — while `media` is still loading (`null`): `Media.tsx`
 * passes this straight through as each tab's `TabBarTab.count`, whose own contract
 * (`components/TabBar.tsx`) renders no badge at all when `count` is `undefined`, so a tab never
 * flashes a misleading "0" before the first load resolves.
 *
 * @complexity Time O(n), space O(n) — four passes over `media` (one per tab); not fused into a
 * single loop, since this runs once per render on an already-small, unpaginated array and four
 * readable filter calls are clearer than one hand-merged one.
 */
export function mediaContentTabCounts({ media }: { media: AdminMedia[] | null }, _optional: Record<string, never> = {}): Partial<Record<MediaContentTabId, number>> {
  if (!media) return {};
  return {
    all: filterMediaByTab({ media, tab: "all" }).length,
    images: filterMediaByTab({ media, tab: "images" }).length,
    videos: filterMediaByTab({ media, tab: "videos" }).length,
    trash: filterMediaByTab({ media, tab: "trash" }).length,
  };
}

/**
 * The two "Order by" choices the admin Media grid's dropdown (`Media.tsx`'s `MediaOrderControl`)
 * offers — owner-directed (2026-09-11): "have a sort by to see our most recent images", plus an
 * Alphabetical option as a visible control she can change, not a fixed default. See
 * `use-media.hooks.ts`'s `orderBy` state for where the selection lives and {@link sortMediaByOrder}
 * below for how each one is computed.
 *
 * Deliberately just these two, not a general field/direction sort framework: the dispatch that
 * added this scoped it to "at minimum Created + Alphabetical … do not build a general sorting
 * framework," and a closed two-entry list (rather than a `{ field, direction }` pair a caller could
 * combine into four variants) is what that reads as. "Created" always means newest-first and
 * "Alphabetical" always means A–Z — an oldest-first or Z–A option would need a real direction
 * axis, which is exactly the framework this was told not to build.
 */
export type MediaOrderBy = "created" | "alphabetical";

/** Option list for `Media.tsx`'s `<select>` — `label` is an i18n key straight into `MEDIA_DICT`
 *  (this codebase's copy-string-is-its-own-key convention), not a value transformed at render
 *  time. Exported as the single source of the two order ids so the dropdown and
 *  {@link sortMediaByOrder} can never drift apart on which ones exist. */
export const MEDIA_ORDER_OPTIONS: readonly { id: MediaOrderBy; label: string }[] = [
  { id: "created", label: "Created (newest first)" },
  { id: "alphabetical", label: "Alphabetical (A–Z)" },
];

/** Plain ascending string compare (`-1`/`0`/`1`) for an `id` tiebreak — a named helper rather than
 *  a nested ternary inline, so both comparators below read as one ordered statement each. */
function compareAscending(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Orders the already-fully-fetched (unpaginated) media array for display — the client-side
 * counterpart to `SqliteMediaRepo.list()`'s own hardcoded newest-first `orderBy`
 * (the host's sqlite media repo). See `use-media.hooks.ts`'s header
 * for why this control lives entirely on the client rather than threaded through the
 * `GET .../media` request as a query param: the grid has no pagination, so the full workspace
 * library is already in memory by the time an operator touches this control, and this function
 * re-derives BOTH orderings itself — rather than trusting `"created"` to already arrive pre-sorted
 * from the server — so it is the one place that decides display order regardless of what order the
 * fetch happened to return, the same "client owns how an already-fetched list displays" precedent
 * {@link filterMediaByTab} above already establishes for the type tabs.
 *
 * `"created"`: newest first by `createdAt`, tie-broken by `id` descending for a deterministic
 * order on an exact-timestamp collision — mirrors the SQL adapter's own `orderBy(desc(createdAt),
 * desc(id))` compound sort (see that file's doc for why the tiebreak exists), so a page load and a
 * same-tick batch upload agree on order even though this function never reads the DB's own
 * tiebreak directly.
 *
 * `"alphabetical"`: case-insensitive by `title` (`toLocaleLowerCase()` before `localeCompare`, so
 * "apple" and "Apple" interleave the way a human alphabetizing a shelf would, not split apart by
 * byte case), trimmed first so incidental leading/trailing whitespace cannot shift a title's
 * position. Tie-broken by `id` ascending. An EMPTY title sorts first: `AdminMedia.title` has no
 * non-empty invariant enforced anywhere in `uploadMedia`/`updateMediaMetadata` (an operator can
 * clear it to `""` through `EditMediaPanel`), and `"".localeCompare(anything non-empty)` is
 * already `<= 0`, so no special-case branch is needed for it.
 *
 * @complexity Time O(n log n) in `media.length` (one sort), space O(n) for the shallow copy —
 * never mutates the caller's array, since `Media.tsx` still needs `media` itself unsorted for
 * `hasUntypedMedia`.
 */
export function sortMediaByOrder({ media, orderBy }: { media: AdminMedia[]; orderBy: MediaOrderBy }, _optional: Record<string, never> = {}): AdminMedia[] {
  const sorted = [...media];
  if (orderBy === "alphabetical") {
    sorted.sort((a, b) => {
      const byTitle = a.title.trim().toLocaleLowerCase().localeCompare(b.title.trim().toLocaleLowerCase());
      return byTitle !== 0 ? byTitle : compareAscending(a.id, b.id);
    });
    return sorted;
  }
  sorted.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return compareAscending(b.id, a.id);
  });
  return sorted;
}

/**
 * Whether any asset has no recorded content type — what drives the filtered tabs' "some items
 * aren't shown here" note.
 *
 * A `null` `contentType` does not mean "unknown format" (that is a real, recorded
 * `application/octet-stream`); it means the server could not read that blob's bytes to sniff them,
 * because the list route backfills every readable pre-existing row on read. So this is normally
 * `false` and the note never renders. It exists because the alternative — a filtered tab that
 * quietly drops rows it cannot classify — is worse than the honest placeholder these tabs replaced:
 * an operator would have no way to tell "no images" from "images the server couldn't read".
 *
 * @complexity Time O(n), space O(1).
 */
export function hasUntypedMedia({ media }: { media: AdminMedia[] }, _optional: Record<string, never> = {}): boolean {
  return media.some((item) => item.contentType === null);
}

/** Whether the active tab shows {@link hasUntypedMedia}'s note: only the type tabs drop untyped
 *  rows, and a trashed untyped row is on the Trash tab, not missing from All. */
export function showsUntypedMediaNote({ media, tab }: { media: AdminMedia[]; tab: MediaContentTabId }, _optional: Record<string, never> = {}): boolean {
  return (tab === "images" || tab === "videos") && hasUntypedMedia({ media: filterMediaByTab({ media, tab: "all" }) });
}

/** Alt text fallback chain for a previewed media asset: prefers the operator-set alt, falls back
 *  to the title, and finally a generic label when neither is set. */
export function mediaAltText({ item, untitledAsset }: { item: AdminMedia; untitledAsset: string }, _optional: Record<string, never> = {}): string {
  return item.alt || item.title || untitledAsset;
}

/** An asset's real pixel shape, read off the loaded `<img>`/`<video>` (the row's `width`/`height`
 *  are the public-render override, not the file's size). `duration` is seconds, video only. */
export interface MediaShape {
  width: number;
  height: number;
  duration?: number;
}

/** Ratios worth naming on a card badge; anything else shows its pixel size alone, since a reduced
 *  fraction like 683:384 tells the operator nothing. */
const NAMED_RATIOS: readonly [number, number][] = [[1, 1], [4, 3], [3, 4], [3, 2], [2, 3], [16, 9], [9, 16], [4, 5], [21, 9]];

/** Taller than about 1:3 (owner design, 2026-10-29): screenshots and long posters show their top
 *  part fitted to the width, with a "Long image" badge, instead of a sliver in the middle. */
export const LONG_MEDIA_HEIGHT_RATIO = 3;

/** The card badges for a loaded asset: "9:16 · 1080×1920", a m:ss duration, and whether it is long. */
export function mediaShapeBadges(shape: MediaShape, _optional: Record<string, never> = {}): { size: string; duration: string | null; isLong: boolean } {
  const pixels = `${shape.width}×${shape.height}`;
  const ratio = shape.width / shape.height;
  const named = NAMED_RATIOS.find(([w, h]) => Math.abs(w / h - ratio) / ratio < 0.02);
  const seconds = Math.round(shape.duration ?? Number.NaN);
  return {
    size: named ? `${named[0]}:${named[1]} · ${pixels}` : pixels,
    duration: Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : null,
    isLong: shape.duration === undefined && shape.height / shape.width > LONG_MEDIA_HEIGHT_RATIO,
  };
}

/** The upload button's text for the tab being viewed (owner, 2026-11-01), and the file kinds its
 *  picker accepts — kept in step so the label is always true to what the picker lets through. */
export function mediaUploadLabel({ tab }: { tab: MediaContentTabId }, _optional: Record<string, never> = {}): string {
  if (tab === "images") return "Upload image";
  return tab === "videos" ? "Upload video" : "Upload image or video";
}

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml";
// .mov/.m4v listed by extension as well as MIME: some platforms report a .mov with no MIME type, which would
// leave an iPhone recording greyed out in the OS dialog.
const VIDEO_ACCEPT = "video/mp4,video/webm,.mov,.m4v,video/quicktime,video/x-m4v";

/** The picker's `accept` for a tab. Advisory only: the server still enforces its allowlist. */
export function mediaUploadAccept({ tab }: { tab: MediaContentTabId }, _optional: Record<string, never> = {}): string {
  if (tab === "images") return IMAGE_ACCEPT;
  return tab === "videos" ? VIDEO_ACCEPT : `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`;
}

/** Landscape shapes (owner design, 2026-11-01) fill the grid preview edge to edge: within this
 *  width:height range `cover` trims at most ~20% of one side of the 16:10 box, so the usual
 *  screen recording or photo shows no gray bands. Anything outside it (a 9:16 video, a tall
 *  wordmark, a wide banner) stays whole and fitted, the 10-29 "never crop" rule. */
const FILL_RATIO_MIN = 1.25;
const FILL_RATIO_MAX = 2;

/** Whether a loaded asset's shape suits edge-to-edge fill of the card preview. */
export function mediaFillsPreview(shape: MediaShape, _optional: Record<string, never> = {}): boolean {
  const ratio = shape.width / shape.height;
  return ratio >= FILL_RATIO_MIN && ratio <= FILL_RATIO_MAX;
}

/** Resolves `media.find((m) => m.id === editingId)`, or `null` — the item whose `EditMediaPanel`
 *  is expanded, resolved once here rather than in the view. */
export function findEditingItem({ media, editingId }: { media: AdminMedia[] | null; editingId: string | null }, _optional: Record<string, never> = {}): AdminMedia | null {
  if (!media) return null;
  return media.find((m) => m.id === editingId) ?? null;
}

/**
 * `useMedia`'s error banner, extracted out of that hook (`refactor/fetch-query` complexity pass,
 * 2026-08-12 — same reason `Jini redirects/SOURCE-RATIONALE.md`'s `visibleRedirectsError` was extracted).
 *
 * Precedence: an active write's own failure (trash/purge/restore, in array order) always wins over a
 * background list-refresh failure — `use-media.hooks.ts`'s `clearOtherWriteErrors` is this rule's
 * other half, same pairing `Jini redirects/SOURCE-RATIONALE.md`'s `firstWriteError`/`clearOtherWriteErrors` document,
 * so at most one write error is ever live at a time and array order rarely matters in practice. The
 * list error only surfaces before `media` has ever loaded, matching every other migrated feature's
 * "a later background failure must not blank an already-rendered screen" guard.
 *
 * Upload failures are not here (2026-10-13, owner item #9): upload moved into its own dialog, which
 * shows its failure inline next to the file the operator can retry — `useMedia`'s `uploadError`.
 *
 * Fallback strings are passed in, not hardcoded — unlike `@jini-ai/admin/forms` rules.ts's `visibleFormEditorError`
 * (whose hook never localized its own error strings), `use-media.hooks.ts`'s pre-migration catches
 * all used `translate(locale, "...")` fallbacks, and this preserves that.
 *
 * @complexity Time/space: O(1) — four fixed checks, no iteration.
 */
export function visibleMediaError(params: {
  trashError: Error | null;
  purgeError: Error | null;
  deleteFallback: string;
  restoreError: Error | null;
  restoreFallback: string;
  listError: Error | null;
  listFallback: string;
  hasMedia: boolean;
  describeApiError: DescribeMediaApiError;
}): string | null {
  if (params.trashError) return params.describeApiError({ e: params.trashError, fallback: params.deleteFallback });
  if (params.purgeError) return params.describeApiError({ e: params.purgeError, fallback: params.deleteFallback });
  if (params.restoreError) return params.describeApiError({ e: params.restoreError, fallback: params.restoreFallback });
  if (params.hasMedia) return null;
  return params.listError ? params.describeApiError({ e: params.listError, fallback: params.listFallback }) : null;
}

/** The callbacks a media row menu needs. Passed in rather than imported so this module stays free
 *  of state and navigation, and so a test can assert exactly which one a given row wires up —
 *  mirrors `features/posts/rules.ts`'s `PostRowMenuHandlers`. */
export interface MediaRowMenuHandlers {
  onToggleEdit: (item: AdminMedia) => void;
  onTrash: (item: AdminMedia) => void;
  onRequestPurge: (item: AdminMedia) => void;
}

/**
 * The row-action menu for one media item.
 *
 * Two branches worth a test: the "Edit metadata"/"Close editing" label flips on whether THIS row
 * is the one currently expanded (`editingId === item.id`), and "Trash" vs. "Delete permanently"
 * is gated on `item.status` — an already-trashed item skips the reversible step entirely, same
 * asymmetry `Posts.tsx`'s row menu documents for its own Disable/Delete split.
 *
 * @complexity Time/space: O(1) — at most two entries, no iteration.
 */
export function mediaRowMenuItems(
  { item, editingId, handlers, locale, translate }: { item: AdminMedia; editingId: string | null; handlers: MediaRowMenuHandlers; locale: string; translate: MediaTranslate },
  _optional: Record<string, never> = {},
): RowMenuItem[] {
  const t = (key: string): string => translate({ locale: locale, key: key });
  const items: RowMenuItem[] = [
    {
      key: "edit",
      label: editingId === item.id ? t("Close editing") : t("Edit metadata"),
      onSelect: () => handlers.onToggleEdit(item),
    },
  ];
  if (item.status === "trashed") {
    items.push({ key: "purge", label: t("Delete permanently"), destructive: true, onSelect: () => handlers.onRequestPurge(item) });
  } else {
    items.push({ key: "trash", label: t("Trash"), onSelect: () => handlers.onTrash(item) });
  }
  return items;
}

/** Resolves the lightbox's currently-open item from an index into `items`, or `null` when
 *  `activeIndex` is `null` (closed). */
export function resolveLightboxItem({ items, activeIndex }: { items: AdminMedia[]; activeIndex: number | null }, _optional: Record<string, never> = {}): AdminMedia | null {
  return activeIndex !== null ? items[activeIndex] ?? null : null;
}
