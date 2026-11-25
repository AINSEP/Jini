import { useState } from "react";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";

/**
 * @file The featured-image chooser's picker state (2026-10-05) — the same shape as
 * `@jini-ai/admin/seo`'s media-ref controller, but the value is a bare media asset id (what
 * `AdminPost.featuredMediaId` stores), not an `{id}:{transform}` ref.
 *
 * `value`/`onChange` are `usePostEditor`'s own `featuredMediaId` state: the save path needs it, so the
 * editor hook owns it and this hook only adds the dialog's visibility and the preview URL.
 */

export interface PostFeaturedImageController {
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  /** `MediaPickerDialog`'s `onSelect` — stores the picked asset's id and closes the dialog. */
  handleSelect: (input: { item: AdminMedia }, options?: Record<string, never>) => void;
  clear: () => void;
  /** Thumbnail `<img src>` for the current id, or `null` when none is chosen. */
  previewUrl: string | null;
  /** The picker's content-type filter — images only (2026-10-05: it offered videos, and a video
   *  saved as the featured image rendered as a broken thumb). The server refuses a non-image too. */
  accept: readonly string[];
  /** True once the current id's thumbnail failed to load (a deleted asset, or a non-image saved before
   *  the server refused those). The control shows a fixed-size placeholder instead of a broken `<img>`
   *  whose alt text spills out of the 36px box. Resets when the id changes. */
  previewFailed: boolean;
  /** The thumbnail `<img>`'s `onError`. */
  onPreviewError: () => void;
}

const FEATURED_IMAGE_ACCEPT: readonly string[] = ["image/*"];

/** The preview for a chosen image: its rendition when one is offered, else the original. */
function featuredPreviewUrl(
  { value, rendition, port }: { value: string; rendition: ((required: { id: string }, optional?: Record<string, never>) => string) | undefined; port: { mediaOriginalUrl: (required: { id: string }, optional?: Record<string, never>) => string } },
  _options: Record<string, never> = {},
): string {
  return rendition ? rendition({ id: value }) : port.mediaOriginalUrl({ id: value });
}

export function usePostFeaturedImage({ value, onChange, deps }: { value: string | null; onChange: (id: string | null) => void; deps: {
    port: { mediaOriginalUrl: (required: { id: string }, optional?: Record<string, never>) => string };
    /** A resized rendition's URL, tried before the original (2026-10-10: the cover slot downloaded a
     *  2.7 MB, 3749 × 5623 original to fill ~751 × 220px). Omitted, the preview is the original. */
    renditionUrl?: (required: { id: string }, optional?: Record<string, never>) => string;
  } }, _options: Record<string, never> = {}
): PostFeaturedImageController {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Keyed by the id that failed rather than a boolean, so choosing another image clears it without
  // an effect. The rendition failing first only drops to the original; the original failing too is
  // what marks the preview failed.
  const [renditionFailedId, setRenditionFailedId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const rendition = value && renditionFailedId !== value ? deps.renditionUrl : undefined;
  return {
    pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
    handleSelect: ({ item }, _options = {}) => {
      onChange(item.id);
      setPickerOpen(false);
    },
    clear: () => onChange(null),
    previewUrl: value ? featuredPreviewUrl({ value: value, rendition: rendition, port: deps.port }) : null,
    accept: FEATURED_IMAGE_ACCEPT,
    previewFailed: value !== null && failedId === value,
    onPreviewError: () => (rendition ? setRenditionFailedId(value) : setFailedId(value)),
  };
}
