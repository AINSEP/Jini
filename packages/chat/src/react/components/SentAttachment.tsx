import type { ReactNode } from 'react';
import type { ChatAttachment } from '../../core/index.js';
import { useT } from '../hooks/context.js';
import { useSentAttachmentThumbnail, type ObjectUrlPort } from './SentAttachment.hooks.js';

export interface SentAttachmentButtonProps {
  attachment: ChatAttachment;
  /** Opens the row's preview modal for this attachment. */
  onOpen: (attachment: ChatAttachment) => void;
  /** Host-supplied chip content; when given it wins over the built-in thumbnail/filename. */
  renderAttachment?: ((attachment: ChatAttachment) => ReactNode) | undefined;
  /** Blob-URL port for the thumbnail; defaults to the platform's (see `SentAttachment.hooks.ts`). */
  objectUrls?: ObjectUrlPort | undefined;
}

/**
 * One attachment on a sent user message: a small image thumbnail when this browser still holds the
 * image's bytes, otherwise the filename chip. Either way a click opens the preview modal, and the
 * accessible name stays "Open {name}".
 */
export function SentAttachmentButton({ attachment, onOpen, renderAttachment, objectUrls }: SentAttachmentButtonProps) {
  const t = useT();
  const { thumbnailUrl, onThumbnailError } = useSentAttachmentThumbnail(
    { attachment, hostRendered: renderAttachment !== undefined },
    objectUrls === undefined ? {} : { objectUrls },
  );
  return (
    <button
      type="button"
      className={`jini-message-attachment-chip${thumbnailUrl ? ' is-thumbnail' : ''}`}
      onClick={() => onOpen(attachment)}
      title={t('Open {name}', { name: attachment.name })}
      aria-label={t('Open {name}', { name: attachment.name })}
    >
      {renderAttachment ? (
        renderAttachment(attachment)
      ) : thumbnailUrl ? (
        <img className="jini-message-attachment-thumb" src={thumbnailUrl} alt="" onError={onThumbnailError} />
      ) : (
        attachment.name
      )}
    </button>
  );
}
