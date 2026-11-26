import { useEffect, useMemo, useRef, useState, type RefObject, type UIEvent } from "react";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { acceptedMediaItems, type MediaPickerPort } from "../../media/MediaPickerDialog/MediaPickerDialog.hooks.js";
import {
  appendMediaSlugs,
  inactiveTabWillBeDropped,
  insertAtSelection,
  isValidMediaSlug,
  layoutUsesColumns,
  lineCount,
  MAX_MEDIA_HTML_LENGTH,
  MAX_MEDIA_ITEMS,
  mediaKindOf,
  mediaLayoutsFor,
  mediaSlugProblem,
  mediaSnippetFor,
  moveMediaItem,
  readMediaContent,
  slugCanShowEnd,
  switchMediaContentMode,
  toMediaConfig,
  viewedMediaContent,
  type MediaContentMode,
  type MediaContentState,
  type MediaContentStash,
  type MediaDraft,
  type MediaItem,
  type MediaKind,
  type MediaLayout,
  type MediaSlugProblem,
} from "./media-content-rules.js";

/**
 * @file State and handlers for `MediaContentEditor.tsx` (the two-tab Media / Raw HTML editor), so
 * the component stays markup only. The CONFIG passed in stays the single source of truth for the
 * active tab — every edit is emitted through `onChange` as the complete replacement config for
 * that tab (`toMediaConfig`). The only local state is what the config cannot hold:
 *
 * - the inactive tab's content (`stash`), so flipping tabs back and forth before Save loses
 *   nothing, while the saved config still carries only the active tab (contract);
 * - the tab shown without a config change (`viewMode`): switching to an empty tab emits nothing,
 *   so flipping tabs alone never marks the page dirty (`viewedMediaContent`);
 * - the add-by-slug input, the library picker's open state and its checked slugs.
 *
 * The library comes from `useMediaPickerItems` — the same cached `["media"]` query the media picker
 * dialog reads, not a second fetch path.
 */

/** One structured row with what the library knows about its slug. */
export interface MediaItemRow {
  item: MediaItem;
  /** The library asset with this slug, or `undefined` (unknown, or the library is still loading). */
  asset: AdminMedia | undefined;
  kind: MediaKind;
  /** The unfocused slug box shows the slug's end — see `slugCanShowEnd`. */
  showsSlugEnd: boolean;
  /** Why this row will not render, or `null`. `"unknown"` only once the library has loaded. */
  problem: Exclude<MediaSlugProblem, "empty" | "full"> | null;
}

export interface MediaContentEditorController {
  mode: MediaContentMode;
  setMode: (required: { mode: MediaContentMode }, optional?: Record<string, never>) => void;
  /** The tab NOT shown still holds content that saving the shown tab would drop. */
  inactiveHasContent: boolean;
  /** Active library assets (`null` while loading) and a load failure message. */
  library: AdminMedia[] | null;
  libraryError: string | null;
  /** What the picker offers: images, video and audio (the kinds the media widget renders). */
  pickable: AdminMedia[] | null;
  mediaUrl: (required: { asset: AdminMedia }, optional?: Record<string, never>) => string;

  layouts: readonly MediaLayout[];
  media: MediaDraft;
  showColumns: boolean;
  setLayout: (required: { layout: MediaLayout }, optional?: Record<string, never>) => void;
  setColumns: (required: { value: string }, optional?: Record<string, never>) => void;
  setAspectRatio: (required: { aspectRatio: string }, optional?: Record<string, never>) => void;
  setCssClass: (required: { cssClass: string }, optional?: Record<string, never>) => void;

  rows: MediaItemRow[];
  maxItems: number;
  /** An `undefined` `alt`/`caption` in `patch` removes that key, so the library's own text is used at render time. */
  updateItem: (required: { index: number; patch: MediaItemPatch }, optional?: Record<string, never>) => void;
  moveItem: (required: { index: number; delta: -1 | 1 }, optional?: Record<string, never>) => void;
  removeItem: (required: { index: number }, optional?: Record<string, never>) => void;

  slugDraft: string;
  setSlugDraft: (required: { value: string }, optional?: Record<string, never>) => void;
  slugProblem: { problem: MediaSlugProblem; slug: string } | null;
  addSlug: () => void;

  /** The rows themselves are `HtmlAttributeRows`' local state; this stores their string. */
  setHtmlAttributes: (required: { htmlAttributes: string }, optional?: Record<string, never>) => void;

  /** Where picked slugs go: the item list, or the Raw HTML caret. `null` = picker closed. */
  picker: "items" | "html" | null;
  picked: string[];
  openPicker: (required: { target: "items" | "html" }, optional?: Record<string, never>) => void;
  togglePicked: (required: { slug: string }, optional?: Record<string, never>) => void;
  cancelPicker: () => void;
  confirmPicker: () => void;

  html: string;
  setHtml: (required: { html: string }, optional?: Record<string, never>) => void;
  htmlLines: number;
  htmlTooLong: boolean;
  maxHtmlLength: number;
  htmlRef: RefObject<HTMLTextAreaElement | null>;
  gutterRef: RefObject<HTMLDivElement | null>;
  /** Keeps the line-number gutter scrolled with the textarea. */
  onHtmlScroll: (event: UIEvent<HTMLTextAreaElement>) => void;
}

/** Required inputs: the config being edited, where edits go, and which widget type owns it. */
export interface MediaContentEditorInput {
  port: MediaPickerPort; locale: string;
  useMediaPickerItems: (required: { port: MediaPickerPort }, optional: { locale: string }) => { items: AdminMedia[] | null; error: string | null };
  acceptsMedia: Parameters<typeof acceptedMediaItems>[0]["acceptsMedia"];
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  /** `media`, `gallery` (no Single layout), or `media` for a placement override. */
  widgetType: string;
}

const PICKABLE_TYPES = ["image/*", "video/*", "audio/*"] as const;

function rowProblem(required: { item: MediaItem; index: number; items: readonly MediaItem[]; asset: AdminMedia | undefined; libraryLoaded: boolean }): MediaItemRow["problem"] {
  if (!isValidMediaSlug({ slug: required.item.slug })) return "invalid";
  if (required.items.findIndex((other) => other.slug === required.item.slug) !== required.index) return "duplicate";
  if (required.libraryLoaded && !required.asset) return "unknown";
  return null;
}

type MediaEditorEmit = (next: MediaContentState) => void;
type MediaEditorLibrary = AdminMedia[] | null;

/** The raw-HTML tab: textarea/gutter refs, caret restoration after an insert, and the snippet inserter. */
function useMediaHtmlEditor({ state, emit }: { state: MediaContentState; emit: MediaEditorEmit }) {
  const htmlRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    if (pendingCaret.current === null || !htmlRef.current) return;
    htmlRef.current.focus();
    htmlRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  function insertHtml({ snippet }: { snippet: string }, _options: Record<string, never> = {}) {
    const area = htmlRef.current;
    const start = area?.selectionStart ?? state.html.length;
    const end = area?.selectionEnd ?? start;
    const result = insertAtSelection({ text: state.html, start, end, insert: snippet });
    pendingCaret.current = result.caret;
    emit({ ...state, html: result.text });
  }

  return {
    insertHtml,
    fields: {
      html: state.html,
      setHtml: ({ html }: { html: string }, _options: Record<string, never> = {}) => emit({ ...state, html }),
      htmlLines: lineCount({ text: state.html }),
      htmlTooLong: state.html.length > MAX_MEDIA_HTML_LENGTH,
      maxHtmlLength: MAX_MEDIA_HTML_LENGTH,
      htmlRef,
      gutterRef,
      onHtmlScroll: (event: UIEvent<HTMLTextAreaElement>) => { if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop; },
    },
  };
}

/** The typed-slug field and its validation. */
function useMediaSlugDraft({ state, library, setItems }: { state: MediaContentState; library: MediaEditorLibrary; setItems: (required: { items: MediaItem[] }) => void }) {
  const [slugDraft, setSlugDraftState] = useState("");
  const [slugProblem, setSlugProblem] = useState<MediaContentEditorController["slugProblem"]>(null);

  function addSlug() {
    const slug = slugDraft.trim();
    const problem = mediaSlugProblem({ slug, items: state.media.items, library });
    if (problem) { setSlugProblem({ problem, slug }); return; }
    setItems({ items: appendMediaSlugs({ items: state.media.items, slugs: [slug] }) });
    setSlugDraftState("");
    setSlugProblem(null);
  }

  return {
    slugDraft,
    setSlugDraft: ({ value }: { value: string }, _options: Record<string, never> = {}) => { setSlugDraftState(value); setSlugProblem(null); },
    slugProblem,
    addSlug,
  };
}

/** The library picker dialog: which target opened it, what is ticked, and how a confirm lands. */
function useMediaPicker({ state, assetsBySlug, setItems, insertHtml }: { state: MediaContentState; assetsBySlug: Map<string, AdminMedia>; setItems: (required: { items: MediaItem[] }) => void; insertHtml: (required: { snippet: string }) => void }) {
  const [picker, setPicker] = useState<"items" | "html" | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  function confirmPicker() {
    if (picker === "items") setItems({ items: appendMediaSlugs({ items: state.media.items, slugs: picked }) });
    if (picker === "html") {
      insertHtml({ snippet: picked.flatMap((slug) => {
        const asset = assetsBySlug.get(slug);
        return asset ? [mediaSnippetFor({ slug, alt: asset.alt, contentType: asset.contentType })] : [];
      }).join("\n") });
    }
    setPicker(null);
  }

  return {
    picker,
    picked,
    openPicker: ({ target }: { target: "items" | "html" }, _options: Record<string, never> = {}) => { setPicked([]); setPicker(target); },
    togglePicked: ({ slug }: { slug: string }, _options: Record<string, never> = {}) => setPicked((current) => (current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug])),
    cancelPicker: () => setPicker(null),
    confirmPicker,
  };
}

/** Layout, column, aspect-ratio and class controls for the media tab. */
function mediaLayoutFields({ widgetType, state, emitMedia }: { widgetType: string; state: MediaContentState; emitMedia: (patch: Partial<MediaDraft>) => void }): Pick<MediaContentEditorController, "layouts" | "media" | "showColumns" | "setLayout" | "setColumns" | "setAspectRatio" | "setCssClass"> {
  return {
    layouts: mediaLayoutsFor({ widgetType }),
    media: state.media,
    showColumns: layoutUsesColumns({ layout: state.media.layout }),
    setLayout: ({ layout }, _options: Record<string, never> = {}) => emitMedia({ layout }),
    setColumns: ({ value }, _options: Record<string, never> = {}) => {
      const columns = Number.parseInt(value, 10);
      emitMedia({ columns: Number.isFinite(columns) ? Math.max(1, Math.min(6, columns)) : undefined });
    },
    setAspectRatio: ({ aspectRatio }, _options: Record<string, never> = {}) => emitMedia({ aspectRatio }),
    setCssClass: ({ cssClass }, _options: Record<string, never> = {}) => emitMedia({ cssClass }),
  };
}

/** A per-item edit: a present-but-`undefined` `alt`/`caption` clears that key (contract: omitted, not empty). */
export type MediaItemPatch = { slug?: string; alt?: string | undefined; caption?: string | undefined };

/** Applies `patch` to `item`, dropping `alt`/`caption` when the patch clears them. */
function applyMediaItemPatch(item: MediaItem, patch: MediaItemPatch): MediaItem {
  const alt = "alt" in patch ? patch.alt : item.alt;
  const caption = "caption" in patch ? patch.caption : item.caption;
  return { slug: patch.slug ?? item.slug, ...(alt !== undefined && { alt }), ...(caption !== undefined && { caption }) };
}

/** Per-item edit, reorder and remove handlers. */
function mediaItemEditors({ state, setItems }: { state: MediaContentState; setItems: (required: { items: MediaItem[] }) => void }): Pick<MediaContentEditorController, "updateItem" | "moveItem" | "removeItem"> {
  return {
    updateItem: ({ index, patch }, _options: Record<string, never> = {}) => setItems({ items: state.media.items.map((item, i) => (i === index ? applyMediaItemPatch(item, patch) : item)) }),
    moveItem: ({ index, delta }, _options: Record<string, never> = {}) => {
      const next = moveMediaItem({ items: state.media.items, from: index, to: index + delta });
      if (next !== state.media.items) setItems({ items: next });
    },
    removeItem: ({ index }, _options: Record<string, never> = {}) => setItems({ items: state.media.items.filter((_, i) => i !== index) }),
  };
}

/** One row per item, with its library asset, kind and any slug problem. */
function mediaItemRows({ items, assetsBySlug, libraryLoaded }: { items: readonly MediaItem[]; assetsBySlug: Map<string, AdminMedia>; libraryLoaded: boolean }): MediaItemRow[] {
  return items.map((item, index) => {
    const asset = assetsBySlug.get(item.slug);
    return { item, asset, kind: mediaKindOf({ contentType: asset?.contentType }), showsSlugEnd: slugCanShowEnd({ slug: item.slug }), problem: rowProblem({ item, index, items, asset, libraryLoaded }) };
  });
}

/**
 * Owns the editor's derived view and handlers — see this file's header for what is local state.
 *
 * @param required - {@link MediaContentEditorInput}.
 * @param optional.port - The media library seam (`listMedia`, `mediaOriginalUrl`); tests pass a fake.
 * @param optional.locale - Locale for the library load-failure message.
 * @returns {@link MediaContentEditorController}.
 * @complexity O(n·n + m) per render for n ≤ 50 items (duplicate check) and m library assets.
 */
export function useMediaContentEditor(
  required: MediaContentEditorInput,
  _optional: Record<string, never> = {},
): MediaContentEditorController {
  const { config, onChange, widgetType, port, locale, useMediaPickerItems, acceptsMedia } = required;
  const { items: library, error: libraryError } = useMediaPickerItems({ port }, { locale });
  const stored = useMemo(() => readMediaContent({ config, widgetType }, { library }), [config, widgetType, library]);
  const [stash, setStash] = useState<MediaContentStash>({});
  const [viewMode, setViewMode] = useState<MediaContentMode | null>(null);
  // Every handler below edits what is SHOWN, so the first edit in an untouched tab commits it.
  const state = viewedMediaContent({ stored, viewMode, stash });
  const emit: MediaEditorEmit = (next) => onChange(toMediaConfig({ state: next }));
  const emitMedia = (patch: Partial<MediaDraft>) => emit({ ...state, media: { ...state.media, ...patch } });
  const setItems = ({ items }: { items: MediaItem[] }, _options: Record<string, never> = {}) => emitMedia({ items });
  const assetsBySlug = new Map((library ?? []).map((asset) => [asset.slug, asset]));
  const htmlEditor = useMediaHtmlEditor({ state, emit });
  const slugs = useMediaSlugDraft({ state, library, setItems });
  const picker = useMediaPicker({ state, assetsBySlug, setItems, insertHtml: htmlEditor.insertHtml });

  return {
    mode: state.mode,
    setMode: ({ mode }, _options: Record<string, never> = {}) => {
      if (mode === state.mode) return;
      const next = switchMediaContentMode({ stored, stash, mode });
      setStash(next.stash);
      setViewMode(next.viewMode);
      if (next.emit) emit(next.emit);
    },
    inactiveHasContent: inactiveTabWillBeDropped({ stored, viewMode, stash }),
    library,
    libraryError,
    pickable: acceptedMediaItems({ items: library, acceptsMedia }, { accept: PICKABLE_TYPES }),
    mediaUrl: ({ asset }, _options: Record<string, never> = {}) => port.mediaOriginalUrl({ id: asset.id }),

    ...mediaLayoutFields({ widgetType, state, emitMedia }),

    rows: mediaItemRows({ items: state.media.items, assetsBySlug, libraryLoaded: library !== null }),
    maxItems: MAX_MEDIA_ITEMS,
    ...mediaItemEditors({ state, setItems }),

    ...slugs,

    setHtmlAttributes: ({ htmlAttributes }, _options: Record<string, never> = {}) => emitMedia({ htmlAttributes }),

    ...picker,

    ...htmlEditor.fields,
  };
}
