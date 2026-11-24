import { useEffect, useState } from "react";

import type { MediaEditDialogValue } from "../components/MediaEditDialog/MediaEditDialog.hooks.js";

/**
 * @file State, attr reads and handlers for `MediaEmbedNodeView` (`media-embed-extension.tsx`), so
 * the component itself stays markup only. Same `useX(input, deps)` / `useWiredX(input)` split
 * `MediaEditDialog.hooks.tsx` uses: tests drive {@link useMediaEmbedNodeView} with a fixed locale,
 * the node view composes the host's `useWiredMediaEmbedNodeView`.
 */

/** Structural slice of the host's TipTap `NodeViewProps`: the node's attrs and the two writers this hook calls. */
export interface MediaEmbedNodeViewProps {
  node: { attrs: Record<string, unknown> };
  updateAttributes: (attributes: Record<string, unknown>) => void;
  deleteNode: () => void;
}

/** A `media` node's attrs as the node view reads them. The ref fields and `alt` read as `""` when
 *  unset; `cssClass`/`htmlAttributes` read as `null`, the "inherit the asset's own value" state
 *  `MediaEditDialog` edits. */
export interface MediaEmbedAttrs {
  assetId: string;
  transformName: string;
  alt: string;
  cssClass: string | null;
  htmlAttributes: string | null;
}

function stringOr<T>({ value, fallback }: { value: unknown; fallback: T }, _options = {}): string | T {
  return typeof value === "string" ? value : fallback;
}

/**
 * Reads a `media` node's attrs defensively — `bodyJson` is stored JSON that an agent tool or an
 * import may have written, so a non-string value degrades to "unset" instead of reaching the DOM.
 *
 * @param attrs - `props.node.attrs` as ProseMirror hands it over.
 * @returns The five attrs, normalized — see {@link MediaEmbedAttrs}.
 * @complexity O(1).
 */
export function readMediaEmbedAttrs(attrs: Record<string, unknown>): MediaEmbedAttrs {
  return {
    assetId: stringOr({ value: attrs.assetId, fallback: "" }),
    transformName: stringOr({ value: attrs.transformName, fallback: "" }),
    alt: stringOr({ value: attrs.alt, fallback: "" }),
    cssClass: stringOr({ value: attrs.cssClass, fallback: null }),
    htmlAttributes: stringOr({ value: attrs.htmlAttributes, fallback: null }),
  };
}

export type MediaPreviewKind = "pending" | "image" | "video";

/**
 * Maps an asset's `Content-Type` to the element that previews it — `video/*` is a video, anything
 * else (including `""` from a failed lookup) is an `<img>`, matching `renderDocMedia`'s own rule.
 *
 * @param input.contentType - The asset's `Content-Type` header value, possibly with parameters.
 * @returns `"video"` or `"image"`.
 * @complexity O(1).
 */
export function mediaPreviewKind({ contentType }: { contentType: string }, _options = {}): "image" | "video" {
  return contentType.trim().toLowerCase().startsWith("video/") ? "video" : "image";
}

/**
 * Resolves the preview kind for `assetId` from its real `Content-Type`; `"pending"` while the lookup
 * is in flight, and again whenever `assetId` changes (a Replace), so one asset's verdict never
 * carries over to the next. A failed lookup previews as an image.
 */
function usePreviewKind({ assetId, contentTypeOf }: { assetId: string; contentTypeOf: (required: { id: string }, optional?: Record<string, never>) => Promise<string> }, _options = {}): MediaPreviewKind {
  const [resolved, setResolved] = useState<{ assetId: string; kind: "image" | "video" } | null>(null);
  useEffect(() => {
    if (!assetId) return undefined;
    let live = true;
    contentTypeOf({ id: assetId }).then(
      (contentType) => live && setResolved({ assetId, kind: mediaPreviewKind({ contentType }) }),
      () => live && setResolved({ assetId, kind: "image" })
    );
    return () => {
      live = false;
    };
  }, [assetId, contentTypeOf]);
  return resolved?.assetId === assetId ? resolved.kind : "pending";
}

/** Everything `MediaEmbedNodeView` renders from. */
export interface MediaEmbedNodeViewController {
  assetId: string;
  alt: string;
  /** `api.mediaOriginalUrl({ id: assetId })` for a complete ref (`assetId` AND `transformName`), else `""` —
   *  the node view shows its broken-reference label for `""`. */
  previewSrc: string;
  /** Seeds `MediaEditDialog` from the node's current per-instance attrs. */
  editInitial: MediaEditDialogValue;
  /** Which element previews the asset: `"pending"` until its real `Content-Type` is known, then
   *  `"video"` for `video/*` and `"image"` for anything else — the same rule the public renderer's
   *  `renderDocMedia` applies. See `media-embed-extension.tsx`'s header. */
  previewKind: MediaPreviewKind;
  /** Replace's `MediaPickerDialog` is open. Separate from {@link editing}: each button only flips
   *  its own flag, so the two dialogs can never be open together. */
  picking: boolean;
  openPicker: () => void;
  closePicker: () => void;
  /** Points the node at the picked asset and closes the picker. */
  replaceWith: (item: { id: string; alt: string; title: string }, optional?: Record<string, never>) => void;
  editing: boolean;
  openEdit: () => void;
  closeEdit: () => void;
  /** Writes the dialog's `alt`/`cssClass`/`htmlAttributes` onto the node and closes the dialog. */
  saveEdit: (value: MediaEditDialogValue, optional?: Record<string, never>) => void;
  remove: () => void;
  /** Translates the node view's copy (the host's media dictionary, keyed by the English string). */
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}

/**
 * Owns `MediaEmbedNodeView`'s two dialog toggles, the asset's preview kind, and the handlers that
 * write back into the node through `props.updateAttributes`/`props.deleteNode`.
 *
 * @param props - The TipTap node-view props for one `media` node.
 * @param deps - `deps.locale` drives the returned `t` through `deps.translate` (the host's media
 *   dictionary lookup); `deps.contentTypeOf` looks up an asset's real `Content-Type`
 *   (`api.mediaContentType` when wired) and `deps.mediaOriginalUrl` builds an asset's original URL
 *   (`api.mediaOriginalUrl` when wired). Pass stable functions.
 * @returns See {@link MediaEmbedNodeViewController}.
 * @complexity O(1) per render.
 */
export function useMediaEmbedNodeView(
  props: MediaEmbedNodeViewProps,
  deps: {
    locale: string;
    contentTypeOf: (required: { id: string }, optional?: Record<string, never>) => Promise<string>;
    translate: (input: { locale: string; key: string }) => string;
    mediaOriginalUrl: (required: { id: string }) => string;
  }
): MediaEmbedNodeViewController {
  const { assetId, transformName, alt, cssClass, htmlAttributes } = readMediaEmbedAttrs(props.node.attrs);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const isRef = assetId.length > 0 && transformName.length > 0;
  const previewKind = usePreviewKind({ assetId: isRef ? assetId : "", contentTypeOf: deps.contentTypeOf });

  return {
    assetId,
    alt,
    previewSrc: isRef ? deps.mediaOriginalUrl({ id: assetId }) : "",
    editInitial: { alt, cssClass, htmlAttributes },
    previewKind,
    picking,
    openPicker: () => setPicking(true),
    closePicker: () => setPicking(false),
    replaceWith: (item, _optional = {}) => {
      props.updateAttributes({ assetId: item.id, transformName: "public", alt: item.alt || item.title });
      setPicking(false);
    },
    editing,
    openEdit: () => setEditing(true),
    closeEdit: () => setEditing(false),
    saveEdit: (value, _optional = {}) => {
      props.updateAttributes({ alt: value.alt, cssClass: value.cssClass, htmlAttributes: value.htmlAttributes });
      setEditing(false);
    },
    remove: () => props.deleteNode(),
    t: ({ key }, _optional = {}) => deps.translate({ locale: deps.locale, key }),
  };
}
