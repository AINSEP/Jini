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
type PreviewStage = 'image' | 'video' | 'unsupported';
interface MenuEntry { readonly id: string; readonly label: string; readonly onPress: (() => void) | undefined; readonly shown: boolean }
function menuItems({ props }: { props: MediaCardProps }, _optional: Record<string, never> = {}) {
  const disabled = props.busy === true, trashed = props.item.status === 'trashed';
  const entries: readonly MenuEntry[] = [
    { id: 'edit', label: 'Edit metadata', onPress: props.onEdit, shown: true },
    { id: 'trash', label: 'Trash', onPress: props.onTrash, shown: !trashed },
    // Restore belongs only in a trashed card's menu; active cards have nothing to restore.
    { id: 'restore', label: 'Restore', onPress: props.onRestore, shown: trashed },
    { id: 'purge', label: 'Delete permanently', onPress: props.onPurge, shown: trashed },
  ];
  return entries.flatMap(({ id, label, onPress, shown }) => onPress && shown
    ? [{ id, label, ...(id === 'purge' ? { attrs: { 'data-jini-variant': 'danger' } } : {}), onPress, disabled }]
    : []);
}
function metadata({ item }: { item: MediaAsset }, { locale = 'en-US' }: { locale?: string | undefined } = {}) {
  const byteSize = item.byteSize === undefined ? null : formatByteSize({ bytes: item.byteSize }, { locale });
  const uploadDate = formatUploadDate({ createdAt: item.createdAt }, { locale });
  return { byteSize, uploadDate, metadataSeparator: byteSize && uploadDate ? ' · ' : '' };
}
function previewFlags({ src, stage }: { src: string | undefined; stage: PreviewStage }, { onPreview }: { onPreview?: (() => void) | undefined } = {}) {
  const previewable = !!onPreview && !!src;
  return {
    canPreview: previewable && stage !== 'unsupported',
    imagePreview: previewable && stage === 'image',
    image: src && stage === 'image',
    video: src && stage === 'video',
  };
}
function statusView({ item }: { item: MediaAsset }, _optional: Record<string, never> = {}) {
  const trashed = item.status === 'trashed';
  return {
    statusClassName: `jini-status jini-status-${item.status}`,
    statusLabel: item.status,
    statusTone: trashed ? 'warning' as const : 'success' as const,
    trashed,
  };
}
function agentAttrs({ handleBase, title }: { handleBase: string; title: string }, _optional: Record<string, never> = {}) {
  return {
    handles: { expand: `${handleBase}-expand`, edit: `${handleBase}-edit`, menu: `${handleBase}-menu` },
    previewAttrs: { 'data-jini-part': 'media.preview', 'data-agent-element': `${handleBase}-expand`,
      'data-agent-label': 'Open this asset larger in the lightbox', 'aria-label': `View "${title}" larger` },
    editAttrs: { 'data-jini-part': 'media.edit', 'data-agent-element': `${handleBase}-edit`,
      'data-agent-label': 'Open the edit form for this asset as a modal', 'aria-label': `Edit "${title}"` },
    menuLabel: `Actions for "${title}"`,
    menuAttrs: { 'data-agent-element': `${handleBase}-menu`, 'data-agent-label': `Actions for "${title}"` },
  };
}
export function useMediaCard(props: MediaCardProps, _optional: Record<string, never> = {}) {
  /** Preview optimistically: image -> video -> placeholder. The list supplies no reliable media
   * kind, and the byte route guarantees GET rather than HEAD, so probing headers would assume an
   * unsupported contract and delay every card's first paint. Images load directly; failed decoders
   * usually stop at header bytes. Defused HTML/SVG served as octet-stream attachments fails both
   * decoders and reaches the placeholder without content-specific handling. */
  const src = safeMediaUrl({ url: props.api.originalUrl({ id: props.item.id, version: props.item.version }) });
  const [probe, setProbe] = useState<{ src: typeof src; stage: PreviewStage }>({ src, stage: 'image' });
  // New bytes can change media type under the same id. Retry the fallback from image
  // immediately when the versioned URL changes, including in an already-open lightbox.
  const stage = probe.src === src ? probe.stage : 'image';
  const handleBase = props.handleBase ?? mediaRowHandles({ media: [props.item] })[0]!;
  return {
    ...props,
    busy: props.busy === true,
    ...metadata({ item: props.item }, { locale: props.locale }),
    preview: () => props.onPreview?.(),
    ...previewFlags({ src, stage }, { onPreview: props.onPreview }),
    ...agentAttrs({ handleBase, title: props.item.title }),
    menuItems: menuItems({ props }),
    src,
    stage,
    onImageError: () => setProbe({ src, stage: 'video' }),
    onVideoError: () => setProbe({ src, stage: 'unsupported' }),
    alt: props.item.alt || props.item.title || 'Untitled asset',
    ...statusView({ item: props.item }),
  };
}
