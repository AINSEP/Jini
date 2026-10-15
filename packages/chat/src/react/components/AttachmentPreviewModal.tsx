/**
 * @module AttachmentPreviewModal
 *
 * The "can we see it again" modal `MessageRow.tsx`'s attachment chip opens: an image scaled to fit,
 * a scrollable monospace pane for a text-ish file, or - honestly, never a faked preview - the
 * filename/type/size for anything else. All state/effects live in `useAttachmentPreviewModal`; this
 * is the presentational shell, native-`<dialog>`-based like `Markdown.tsx`'s `TableBlock` pop-out.
 * With `navigation` (more than one image in the message or the composer's staged set) a footer adds
 * previous/next side by side in the bottom-right corner, plus ←/→ on the dialog.
 */
import { useT } from '../hooks/context.js';
import { Icon } from './Icon.js';
import type { ChatAttachment } from '../../core/index.js';
import { looksLikeImageAttachment, useAttachmentPreviewModal } from './AttachmentPreviewModal.hooks.js';
import type { AttachmentPreviewNavigation } from './AttachmentGallery.hooks.js';

export interface AttachmentPreviewModalProps {
  attachment: ChatAttachment;
  onClose: () => void;
  /** Previous/next over the surrounding images; omitted for a lone attachment. */
  navigation?: AttachmentPreviewNavigation | undefined;
}

export function AttachmentPreviewModal({ attachment, onClose, navigation }: AttachmentPreviewModalProps) {
  const t = useT();
  const c = useAttachmentPreviewModal({ attachment: attachment, onClose: onClose, navigation });

  return (
    <dialog
      ref={c.dialogRef}
      className={`jini-attachment-preview-dialog${navigation ? ' has-nav' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('{name} preview', { name: attachment.name })}
      onCancel={c.handleNativeCancel}
      onClick={c.handleBackdropClick}
      onKeyDown={c.handleKeyDown}
    >
      <div className="jini-attachment-preview-header">
        <span className="jini-attachment-preview-name" title={attachment.name}>
          {attachment.name}
        </span>
        <button
          type="button"
          className="jini-attachment-preview-close"
          onClick={onClose}
          title={t('Close')}
          aria-label={t('Close')}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="jini-attachment-preview-body">
        {c.status === 'image' && c.imageUrl ? (
          <img
            src={c.imageUrl}
            alt={attachment.name}
            className="jini-attachment-preview-image"
            onError={c.onImageError}
          />
        ) : c.status === 'text' ? (
          c.textLoading ? (
            <div className="jini-attachment-preview-loading">{t('Loading…')}</div>
          ) : (
            <>
              <pre className="jini-attachment-preview-text">{c.text?.content ?? ''}</pre>
              {c.text?.truncated ? (
                <div className="jini-attachment-preview-truncated">
                  {t('Preview truncated — this file is larger than the preview limit.')}
                </div>
              ) : null}
            </>
          )
        ) : (
          <div className="jini-attachment-preview-meta">
            <div className="jini-attachment-preview-meta-row">
              <span className="jini-attachment-preview-meta-label">{t('Name')}</span>
              <span>{attachment.name}</span>
            </div>
            <div className="jini-attachment-preview-meta-row">
              <span className="jini-attachment-preview-meta-label">{t('Type')}</span>
              <span>{looksLikeImageAttachment({ attachment: attachment }) ? t('Image') : t('File')}</span>
            </div>
            {c.sizeLabel ? (
              <div className="jini-attachment-preview-meta-row">
                <span className="jini-attachment-preview-meta-label">{t('Size')}</span>
                <span>{c.sizeLabel}</span>
              </div>
            ) : null}
            <div className="jini-attachment-preview-meta-note">{t('A preview is not available for this file.')}</div>
          </div>
        )}
      </div>
      {navigation ? (
        <div className="jini-attachment-preview-nav">
          <span className="jini-attachment-preview-count" aria-live="polite">
            {t('{index} / {count}', { index: navigation.index + 1, count: navigation.count })}
          </span>
          <button
            type="button"
            className="jini-attachment-preview-step"
            onClick={navigation.onPrevious}
            title={t('Previous image')}
            aria-label={t('Previous image')}
          >
            <Icon name="chevron-left" size={18} />
          </button>
          <button
            type="button"
            className="jini-attachment-preview-step"
            onClick={navigation.onNext}
            title={t('Next image')}
            aria-label={t('Next image')}
          >
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      ) : null}
    </dialog>
  );
}
