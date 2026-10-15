/**
 * @file Which attachment a preview modal is open on, and stepping through its images. Shared by a
 * sent message's attachments (`MessageRow.tsx`) and the composer's staged chips
 * (`AttachmentTray.tsx`); the rules live in `AttachmentGallery.rules.ts`.
 */
import { useState } from 'react';
import type { ChatAttachment } from '../../core/index.js';
import { attachmentGalleryFor, stepGalleryIndex, type AttachmentGallery } from './AttachmentGallery.rules.js';

/** What `AttachmentPreviewModal` needs to draw previous/next; absent when there is nothing to step to. */
export interface AttachmentPreviewNavigation {
  index: number;
  count: number;
  onPrevious: () => void;
  onNext: () => void;
}

export interface AttachmentGalleryController {
  /** The attachment the modal shows, or `null` while it is closed. */
  opened: ChatAttachment | null;
  navigation: AttachmentPreviewNavigation | undefined;
  open: (attachment: ChatAttachment) => void;
  close: () => void;
}

/**
 * Open/close plus previous/next over `attachments`. The stepping set is snapshotted when the modal
 * opens: the modal covers the chips, so the list cannot change under it in a way the operator chose.
 * @complexity O(n) on open; O(1) per step.
 */
export function useAttachmentGallery(
  { attachments }: { attachments: readonly ChatAttachment[] },
  _options: Record<string, never> = {},
): AttachmentGalleryController {
  const [gallery, setGallery] = useState<AttachmentGallery | null>(null);
  const step = (by: number) =>
    setGallery((current) =>
      current === null ? null : { ...current, index: stepGalleryIndex({ index: current.index, count: current.items.length, step: by }) },
    );
  const count = gallery?.items.length ?? 0;
  return {
    opened: gallery?.items[gallery.index] ?? null,
    navigation: gallery !== null && count > 1
      ? { index: gallery.index, count, onPrevious: () => step(-1), onNext: () => step(1) }
      : undefined,
    open: (opened) => setGallery(attachmentGalleryFor({ attachments, opened })),
    close: () => setGallery(null),
  };
}
