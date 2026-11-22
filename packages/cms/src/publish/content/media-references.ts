import { embedMarkerTarget, galleryMediaReferences, scanEmbedMarkers } from "../../widgets/markers/index.js";

/**
 * @file Which media a packed post/page state points at — owner decision 2026-09-25, "images go along
 * with pages and posts": a scoped "Publish pages"/"Publish posts" run carries the media its in-scope
 * items reference (`export-bundle.ts`'s `includeReferencedEntities`, through `content-references.ts`).
 *
 * Reads the packed WIRE state (`features/post/publish-content.ts`'s `toPublishableState`), not a
 * `PostRecord`, because the scope layer only ever holds packed entities. Every reference shape the
 * content DB actually holds is covered:
 * - a ref-based TipTap `image`/`media` node's `attrs.assetId` (ADR-027 §4) — the same walk
 *   `Jini/packages/cms/src/widgets/resolver-service.ts` and `routes/site/media-rendition.ts` each carry a private copy of;
 *   neither is importable from here (both sit above `features/publish-content/` in the layering);
 * - a legacy `image` node's `attrs.src` — an admin `/media/{id}/…` URL or a public `/m/{key}/…` URL;
 * - any mark's string attrs holding such a URL — a `link` mark whose `href` is a media file's copied
 *   public URL (the Media panel shows it for exactly that);
 * - an `"html"` body's `data-embed-config` media marker, by `id ?? slug` via `embedMarkerTarget` (the
 *   same case-insensitive type match and precedence the embed resolver uses), and any `/m/{key}/` URL
 *   in it;
 * - `seoExtJson.ogImage`/`twitterImage`, a `"{assetId}:{transformName}"` ref or an absolute URL
 *   (`Jini/packages/cms/src/seo/types.ts`).
 *
 * Not covered: an old slug kept alive only by `media_slug_history` (matched against the CURRENT slug
 * only). Media an embedded widget holds is not read here: the widget itself is carried
 * (`content-references.ts`), and its own `references()` reads its config's media URLs through
 * {@link collectMediaUrlKeys}.
 *
 * Returns KEYS — an id or a slug — never resolved media: the caller matches them against the media
 * entities it actually holds, so a key naming nothing (a deleted asset, a stray URL) adds nothing.
 */

/** `/m/{key}/…` (public rendition route) and `/media/{id}/…` (admin media route, what a legacy
 *  `image` node's `src` was saved as). The key stops at the next `/`, quote, `?`, `#` or whitespace. */
const MEDIA_URL_PATTERN = /\/(?:m|media)\/([^/"'\s?#<>]+)\//g;

const SEO_IMAGE_FIELDS = ["ogImage", "twitterImage"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Adds every media key a URL-bearing string names. @complexity O(n) in the string's length. */
function addUrlKeys({ text, out }: { text: string; out: Set<string> }, _optional = {}): void {
  for (const match of text.matchAll(MEDIA_URL_PATTERN)) {
    try {
      out.add(decodeURIComponent(match[1]!));
    } catch {
      out.add(match[1]!); // a malformed %-escape: keep the raw segment rather than throw
    }
  }
}

/** Adds every media URL key held in a mark's string attrs (a `link` mark's `href`, chiefly).
 *  @complexity O(m) in the marks' total attr length. */
function addMarkKeys({ marks, out }: { marks: unknown; out: Set<string> }, _optional = {}): void {
  if (!Array.isArray(marks)) return;
  for (const mark of marks) {
    if (!isPlainObject(mark) || !isPlainObject(mark.attrs)) continue;
    for (const value of Object.values(mark.attrs)) if (typeof value === "string") addUrlKeys({ text: value, out });
  }
}

/** Every media key a free-text string names by a `/m/` or `/media/` URL (a text widget's body, a
 *  social link's `url`). @complexity O(n) in the string's length. */
export function collectMediaUrlKeys({ text }: { text: string }, _optional = {}): ReadonlySet<string> {
  const keys = new Set<string>();
  addUrlKeys({ text, out: keys });
  for (const ref of galleryMediaReferences({ config: { html: text } })) keys.add(ref.mediaId);
  return keys;
}

/** Shared authored-config reference scan, independent of layout/render validity. */
export function collectMediaConfigKeys({ config }: { config: unknown }, _optional: Record<string, never> = {}): ReadonlySet<string> {
  const keys = new Set(galleryMediaReferences({ config }).map(ref => ref.mediaId));
  if (isPlainObject(config) && typeof config.html === 'string') addUrlKeys({ text: config.html, out: keys });
  return keys;
}

/** Walks a TipTap tree collecting every `image`/`media` node's `assetId` and legacy `src` key, plus
 *  any media URL in a mark's attrs. @complexity O(n) in the tree's size. */
function addDocKeys({ root, out }: { root: unknown; out: Set<string> }, _optional = {}): void {
  walkDoc({
    root, visit: ({ node }) => {
      addNodeKeys({ node, out });
      addMarkKeys({ marks: node.marks, out });
    }
  });
}

/** Saved widget media belongs to the same authored reference owner as inline content. Hosts
 * supply the already-batched saved configs; content overlays are applied before scanning. A host
 * without that read port reports an incomplete scan instead of treating gated media as public. */
export function collectPlacedWidgetMediaKeys(
  { bodyJson, bodyHtml, savedWidgets }: { bodyJson?: unknown; bodyHtml?: string | null; savedWidgets?: ReadonlyMap<string, Record<string, unknown>> },
  _optional: Record<string, never> = {},
): { keys: ReadonlySet<string>; readable: boolean } {
  const keys = new Set<string>();
  let readable = true;
  const collect = ({ key, content }: { key: string; content: unknown }, _optional = {}): void => {
    if (!savedWidgets) { readable = false; return; }
    const config = savedWidgets.get(key);
    if (!config) return; // Missing/trashed widgets do not render; there is no served asset to gate.
    const merged = isPlainObject(content) ? { ...config, ...content } : config;
    for (const ref of collectMediaConfigKeys({ config: activeWidgetConfig({ merged }) })) keys.add(ref);
  };
  walkDoc({
    root: bodyJson, visit: ({ node }) => {
      if (node.type === 'widgetEmbed' && isPlainObject(node.attrs) && typeof node.attrs.widgetEntryId === 'string') collect({ key: node.attrs.widgetEntryId, content: node.attrs.content });
    }
  });
  if (typeof bodyHtml === 'string') for (const marker of scanEmbedMarkers({ html: bodyHtml }).markers) {
    if (marker.type.toLowerCase() !== 'widget') continue;
    const target = embedMarkerTarget({ type: marker.type, config: marker.config });
    if (target && target.key !== 'none') collect({ key: target.value, content: marker.config.content });
  }
  return { keys, readable };
}

/** @complexity O(n) over `html`'s length (one shared marker scan plus one URL scan). */
function addHtmlKeys({ html, out }: { html: string; out: Set<string> }, _optional = {}): void {
  for (const ref of galleryMediaReferences({ config: { html } })) out.add(ref.mediaId);
  for (const marker of scanEmbedMarkers({ html: html }).markers) {
    for (const key of collectMediaConfigKeys({ config: marker.config })) out.add(key);
    addGalleryKeys({ marker, out });
    if (marker.type.toLowerCase() !== "media") continue;
    const target = embedMarkerTarget({ type: marker.type, config: marker.config });
    if (target !== undefined && target.key !== "none") out.add(target.value);
  }
  addUrlKeys({ text: html, out });
}

/** `seoExtJson` is stored as a raw JSON string (`PostRecord.seoExtJson`'s own doc); an unparseable
 *  one contributes nothing. @complexity O(n) in the string's length for the parse. */
function addSeoKeys({ raw, out }: { raw: unknown; out: Set<string> }, _optional = {}): void {
  let seo: unknown = raw;
  if (typeof raw === "string") {
    try {
      seo = JSON.parse(raw);
    } catch {
      return;
    }
  }
  if (!isPlainObject(seo)) return;
  for (const field of SEO_IMAGE_FIELDS) {
    addSeoReference({ ref: seo[field], out });
  }
}

/**
 * Every media key (id or slug) one packed post/page state references, across `bodyJson`,
 * `bodyHtml` and `seoExtJson`. Pure; never throws on an unexpected shape — an unreadable field
 * simply contributes nothing, since this only ever ADDS media to a run and never gates one.
 *
 * @complexity O(n) in the total size of the three fields.
 */
export function collectReferencedMediaKeys({ state }: { state: Readonly<Record<string, unknown>> }, _optional = {}): ReadonlySet<string> {
  const keys = new Set<string>();
  addDocKeys({ root: state.bodyJson, out: keys });
  if (typeof state.bodyHtml === "string") addHtmlKeys({ html: state.bodyHtml, out: keys });
  addSeoKeys({ raw: state.seoExtJson, out: keys });
  return keys;
}

function addNodeKeys({ node, out }: { node: Record<string, unknown>; out: Set<string> }, _optional: Record<string, never> = {}): void {
  if (!isPlainObject(node.attrs)) return;
  if (node.type === 'widgetEmbed') {
    for (const key of collectMediaConfigKeys({ config: node.attrs.content })) out.add(key);
    return;
  }
  if (node.type !== "image" && node.type !== "media") return;
  if (typeof node.attrs.assetId === "string") {
    out.add(node.attrs.assetId);
    return;
  }
  if (typeof node.attrs.src === "string") addUrlKeys({ text: node.attrs.src, out });
}

function visitDocNode(
  { node, visit, stack }: { node: Record<string, unknown>; visit: (required: { node: Record<string, unknown> }, optional?: Record<string, never>) => void; stack: unknown[] },
  _optional: Record<string, never> = {},
): void {
  visit({ node });
  if (Array.isArray(node.content)) stack.push(node.content);
}

function walkDoc({ root, visit }: { root: unknown; visit: (required: { node: Record<string, unknown> }, optional?: Record<string, never>) => void }, _optional: Record<string, never> = {}): void {
  const stack: unknown[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }
    if (isPlainObject(node)) visitDocNode({ node, visit, stack });
  }
}

function activeWidgetConfig({ merged }: { merged: Record<string, unknown> }, _optional: Record<string, never> = {}): Record<string, unknown> {
  let mode = merged.mode;
  if (mode === null || mode === undefined) {
    mode = 'legacy';
    if (merged.html !== undefined) mode = 'html';
    if (merged.items !== undefined) mode = 'media';
  }
  if (mode === 'html') return { html: merged.html };
  return mode === 'media' ? { items: merged.items } : merged;
}

function addGalleryKeys({ marker, out }: { marker: ReturnType<typeof scanEmbedMarkers>["markers"][number]; out: Set<string> }, _optional: Record<string, never> = {}): void {
  if (marker.type.toLowerCase() !== "gallery") return;
  for (const image of galleryMediaReferences({ config: marker.config })) out.add(image.mediaId);
  // Read decoded config values too: a browser save entity-encodes JSON quotes in HTML.
  if (!Array.isArray(marker.config.images)) return;
  for (const image of marker.config.images) {
    if (isPlainObject(image) && typeof image.src === "string") addUrlKeys({ text: image.src, out });
  }
}

function addSeoReference({ ref, out }: { ref: unknown; out: Set<string> }, _optional: Record<string, never> = {}): void {

  if (typeof ref !== "string") return;
  if (ref.includes("/")) {
    addUrlKeys({ text: ref, out }); // an absolute URL, not a `"{assetId}:{transformName}"` ref
    return;
  }
  const assetId = ref.split(":")[0];
  if (assetId) out.add(assetId);
}
