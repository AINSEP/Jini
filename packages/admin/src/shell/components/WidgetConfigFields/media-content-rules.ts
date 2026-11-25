import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { parseMediaHtmlAttributes, type EmbedPolicyPort } from "../../../media/index.js";

/**
 * @file Pure rules behind `MediaContentEditor` — the two-tab ("Media" / "Raw HTML") editor for a
 * `media` widget's config, a `gallery` widget's config (Gallery is a compatibility alias over the
 * same Jini resolver), and a `widgetEmbed` node's per-placement `content` override. The shapes are
 * the mediawidget server contract (`ADS-memory/.local-artifacts/codex/2026-10-10-16/w8-out/
 * mediawidget-CONTRACT.md`); the server's `parseGalleryConfig` stays the real validator — every
 * check here is UX guidance that mirrors it, never a second source of truth.
 *
 * No React and no I/O, so every branch is asserted directly (`media-content-rules.unit.test.ts`).
 */

/** Contract cap on structured items (`MAX_GALLERY_IMAGES` on the server). */
export const MAX_MEDIA_ITEMS = 50;
/** Contract cap on `html` in the Raw HTML mode. */
export const MAX_MEDIA_HTML_LENGTH = 65_536;
/** Contract bound on a library slug used as a lookup key. */
const MAX_SLUG_LENGTH = 200;

export type MediaContentMode = "media" | "html";
export type MediaLayout = "single" | "grid" | "carousel" | "masonry";

/** Layouts the structured tab offers, in toolbar order. A saved `gallery` widget's own
 *  `configSchema` enum has no `single` (Jini `registry.ts`), so the gallery alias drops it. */
export function mediaLayoutsFor({ widgetType }: { widgetType: string }, _options: Record<string, never> = {}): readonly MediaLayout[] {
  return widgetType === "gallery" ? ["grid", "carousel", "masonry"] : ["single", "grid", "carousel", "masonry"];
}

/** Columns only mean something when more than one item sits side by side. */
export function layoutUsesColumns({ layout }: { layout: MediaLayout }, _optional: Record<string, never> = {}): boolean {
  return layout !== "single";
}

export interface MediaItem {
  slug: string;
  alt?: string;
  caption?: string;
}

/** The structured tab's whole state — everything `{ mode: "media" }` config carries. */
export interface MediaDraft {
  items: MediaItem[];
  layout: MediaLayout;
  columns?: number;
  aspectRatio?: string;
  cssClass?: string;
  htmlAttributes?: string;
}

/** Both tabs' content, read once from a config. Only one is ever saved (see {@link toMediaConfig}). */
export interface MediaContentState {
  mode: MediaContentMode;
  media: MediaDraft;
  html: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString({ value }: { value: unknown }, _options: Record<string, never> = {}): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A row for `slug` carrying the record's string `alt`/`caption` and nothing else. */
function itemWithText({ slug, record }: { slug: string; record: Record<string, unknown> }, _options: Record<string, never> = {}): MediaItem {
  const item: MediaItem = { slug };
  const alt = optionalString({ value: record.alt });
  const caption = optionalString({ value: record.caption });
  if (alt !== undefined) item.alt = alt;
  if (caption !== undefined) item.caption = caption;
  return item;
}

/** Copies only the keys a structured item may carry — never `src`/`mediaId` (contract). */
function readItem(value: unknown): MediaItem[] {
  return isRecord(value) && typeof value.slug === "string" ? [itemWithText({ slug: value.slug, record: value })] : [];
}

/**
 * Legacy Gallery configs store `images: [{ mediaId, alt, caption }]` by asset id. New content is
 * slug-first, so each image is mapped to its library slug; an id the library no longer has keeps
 * the id as its slug so the row stays visible (flagged "not in the media library") instead of
 * silently vanishing from the operator's list.
 *
 * @complexity O(n + m) for n images and m library assets (one id index).
 */
export function legacyImagesToItems(required: { images: unknown[]; library: readonly AdminMedia[] | null }): MediaItem[] {
  const slugById = new Map((required.library ?? []).map((asset) => [asset.id, asset.slug]));
  return required.images.flatMap((image) => {
    if (!isRecord(image) || typeof image.mediaId !== "string") return [];
    return [itemWithText({ slug: slugById.get(image.mediaId) ?? image.mediaId, record: image })];
  });
}

/** An explicit `mode` wins; a mode-less config is Raw HTML only when it carries an `html` string. */
function readMode(config: Record<string, unknown>): MediaContentMode {
  return config.mode === "html" || (config.mode === undefined && typeof config.html === "string") ? "html" : "media";
}

/** Structured `items` win over legacy `images`; neither means an empty list. */
function readItems({ config, library }: { config: Record<string, unknown>; library: readonly AdminMedia[] | null }, _options: Record<string, never> = {}): MediaItem[] {
  if (Array.isArray(config.items)) return config.items.flatMap(readItem);
  return Array.isArray(config.images) ? legacyImagesToItems({ images: config.images, library }) : [];
}

/** Carries the optional layout fields a config already holds onto the draft; absent or blank ones stay unset. */
function copyOptionalMediaFields({ config, media }: { config: Record<string, unknown>; media: MediaDraft }, _options: Record<string, never> = {}): void {
  if (typeof config.columns === "number") media.columns = config.columns;
  for (const key of ["aspectRatio", "cssClass", "htmlAttributes"] as const) {
    const value = optionalString({ value: config[key] });
    if (value !== undefined) media[key] = value;
  }
}

/**
 * Reads any accepted config (new `mode` content, mode-less `items`/`html`, or legacy `images`) into
 * both tabs' state. The inactive tab starts empty; the default layout follows the widget type.
 *
 * @complexity O(n + m) — see {@link legacyImagesToItems}.
 */
export function readMediaContent(
  required: { config: Record<string, unknown>; widgetType: string },
  optional: { library?: readonly AdminMedia[] | null } = {},
): MediaContentState {
  const { config, widgetType } = required;
  const mode = readMode(config);
  const layouts = mediaLayoutsFor({ widgetType });
  const layout = layouts.find((candidate) => candidate === config.layout) ?? layouts[0];
  if (layout === undefined) throw new Error(`media widget ${widgetType} has no layouts`);
  const media: MediaDraft = { items: readItems({ config, library: optional.library ?? null }), layout };
  copyOptionalMediaFields({ config, media });
  return { mode, media, html: mode === "html" ? optionalString({ value: config.html }) ?? "" : "" };
}

/**
 * The complete replacement config for the ACTIVE tab only — the contract says "do not retain
 * inactive-mode data in a replacement config", so switching to Raw HTML and saving drops the item
 * list, and vice versa. Blank optional strings are omitted rather than saved as `""`.
 *
 * @complexity O(n) over items (a shallow copy).
 */
export function toMediaConfig(required: { state: MediaContentState }): Record<string, unknown> {
  const { state } = required;
  if (state.mode === "html") return { mode: "html", html: state.html };
  const { media } = state;
  const config: Record<string, unknown> = { mode: "media", items: media.items.map((item) => ({ ...item })), layout: media.layout };
  if (media.columns !== undefined && layoutUsesColumns({ layout: media.layout })) config.columns = media.columns;
  for (const key of ["aspectRatio", "cssClass", "htmlAttributes"] as const) {
    const value = media[key]?.trim();
    if (value) config[key] = value;
  }
  return config;
}

/** Whether a tab holds anything that saving the OTHER tab would discard. */
export function hasModeContent(required: { state: MediaContentState; mode: MediaContentMode }): boolean {
  return required.mode === "html" ? required.state.html.trim() !== "" : required.state.media.items.length > 0;
}

/** Each tab's content as last seen in the editor, kept locally so flipping tabs loses nothing. */
export interface MediaContentStash {
  media?: MediaDraft;
  html?: string;
}

/** `viewMode` set and different from the stored mode: a tab is shown that nothing was typed in yet. */
function isPendingView(stored: MediaContentState, viewMode: MediaContentMode | null): viewMode is MediaContentMode {
  return viewMode !== null && viewMode !== stored.mode;
}

/**
 * What the editor shows. Switching to an EMPTY tab does not touch the config (owner, 2026-10-11:
 * "Leave site?" appeared after only flipping Media ↔ Raw HTML), so until the first edit there the
 * shown tab (`viewMode`) differs from the stored one and its content comes from the stash. Every
 * edit emits this view, which is what commits the new tab.
 *
 * @param required.stored - The config as read by {@link readMediaContent}.
 * @param required.viewMode - The tab shown without a config change, or `null`.
 * @param required.stash - {@link MediaContentStash}.
 * @returns The state the tabs render and edit.
 */
export function viewedMediaContent(required: { stored: MediaContentState; viewMode: MediaContentMode | null; stash: MediaContentStash }): MediaContentState {
  const { stored, viewMode, stash } = required;
  if (!isPendingView(stored, viewMode)) return stored;
  if (viewMode === "html") return { ...stored, mode: "html", html: stash.html ?? "" };
  return { ...stored, mode: "media", media: stash.media ?? stored.media };
}

/**
 * One tab switch. Back to the stored tab: only the view changes. To the other tab: the stored tab
 * is stashed, then the switch emits only when the target tab holds content (saving it really would
 * change the config); an empty target is just shown (`viewMode`) until something is typed there.
 *
 * @param required.stored - The config as read by {@link readMediaContent}.
 * @param required.stash - {@link MediaContentStash}.
 * @param required.mode - The tab being switched to (never the one already shown).
 * @returns The next stash and view, and the state to emit (`null` = leave the config alone).
 */
export function switchMediaContentMode(required: { stored: MediaContentState; stash: MediaContentStash; mode: MediaContentMode }): {
  stash: MediaContentStash; viewMode: MediaContentMode | null; emit: MediaContentState | null;
} {
  const { stored, stash, mode } = required;
  if (mode === stored.mode) return { stash, viewMode: null, emit: null };
  const nextStash = stored.mode === "html" ? { ...stash, html: stored.html } : { ...stash, media: stored.media };
  const target: MediaContentState = { mode, media: nextStash.media ?? stored.media, html: nextStash.html ?? stored.html };
  return hasModeContent({ state: target, mode }) ? { stash: nextStash, viewMode: null, emit: target } : { stash: nextStash, viewMode: mode, emit: null };
}

/**
 * Whether saving now would drop the hidden tab's content — the "Saving keeps only this tab"
 * notice. Never while an untouched tab is shown: the save then keeps the stored tab, so nothing
 * is lost.
 */
export function inactiveTabWillBeDropped(required: { stored: MediaContentState; viewMode: MediaContentMode | null; stash: MediaContentStash }): boolean {
  const { stored, viewMode, stash } = required;
  if (isPendingView(stored, viewMode)) return false;
  const other: MediaContentMode = stored.mode === "html" ? "media" : "html";
  return hasModeContent({ state: { mode: other, media: stash.media ?? { ...stored.media, items: [] }, html: stash.html ?? "" }, mode: other });
}

/** Moves the item at `from` to `to` (both clamped to the list). Returns the same array when the
 *  move is a no-op so callers can skip an update. @complexity O(n). */
export function moveMediaItem(required: { items: MediaItem[]; from: number; to: number }): MediaItem[] {
  const { items, from } = required;
  const to = Math.max(0, Math.min(items.length - 1, required.to));
  if (from < 0 || from >= items.length || from === to) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) throw new Error(`media item is missing at index ${from}`);
  next.splice(to, 0, moved);
  return next;
}

/** Why a slug cannot be added (or saved in a row), or `null` when it can. */
export type MediaSlugProblem = "empty" | "invalid" | "duplicate" | "unknown" | "full";

/**
 * Whether an unfocused slug box may show the slug's END (`direction: rtl` in
 * `media-content-editor.css`). Rows' slugs often share a long start, so the end is what tells them
 * apart. Safe only when the slug starts with a letter and ends with a letter or digit: then every
 * character resolves left-to-right and RTL just moves the overflow. A leading digit or a trailing
 * hyphen would be visibly reordered ("2024-gala" shown as "gala-2024"), so those keep the plain box.
 */
export function slugCanShowEnd({ slug }: { slug: string }, _options: Record<string, never> = {}): boolean {
  return /^[a-z](?:.*[a-z0-9])?$/is.test(slug);
}

/** The server's slug key rule: nonempty, at most 200 characters, no slash or whitespace. */
export function isValidMediaSlug({ slug }: { slug: string }, _options: Record<string, never> = {}): boolean {
  return slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && !/[\s/]/.test(slug);
}

/**
 * Checks one slug before it joins the list. `library === null` (still loading) skips the
 * "unknown" check — an unknown slug is only a render diagnostic on the server, never a save error,
 * so the editor must not block on a library it has not seen yet.
 *
 * @complexity O(n + m) for n items and m library assets.
 */
export function mediaSlugProblem(required: { slug: string; items: readonly MediaItem[]; library: readonly AdminMedia[] | null }): MediaSlugProblem | null {
  const slug = required.slug.trim();
  if (slug === "") return "empty";
  if (!isValidMediaSlug({ slug })) return "invalid";
  if (required.items.length >= MAX_MEDIA_ITEMS) return "full";
  if (required.items.some((item) => item.slug === slug)) return "duplicate";
  if (required.library && !required.library.some((asset) => asset.slug === slug)) return "unknown";
  return null;
}

/**
 * Appends library picks (by slug) in pick order, skipping slugs already listed and anything past
 * the 50-item cap. Library alt/caption are NOT copied: an omitted alt already falls back to the
 * library's alt at render time (contract), and copying would freeze today's text into the widget.
 *
 * @complexity O(n + k) for n existing items and k picks.
 */
export function appendMediaSlugs(required: { items: MediaItem[]; slugs: readonly string[] }): MediaItem[] {
  const seen = new Set(required.items.map((item) => item.slug));
  const next = required.items.slice();
  for (const slug of required.slugs) {
    if (next.length >= MAX_MEDIA_ITEMS) break;
    if (!seen.has(slug)) {
      seen.add(slug);
      next.push({ slug });
    }
  }
  return next;
}

export type MediaKind = "image" | "video" | "audio" | "unknown";

/** Which thumbnail a row shows: a real image, or an icon for video/audio. */
export function mediaKindOf({ contentType }: { contentType: string | null | undefined }, _options: Record<string, never> = {}): MediaKind {
  if (!contentType) return "unknown";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "unknown";
}

/** One editable `name = value` row of the HTML attributes section. */
export interface HtmlAttributeRow {
  name: string;
  value: string;
}

/** Same loose token shape as the media HTML-attribute tokenizer in `@jini-ai/cms/widgets/markers` (not exported
 *  there): `name`, or `name="value"` / `name='value'` / `name=value`. */
const ATTRIBUTE_TOKEN = /([^\s="']+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g;

/** Values are stored as typed; only a double quote inside a double-quoted value is escaped. */
function decodeAttributeValue({ value }: { value: string }, _options: Record<string, never> = {}): string {
  return value.replace(/&quot;/g, '"');
}

/** Quotes one value: double quotes, or single quotes when it holds `"` but no `'`, else `&quot;`. */
function quoteAttributeValue({ value }: { value: string }, _options: Record<string, never> = {}): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replace(/"/g, "&quot;")}"`;
}

/**
 * Splits the stored `htmlAttributes` string into rows, keeping EVERY token — including ones the
 * renderer will drop — so the operator sees and can fix them. Text the tokenizer cannot read
 * (a stray quote) becomes one row with the fragment as its name, so nothing typed is lost.
 *
 * @complexity O(n) in the string length (one regex pass).
 */
export function htmlAttributesToRows({ text }: { text: string | undefined }, _options: Record<string, never> = {}): HtmlAttributeRow[] {
  const source = (text ?? "").trim();
  const rows: HtmlAttributeRow[] = [];
  ATTRIBUTE_TOKEN.lastIndex = 0;
  let consumed = 0;
  for (let match = ATTRIBUTE_TOKEN.exec(source); match !== null; match = ATTRIBUTE_TOKEN.exec(source)) {
    const skipped = source.slice(consumed, match.index).trim();
    if (skipped !== "") rows.push({ name: skipped, value: "" });
    consumed = match.index + match[0].length;
    rows.push({ name: match[1], value: decodeAttributeValue({ value: match[2] ?? match[3] ?? match[4] ?? "" }) });
  }
  const trailing = source.slice(consumed).trim();
  if (trailing !== "") rows.push({ name: trailing, value: "" });
  return rows;
}

/**
 * Joins rows back into the stored string: `name="value"` (quoted per {@link quoteAttributeValue}), a bare `name` for an
 * empty value (a boolean attribute), rows without a name skipped. Inverse of
 * {@link htmlAttributesToRows} for every well-formed row list.
 *
 * @complexity O(total row text).
 */
export function rowsToHtmlAttributes({ rows }: { rows: readonly HtmlAttributeRow[] }, _optional: Record<string, never> = {}): string {
  return rows
    .filter((row) => row.name.trim() !== "")
    .map((row) => {
      const name = row.name.trim();
      return row.value === "" ? name : `${name}=${quoteAttributeValue({ value: row.value })}`;
    })
    .join(" ");
}

/** Whether the renderer's allowlist will drop this row (event handler, unsafe URL/style, a name
 *  off the list) — reuses the media attribute validator rather than a second allowlist. */
export function isDroppedAttributeRow({ row, policy }: { row: HtmlAttributeRow; policy: EmbedPolicyPort }, _optional: Record<string, never> = {}): boolean {
  if (row.name.trim() === "") return false;
  return parseMediaHtmlAttributes({ text: rowsToHtmlAttributes({ rows: [row] }), policy }).error !== null;
}

/**
 * The markup "Insert media…" drops into Raw HTML for one library asset: slug-first, never a URL
 * (contract: `data-media-slug` fills src, srcset, alt and size at render time). Authored alt is
 * included for images because it overrides the stored fallback and keeps the source readable.
 */
export function mediaSnippetFor(required: { slug: string; alt?: string; contentType?: string | null }): string {
  const slug = required.slug.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const kind = mediaKindOf({ contentType: required.contentType });
  if (kind === "video") return `<video data-media-slug="${slug}" controls></video>`;
  if (kind === "audio") return `<audio data-media-slug="${slug}" controls></audio>`;
  const alt = (required.alt ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<img data-media-slug="${slug}" alt="${alt}">`;
}

/** Replaces `[start, end)` of `text` with `insert` and returns the new text plus the caret after
 *  it. Out-of-range positions clamp to the text. @complexity O(n). */
export function insertAtSelection(required: { text: string; start: number; end: number; insert: string }): { text: string; caret: number } {
  const start = Math.max(0, Math.min(required.text.length, required.start));
  const end = Math.max(start, Math.min(required.text.length, required.end));
  return { text: required.text.slice(0, start) + required.insert + required.text.slice(end), caret: start + required.insert.length };
}

/** Line count for the Raw HTML gutter (an empty text is still one line). */
export function lineCount({ text }: { text: string }, _options: Record<string, never> = {}): number {
  let count = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
  return count;
}
