import {
  InteractiveHtmlEditor as HtmlEditor,
  hasAttributeOnAnyNodeShape,
  type CanvasEmbedPlaceholderDescriptor,
  type InteractiveHtmlEditorProps as HtmlEditorProps,
} from '@jini-ai/ui/html-editor';

/**
 * @file Consuming-product-specific composition of `@jini-ai/ui/html-editor`'s generic
 * `InteractiveHtmlEditor`: a Page's `body_html` (the first caller — see the consuming product's own
 * `apps/admin/src/features/pages/PageEditor.tsx`)
 * can carry `<div data-embed-type="…" data-embed-id="…"></div>` placeholders (and the legacy
 * `data-widget-embed`/`data-form-embed` attributes on migration-era rows) that a separate scanner
 * (that product's own `src/widgets/html-embeds.ts`) resolves at render time — that scanner requires the div to
 * stay exactly empty and self-closing, and degrades silently, with no error, the moment anything is
 * written inside one. The CURRENT convention has since moved to a single `data-embed-config`
 * attribute carrying a JSON payload (that product's own `src/core/embeds/marker.ts`); `isProtectedEmbedElement`
 * below has not been updated to recognize it (tracked separately — see that function's own doc), but
 * `describeEmbedPlaceholder` below IS built against the current convention, since it only needs to
 * read the marker, not police edits to it.
 *
 * The generic `@jini-ai/ui` primitive has zero knowledge of either convention; this file is the thin
 * adapter that supplies them as an `isProtectedElement` predicate and a `describeEmbedPlaceholder`
 * labeler, so `PageEditor.tsx` can keep importing `InteractiveHtmlEditor` from `@jini-ai/admin/react`
 * unchanged.
 */

/** The attribute either the current (`data-embed-type`) or legacy (`data-widget-embed`,
 *  `data-form-embed`) convention uses to mark a Page HTML embed placeholder div — see the
 *  consuming product's own `src/widgets/html-embeds.ts`'s file header for the convention this protects.
 *
 *  **Does NOT include `data-embed-config`, the CURRENT marker attribute** (the consuming product's own
 *  `src/core/embeds/marker.ts`) — a known, separately-tracked gap: an embed marker written the current way is still
 *  editable/draggable/removable in this editor today. Left alone here deliberately (out of scope for
 *  the placeholder-card feature this file's `describeEmbedPlaceholder` was added for); widening this
 *  list to close that gap is a one-line fix (`'data-embed-config'` added below) but changes real
 *  interaction behavior (an operator who could previously drag/delete a `data-embed-config` marker no
 *  longer could), which deserves its own change, not a side effect of an unrelated card feature. */
const EMBED_MARKER_ATTRIBUTES = ['data-embed-type', 'data-widget-embed', 'data-form-embed'] as const;

/** True when `el` carries any embed marker attribute this convention recognizes — exported for
 *  direct unit-testability without mounting the editor. Uses `hasAttributeOnAnyNodeShape` because
 *  the `isProtectedElement` predicate is invoked from inside GrapesJS's `isComponent` callback,
 *  which is not always called with a real DOM `Element` — see that helper's own doc. */
export function isProtectedEmbedElement(el: Element): boolean {
  return EMBED_MARKER_ATTRIBUTES.some((attr) => hasAttributeOnAnyNodeShape(el, attr));
}

/**
 * Friendly card headings for every embed `type` value this codebase names anywhere, split into two
 * groups (traced against the consuming product's own `src/server/http/site/render.ts`'s `renderHtmlPageBody`/`isPageEmbedType`
 * at the owner's own request, 2026-08-25 — authoritative, not re-derived):
 *
 * - **`media`, `widget`, `post`, `content`** — the ONLY four types `isPageEmbedType` (gating
 *   `renderHtmlPageBody`, `render.ts:1238`) accepts, i.e. the complete set a Page's `body_html` — what
 *   this editor edits — can ever actually contain. These are the types an operator can realistically
 *   hit in the Interactive tab.
 * - **`partial`, `menu`** — the consuming product's own `src/widgets/resolver-service.ts`'s `THEME_OWNED_MARKER_TYPES`. NOT
 *   reachable inside a Page body — they live in THEME TEMPLATES (site header/nav/footer), authored
 *   outside this editor entirely, so this component should not grow UI affordances assuming one can
 *   appear here. Labeled anyway (rather than left to the generic fallback below) purely so the ONE
 *   defensive case — a future change routes theme markup through this same editor, or a marketplace
 *   theme's template gets opened here by mistake — still reads as a real word instead of a raw string.
 *
 * **`media` covers BOTH images and video — one type, one label, by design.** `resolveMediaTypeEmbeds`
 * (`resolver-service.ts`) resolves a `media` marker to either a bare `<img>` or `<video>` tag depending
 * on the asset's own kind, but that distinction lives entirely server-side in the resolved OUTPUT, not
 * in the marker's `data-embed-config` this function reads. Telling them apart here would need either a
 * new server endpoint (out of scope — see `identityLabel`'s doc on the identical media-title tradeoff)
 * or guessing from the id string, which is not a real signal and would be actively misleading if wrong.
 * "Media" stays correct for both until a cheap, real signal exists.
 *
 * Matched lower-cased — see `identityLabel`'s doc and `core/embeds/marker.ts`'s own `toEmbedRef` for
 * why the server-side scanner lower-cases `type` the same way. An unregistered type is not an error
 * here (unlike a rejected/unparseable marker) — `type` is deliberately a free string end-to-end (see
 * the consuming product's own `src/widgets/html-embeds.ts`'s file header) precisely so a new one (a marketplace theme
 * introducing its own, say) never requires a matching change on this list AND never renders nothing —
 * `titleCase` below covers it with a still-legible generic card instead of a blank/thrown result.
 */
const EMBED_KIND_LABELS: Readonly<Record<string, string>> = {
  media: 'Media',
  widget: 'Widget',
  post: 'Post',
  content: 'Content',
  partial: 'Partial',
  menu: 'Menu',
};

/** Upper-cases just the first character — `EMBED_KIND_LABELS`'s fallback for a `type` this table
 *  doesn't (yet) name, so the card still reads as a word rather than a raw lower-case config value. */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** How much of a bare id to show when no friendlier identity (`name`) is available on the marker's
 *  own config — long enough to tell two real ids apart at a glance, short enough the card stays a
 *  small chip instead of a wall of digits. */
const ID_PREVIEW_LENGTH = 8;

/**
 * The card's identity line: the marker's own `name` when its config carries one (free — no fetch),
 * otherwise a truncated `id`, otherwise an explicit "nothing was set" note rather than a blank line.
 *
 * **Deliberately does not fetch a human title for a `media` marker.** There is no cheap existing admin
 * route for a single media asset's title by id — `AdminAPI.listMedia()` (`apps/admin/src/lib/api.ts`)
 * is the only read, and it returns the ENTIRE workspace's media library, active and trashed, with no
 * id filter or pagination, just to answer one id's `title`. Adding a `GET /media/:id` route is out of
 * this feature's scope (an editor-chrome label is not worth a new server endpoint), and reusing
 * `listMedia()` here would mean an async network call — with its own loading/error/unmount-race
 * handling — inside what is otherwise a synchronous, purely-descriptive function called from a
 * GrapesJS `load` handler. `name`, when authored, covers the common case for free; an id-only marker
 * shows its id.
 */
function identityLabel(config: Readonly<Record<string, unknown>>): string {
  const name = typeof config.name === 'string' && config.name.length > 0 ? config.name : null;
  if (name) return name;
  const id = typeof config.id === 'string' && config.id.length > 0 ? config.id : null;
  if (!id) return 'no id set';
  return id.length > ID_PREVIEW_LENGTH ? `id ${id.slice(0, ID_PREVIEW_LENGTH)}…` : `id ${id}`;
}

/**
 * Recognizes a `data-embed-config` marker (the consuming product's own `src/core/embeds/marker.ts`'s single scanner
 * convention) on a live canvas element and describes it for `@jini-ai/ui/html-editor`'s
 * `applyCanvasEmbedPlaceholders` — see that function's own file header for what it does with the
 * result. Exported for direct unit-testability without mounting the editor, same convention
 * `isProtectedEmbedElement` above already documents.
 *
 * A marker whose `data-embed-config` fails to parse, isn't an object, or has no `type` returns
 * `undefined` — "not a marker this function can describe," the identical degrade-quietly contract
 * `scanEmbedMarkers` (the server-side scanner this mirrors) uses for a rejected marker at render time;
 * this function does not warn or log, since it runs on every keystroke-adjacent canvas re-render, not
 * at a write chokepoint where a loud rejection matters.
 *
 * @complexity O(1) — one attribute read, one `JSON.parse` of a small config object, one table lookup.
 */
export function describeEmbedPlaceholder(el: Element): CanvasEmbedPlaceholderDescriptor | undefined {
  const raw = el.getAttribute('data-embed-config');
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const config = parsed as Record<string, unknown>;
  if (typeof config.type !== 'string' || config.type === '') return undefined;

  const type = config.type.toLowerCase();
  return { kindLabel: EMBED_KIND_LABELS[type] ?? titleCase(type), identityLabel: identityLabel(config) };
}

export type InteractiveHtmlEditorProps = Omit<HtmlEditorProps, 'isProtectedElement' | 'describeEmbedPlaceholder'>;

export function InteractiveHtmlEditor(props: InteractiveHtmlEditorProps) {
  return (
    <HtmlEditor
      {...props}
      isProtectedElement={isProtectedEmbedElement}
      describeEmbedPlaceholder={describeEmbedPlaceholder}
    />
  );
}
