/**
 * @module AttachmentTray
 *
 * Renders staged composer attachments as removable chips. A dumb,
 * props-in/JSX-out implementation of the `AttachmentTraySlot` shape from
 * `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §2 — a host can pass its own
 * `renderItem` for exotic attachment kinds (screenshots, Figma frames, ...)
 * and this component falls back to the built-in chip otherwise.
 *
 * The built-in chip shows a thumbnail for an image this browser staged (the same preview cache a
 * sent message's thumbnail reads) and opens the shared `AttachmentPreviewModal`, with previous/next
 * across the staged images - before sending, the operator can check which screenshots are going.
 */
import type { ChatAttachment } from '../../core/index.js';
import { useT } from '../hooks/context.js';
import { Icon } from './Icon.js';
import type { AttachmentTraySlot } from '../slots.js';
import { AttachmentPreviewModal } from './AttachmentPreviewModal.js';
import { useAttachmentGallery } from './AttachmentGallery.hooks.js';
import { isOpaqueAttachmentName } from './AttachmentGallery.rules.js';
import { useSentAttachmentThumbnail, type ObjectUrlPort } from './SentAttachment.hooks.js';
import { formatAttachmentSize } from './attachment-size.js';

// Re-exported: callers and tests have always imported it from here.
export { formatAttachmentSize };

export type AttachmentTrayProps = AttachmentTraySlot & {
  /** Blob-URL port for chip thumbnails; defaults to the platform's (see `SentAttachment.hooks.ts`). */
  objectUrls?: ObjectUrlPort | undefined;
};

export function AttachmentTray({ attachments, onRemove, renderItem, objectUrls }: AttachmentTrayProps) {
  const t = useT();
  const gallery = useAttachmentGallery({ attachments });
  if (attachments.length === 0) return null;
  return (
    <div className="jini-attachment-tray" data-testid="composer-attachment-tray">
      {attachments.map((a) => (
        <div
          key={a.path}
          className="jini-attachment-chip"
          data-testid="attachment-chip"
          data-attachment-kind={a.kind}
          data-attachment-name={a.name}
        >
          {renderItem ? renderItem(a) : <DefaultAttachmentChip attachment={a} onOpen={gallery.open} objectUrls={objectUrls} />}
          <button type="button" className="jini-attachment-remove" onClick={() => onRemove(a.path)} title={t('Remove {name}', { name: a.name })} aria-label={t('Remove {name}', { name: a.name })}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      {gallery.opened ? (
        <AttachmentPreviewModal attachment={gallery.opened} onClose={gallery.close} navigation={gallery.navigation} />
      ) : null}
    </div>
  );
}

function DefaultAttachmentChip({ attachment, onOpen, objectUrls }: {
  attachment: ChatAttachment;
  onOpen: (attachment: ChatAttachment) => void;
  objectUrls: ObjectUrlPort | undefined;
}) {
  const t = useT();
  const { thumbnailUrl, onThumbnailError } = useSentAttachmentThumbnail(
    { attachment },
    objectUrls === undefined ? {} : { objectUrls },
  );
  const size = formatAttachmentSize({ size: attachment.size });
  const label = thumbnailUrl && isOpaqueAttachmentName({ name: attachment.name }) ? t('Image') : attachment.name;
  return (
    <button
      type="button"
      className="jini-attachment-chip-body"
      onClick={() => onOpen(attachment)}
      title={t('Open {name}', { name: attachment.name })}
      aria-label={t('Open {name}', { name: attachment.name })}
    >
      {thumbnailUrl ? (
        <img className="jini-attachment-chip-thumb" src={thumbnailUrl} alt="" onError={onThumbnailError} />
      ) : (
        <span className={`jini-attachment-chip-icon is-${attachment.kind}`}>
          <Icon name={attachment.kind === 'image' ? 'image' : 'file'} size={15} />
        </span>
      )}
      <span className="jini-attachment-chip-copy">
        <span className="jini-attachment-chip-name">{label}</span>
        {size ? <small className="jini-attachment-chip-size">{size}</small> : null}
      </span>
    </button>
  );
}
