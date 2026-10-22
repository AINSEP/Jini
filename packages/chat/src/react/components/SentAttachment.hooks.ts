/**
 * @file Thumbnail state for one attachment on a SENT user message (`SentAttachment.tsx`).
 *
 * A sent image shows as a small thumbnail instead of a filename chip, so the operator can see at a
 * glance which screenshots went with the turn. The bytes come from the same
 * `attachment-preview-cache.ts` the preview modal reads: only files this browser staged for upload in
 * this page session are there (the server cannot hand them back - see that module's doc). Anything
 * else - a non-image, a reload, the cache's eviction cap, a browser that cannot decode the format -
 * stays the filename chip, which still opens the preview modal's honest fallback.
 */
import { useEffect, useState } from 'react';
import type { ChatAttachment } from '../../core/index.js';
import { getAttachmentPreviewSource } from '../hooks/attachment-preview-cache.js';
import { canCreateObjectUrl, looksLikeImageAttachment } from './AttachmentPreviewModal.hooks.js';

/** Blob-URL port, so a test (jsdom has no `URL.createObjectURL`) can supply a fake. */
export interface ObjectUrlPort {
  create: (file: File) => string;
  revoke: (url: string) => void;
}

/** The platform's Blob URLs, or `undefined` where they do not exist (jsdom, non-browser hosts). */
export function platformObjectUrls(): ObjectUrlPort | undefined {
  if (!canCreateObjectUrl()) return undefined;
  return { create: (file) => URL.createObjectURL(file), revoke: (url) => URL.revokeObjectURL(url) };
}

/**
 * The cached file to draw as a thumbnail, or `undefined` when the attachment should stay a chip:
 * not an image (same `looksLikeImageAttachment` rule the preview modal uses), or no bytes cached.
 * @complexity O(1).
 */
export function sentAttachmentThumbnailSource(
  { attachment }: { attachment: Pick<ChatAttachment, 'kind' | 'name' | 'path'> },
  { getSource = getAttachmentPreviewSource }: { getSource?: (required: { path: string }) => File | undefined } = {},
): File | undefined {
  if (!looksLikeImageAttachment({ attachment })) return undefined;
  return getSource({ path: attachment.path });
}

export interface SentAttachmentThumbnail {
  /** Object URL to put in the `<img>`, or `undefined` to render the filename chip. */
  thumbnailUrl: string | undefined;
  /** The `<img>`'s `onError`: an undecodable file falls back to the chip instead of a broken image. */
  onThumbnailError: () => void;
}

/**
 * Creates the thumbnail's object URL on mount and revokes it on unmount (an effect, not `useMemo`,
 * so a Strict Mode double render cannot leak a URL - same reasoning as the preview modal's hook).
 * @param input.hostRendered - True when a host `renderAttachment` draws this chip.
 * @param options.objectUrls - Blob-URL port; defaults to the platform's, `undefined` where absent.
 * @param options.getSource - Preview-cache lookup; defaults to the shared cache.
 * @complexity O(1) per attachment.
 */
export function useSentAttachmentThumbnail(
  { attachment, hostRendered = false }: { attachment: ChatAttachment; hostRendered?: boolean },
  { objectUrls = platformObjectUrls(), getSource = getAttachmentPreviewSource }: {
    objectUrls?: ObjectUrlPort | undefined;
    getSource?: (required: { path: string }) => File | undefined;
  } = {},
): SentAttachmentThumbnail {
  const [failed, setFailed] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);
  // A host `renderAttachment` owns the chip's content, so no thumbnail URL is made for it.
  const source = failed || hostRendered || !objectUrls ? undefined : sentAttachmentThumbnailSource({ attachment }, { getSource });

  useEffect(() => {
    if (!source || !objectUrls) {
      setThumbnailUrl(undefined);
      return undefined;
    }
    const url = objectUrls.create(source);
    setThumbnailUrl(url);
    return () => objectUrls.revoke(url);
    // `objectUrls` is a fresh object per render by default; the file is what the URL is made from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  return { thumbnailUrl, onThumbnailError: () => setFailed(true) };
}
