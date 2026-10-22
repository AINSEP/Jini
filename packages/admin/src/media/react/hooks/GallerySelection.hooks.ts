export interface GallerySelectionImage { readonly mediaId: string; readonly alt: string; readonly caption: string }

/** Controlled gallery selection: metadata follows media ids through reordering and deduplication.
 * The host owns persistence and media loading; these callbacks only derive the next ordered value.
 * @complexity O(n+m) time/space per action; the default bound is 50 images.
 */
export function useGallerySelection(
  { images, onChange }: { images: readonly GallerySelectionImage[]; onChange: (images: GallerySelectionImage[]) => void },
  { maxImages = 50 }: { maxImages?: number } = {},
) {
  return {
    add({ images: additions }: { images: readonly GallerySelectionImage[] }, _optional: Record<string, never> = {}) {
      const next = new Map(images.map(image => [image.mediaId, image]));
      for (const image of additions) if (!next.has(image.mediaId)) next.set(image.mediaId, image);
      if (next.size > maxImages) throw new Error(`Choose at most ${maxImages} gallery images`);
      onChange([...next.values()]);
    },
    update({ mediaId, patch }: { mediaId: string; patch: Partial<Pick<GallerySelectionImage, 'alt' | 'caption'>> }, _optional: Record<string, never> = {}) {
      onChange(images.map(image => image.mediaId === mediaId ? { ...image, ...patch } : image));
    },
    remove({ mediaId }: { mediaId: string }, _optional: Record<string, never> = {}) { onChange(images.filter(image => image.mediaId !== mediaId)); },
    move({ mediaId, beforeId }: { mediaId: string; beforeId: string }, _optional: Record<string, never> = {}) {
      if (mediaId === beforeId) return;
      const source = images.find(image => image.mediaId === mediaId);
      if (!source || !images.some(image => image.mediaId === beforeId)) return;
      const next = images.filter(image => image.mediaId !== mediaId);
      next.splice(next.findIndex(image => image.mediaId === beforeId), 0, source);
      onChange(next);
    },
  };
}
