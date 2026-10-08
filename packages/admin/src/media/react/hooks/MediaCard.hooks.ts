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
  /** Preview optimistically: image -> video -> placeholder. The list supplies no reliable media
   * kind, and the byte route guarantees GET rather than HEAD, so probing headers would assume an
   * unsupported contract and delay every card's first paint. Images load directly; failed decoders
   * usually stop at header bytes. Defused HTML/SVG served as octet-stream attachments fails both
   * decoders and reaches the placeholder without content-specific handling. */
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
      // Restore belongs only in a trashed card's menu; active cards have nothing to restore.
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
