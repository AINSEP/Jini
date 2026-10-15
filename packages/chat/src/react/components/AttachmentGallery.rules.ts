/**
 * @file Pure rules behind the attachment preview's image stepping (`AttachmentGallery.hooks.ts`):
 * which attachments a preview can step through, the wrap-around index math, and whether a filename
 * is worth showing at all. (The arrow-key mapping sits with the modal's own key handler in
 * `AttachmentPreviewModal.hooks.ts`, which this file already imports from.)
 *
 * **Images only.** A message (or the composer's staged set) can mix screenshots with a CSV or a
 * PDF; previous/next walks the images, the same rule (`looksLikeImageAttachment`) the thumbnails
 * and the modal's own `<img>` branch use. A non-image opens on its own, with no stepping - its
 * preview is a text pane or a metadata card, not something to flip through. `ChatAttachment.kind`
 * has no video variant, so there is no video case to step through either.
 */
import type { ChatAttachment } from '../../core/index.js';
import { looksLikeImageAttachment } from './AttachmentPreviewModal.hooks.js';

export interface AttachmentGallery {
  items: readonly ChatAttachment[];
  index: number;
}

/**
 * The set a preview opened on `opened` can step through: every image in `attachments`, in order,
 * positioned at `opened`; or just `opened` alone when it is not an image (or not in the list).
 * @complexity O(n) in `attachments.length`.
 */
export function attachmentGalleryFor(
  { attachments, opened }: { attachments: readonly ChatAttachment[]; opened: ChatAttachment },
  _options: Record<string, never> = {},
): AttachmentGallery {
  if (!looksLikeImageAttachment({ attachment: opened })) return { items: [opened], index: 0 };
  const items = attachments.filter((attachment) => looksLikeImageAttachment({ attachment }));
  const index = items.findIndex((attachment) => attachment.path === opened.path);
  return index === -1 ? { items: [opened], index: 0 } : { items, index };
}

/**
 * `index` moved by `step`, wrapping past either end so previous-on-first lands on the last image.
 * @complexity O(1).
 */
export function stepGalleryIndex({ index, count, step }: { index: number; count: number; step: number }): number {
  if (count <= 0) return 0;
  return (((index + step) % count) + count) % count;
}

/**
 * True for a name that is only a content hash (e.g. `b5aa983b7af337a54a4e23f8e0124c9d.png`, what a
 * media-library blob carries), which tells the operator nothing - the chip shows the thumbnail and
 * a plain "Image" label instead.
 */
export function isOpaqueAttachmentName({ name }: { name: string }): boolean {
  return /^[0-9a-f]{20,}(\.[a-z0-9]{1,5})?$/iu.test(name);
}
