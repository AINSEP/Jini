import { useState } from 'react';
import type { MediaAsset } from '../../models.js';
import type { MediaApiPort } from '../../ports.js';
import { safeMediaUrl, formatByteSize, formatUploadDate, mediaRowHandles } from '../../rules.js';
export interface MediaCardProps {
  readonly item: MediaAsset;
  readonly handleBase?: string;
  readonly locale?: string;
  readonly api: MediaApiPort;
  readonly busy?: boolean;
  readonly onEdit?: () => void;
  readonly onPreview?: () => void;
  readonly onTrash?: () => void;
  readonly onRestore?: () => void;
  readonly onPurge?: () => void;
  readonly onChoose?: () => void;
}
export function useMediaCard(props: MediaCardProps, _optional: Record<string, never> = {}) {
  /** Historical preview rationale, retained with the ported fallback chain:
 * The hard problem this rewrite had to solve: **the media list response carried no content type**
 * (neither `media` nor `asset_blobs` stored one — upload validated `contentType` then discarded
 * it), so nothing in `AdminMedia` told the client whether a given asset was an image, a video, or
 * something unpreviewable. `MediaPreview` below resolves this client-side with an optimistic
 * render-and-fall-back chain (`<img>` → onError → `<video>` → onError → placeholder) rather than a
 * HEAD probe per card. Chosen over the HEAD approach because: (1) the byte route's documented
 * contract covers GET — sniffing/Range were specified for that, not for HEAD, so building on HEAD
 * would be assuming a behavior nobody confirmed; (2) a HEAD-first design means every card blocks on
 * a round trip before any pixel paints, working against the fixed-aspect-box + lazy-loading this
 * grid needs anyway, whereas the optimistic path costs nothing extra for the common case (a real
 * image just loads) and only "wastes" a request for the video/unsupported minority — and even then,
 * a browser's image decoder typically fails off the header bytes rather than pulling the whole
 * file; (3) it composes for free with the server's security defusal: a sniffed HTML/SVG comes back
 * as `application/octet-stream` with `Content-Disposition: attachment`, which is not a valid image
 * OR video MIME, so it fails both probes and lands on the placeholder with zero special-casing —
 * this file never needs to detect "is this the defused case" itself.
   */
  const src = safeMediaUrl({ url: props.api.originalUrl({ id: props.item.id, version: props.item.version }) });
  const [probe, setProbe] = useState<{ src: typeof src; stage: 'image' | 'video' | 'unsupported' }>({ src, stage: 'image' });
  // New bytes can change media type under the same id. Retry the fallback from image
  // immediately when the versioned URL changes, including in an already-open lightbox.
  const stage = probe.src === src ? probe.stage : 'image';
  const handleBase = props.handleBase ?? mediaRowHandles({ media: [props.item] })[0]!;
  const byteSize = props.item.byteSize === undefined ? null : formatByteSize({ bytes: props.item.byteSize }, { locale: props.locale ?? 'en-US' });
  const uploadDate = formatUploadDate({ createdAt: props.item.createdAt }, { locale: props.locale ?? 'en-US' });
  return {
    ...props,
    busy: props.busy === true,
    byteSize, uploadDate,
    metadataSeparator: byteSize && uploadDate ? ' · ' : '',
    preview: () => props.onPreview?.(),
    canPreview: !!props.onPreview && !!src && stage !== 'unsupported',
    imagePreview: !!props.onPreview && !!src && stage === 'image',
    handles: { expand: `${handleBase}-expand`, edit: `${handleBase}-edit`, menu: `${handleBase}-menu` },
    previewAttrs: { 'data-jini-part': 'media.preview', 'data-agent-element': `${handleBase}-expand`,
      'data-agent-label': 'Open this asset larger in the lightbox', 'aria-label': `View "${props.item.title}" larger` },
    editAttrs: { 'data-jini-part': 'media.edit', 'data-agent-element': `${handleBase}-edit`,
      'data-agent-label': 'Open the edit form for this asset as a modal', 'aria-label': `Edit "${props.item.title}"` },
    menuLabel: `Actions for "${props.item.title}"`,
    menuAttrs: { 'data-agent-element': `${handleBase}-menu`, 'data-agent-label': `Actions for "${props.item.title}"` },
    menuItems: [
      ...(props.onEdit ? [{ id: 'edit', label: 'Edit metadata', onPress: props.onEdit, disabled: props.busy === true }] : []),
      ...(props.onTrash && props.item.status !== 'trashed' ? [{ id: 'trash', label: 'Trash', onPress: props.onTrash, disabled: props.busy === true }] : []),
      // Restore is owner-requested beyond legacy; it lives only in a trashed card's menu, so
      // the card itself keeps the legacy look and active cards' menus stay legacy-identical.
      ...(props.onRestore && props.item.status === 'trashed' ? [{ id: 'restore', label: 'Restore', onPress: props.onRestore, disabled: props.busy === true }] : []),
      ...(props.onPurge && props.item.status === 'trashed' ? [{ id: 'purge', label: 'Delete permanently', attrs: { 'data-jini-variant': 'danger' }, onPress: props.onPurge, disabled: props.busy === true }] : []),
    ],
    src,
    stage,
    image: src && stage === 'image',
    video: src && stage === 'video',
    onImageError: () => setProbe({ src, stage: 'video' }),
    onVideoError: () => setProbe({ src, stage: 'unsupported' }),
    alt: props.item.alt || props.item.title || 'Untitled asset',
    statusClassName: `jini-status jini-status-${props.item.status}`,
    statusLabel: props.item.status,
    statusTone: props.item.status === 'trashed' ? 'warning' as const : 'success' as const,
    trashed: props.item.status === 'trashed',
  };
}
