import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import type { ViewerCommentAttachment } from '../../types.js';
import { createCommentSubmitter } from './CommentSidePanel.hooks.js';

/** @module CommentSideParts
 * The comment panel's leaf pieces (attachment thumbnails, the multi-select send bar, the inline
 * composer). Split out of `CommentSidePanel.tsx` to keep that file under the size limit; none of
 * them reads panel state, so they take everything as props.
 */

export function CommentSideAttachments({
  attachments,
  resolveAttachmentUrl,
}: {
  attachments: ViewerCommentAttachment[];
  resolveAttachmentUrl: (attachment: ViewerCommentAttachment) => string;
}) {
  return (
    <div className="comment-side-attachments">
      {attachments.map((attachment) => {
        const url = resolveAttachmentUrl(attachment);
        return (
          <a
            key={attachment.path}
            className="comment-side-attachment"
            data-testid="comment-side-attachment"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={attachment.name}
            title={attachment.name}
            onClick={(event) => event.stopPropagation()}
          >
            <img src={url} alt={attachment.name} />
          </a>
        );
      })}
    </div>
  );
}

export function CommentSideSelectBar({
  selectedCount,
  sending,
  sendDisabled,
  queueOnSend,
  onClearSelection,
  onSendSelected,
  useTHook = useT,
}: {
  selectedCount: number;
  sending: boolean;
  sendDisabled: boolean;
  queueOnSend: boolean;
  onClearSelection: () => void;
  onSendSelected: () => void | Promise<void>;
  useTHook?: typeof useT;
}) {
  const t = useTHook();
  if (selectedCount === 0) return null;
  const idleSendLabel = queueOnSend ? t('Queue') : t('Send to chat');
  return (
    <div className="comment-side-selectbar" data-testid="comment-side-selectbar">
      <span className="comment-side-selectcount">{t('{n} selected', { n: selectedCount })}</span>
      <button type="button" className="comment-side-clear" onClick={onClearSelection}>
        {t('Clear')}
      </button>
      <button
        type="button"
        className="comment-side-send"
        data-testid="comment-side-send-claude"
        disabled={sending || sendDisabled}
        onClick={() => void onSendSelected()}
      >
        {sending ? t('Sending…') : idleSendLabel}
      </button>
    </div>
  );
}

export function CommentSideCreateForm({
  renderCreateForm,
  draft,
  onDraftChange,
  onCreateComment,
  sending,
  sendDisabled,
  useTHook = useT,
}: {
  renderCreateForm: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
  onCreateComment: ((note: string) => boolean | Promise<boolean>) | undefined;
  sending: boolean;
  sendDisabled: boolean;
  useTHook?: typeof useT;
}) {
  const t = useTHook();
  if (!renderCreateForm || !onCreateComment) return null;
  // Bind the narrowed callback: TypeScript drops the narrowing inside the
  // nested async `submitNewComment` closure below.
  const createComment = onCreateComment;
  const canCreateComment = draft.trim().length > 0 && !sending && !sendDisabled;
  const addLabel = t('Add a comment…');

  const submitNewComment = createCommentSubmitter({ draft, onDraftChange, createComment });

  return (
    <form
      className="comment-side-new-comment composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submitNewComment();
      }}
    >
      <div className="composer-shell comment-side-new-comment-shell">
        <div className="composer-input-wrap">
          <div className="composer-textarea-layer">
            <textarea
              value={draft}
              placeholder={addLabel}
              aria-label={addLabel}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void submitNewComment();
                }
              }}
            />
          </div>
        </div>
        <div className="composer-row comment-side-new-comment-actions">
          <button type="button" className="icon-btn" title={t('Attach')} aria-label={t('Attach')} disabled>
            <Icon name="attach" size={15} />
          </button>
          <span className="composer-spacer" />
          <button type="submit" className={`composer-send${sending ? ' is-sending' : ''}`} disabled={!canCreateComment}>
            <Icon name="send" size={13} />
            <span>{sending ? t('Sending…') : t('Send')}</span>
          </button>
        </div>
      </div>
    </form>
  );
}
