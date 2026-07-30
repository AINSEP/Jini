import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { RemixIcon } from '../../../../react/components/RemixIcon.js';
import { useCommentReorder } from '../hooks/useCommentReorder.js';
import { relativeCommentTimeTranslation, visibleSelectedCommentIds } from '../../rules.js';
import type { ViewerCommentAttachment, ViewerCommentBase } from '../../types.js';

export interface CommentSidePanelProps<TComment extends ViewerCommentBase> {
  comments: TComment[];
  selectedIds: ReadonlySet<string>;
  activeCommentId: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onToggleSelect: (commentId: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onReorder?: (orderedIds: string[]) => void;
  onReply: (comment: TComment) => void;
  onSendSelected: () => void | Promise<void>;
  onCreateComment?: (note: string) => boolean | Promise<boolean>;
  sending: boolean;
  queueOnSend?: boolean;
  sendDisabled?: boolean;
  renderCreateForm?: boolean;
  composer?: ReactNode;

  /**
   * A one-line display label for `comment` (e.g. "1. Button", "Page
   * comment"). The source component derived this from OD-specific
   * `elementId`/`label`/`htmlHint` conventions (regex-matching HTML tag
   * names embedded in a board-annotation payload) — that heuristic is not
   * generic, so it's a required host-supplied function here rather than
   * baked in. See `packages/ui/source-map.md` for the full discrepancy
   * writeup.
   */
  getCommentLabel: (comment: TComment, index: number) => string;
  /** Epoch-millis "last activity" timestamp for sorting/display. */
  getCommentTimestamp: (comment: TComment) => number;
  /** The comment's own body content. */
  getCommentBody: (comment: TComment) => ReactNode;
  /** Attachments for a comment, if any (defaults to none). */
  getCommentAttachments?: (comment: TComment) => ViewerCommentAttachment[];
  /** Resolves an attachment to a final URL. The source component built this
   *  from `projectRawUrl(projectId, attachment.path)` — host-specific, so
   *  it's an injected resolver here. Omit to skip attachment rendering
   *  entirely. */
  resolveAttachmentUrl?: (attachment: ViewerCommentAttachment) => string;
  /** Overrides the default relative-time formatter
   *  (`relativeCommentTimeTranslation` + `t()`). */
  formatTimestamp?: (timestampMs: number) => string;
  /** Custom hook override for dependency injection / testing. */
  useCommentReorder?: typeof useCommentReorder;
}

/**
 * A collapsible comment side-panel: a rail button when collapsed, a full
 * list (with drag-to-reorder, multi-select, and an optional inline composer)
 * when expanded. Already prop-abstracted in the source component; the one
 * real gap found on a full read (not called out by the recon doc that named
 * this extraction) is that the comment-label and timestamp derivation are
 * OD-specific logic, not just an OD-specific *type* — see
 * `getCommentLabel`/`getCommentTimestamp` above and
 * `packages/ui/source-map.md`.
 */
export function CommentSidePanel<TComment extends ViewerCommentBase>({
  comments,
  selectedIds,
  activeCommentId,
  collapsed,
  onCollapsedChange,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onReorder,
  onReply,
  onSendSelected,
  onCreateComment,
  sending,
  queueOnSend = false,
  sendDisabled = false,
  renderCreateForm = true,
  composer,
  getCommentLabel,
  getCommentTimestamp,
  getCommentBody,
  getCommentAttachments,
  resolveAttachmentUrl,
  formatTimestamp,
  useCommentReorder: useCommentReorderHook = useCommentReorder,
}: CommentSidePanelProps<TComment>) {
  const t = useT();
  const [newCommentDraft, setNewCommentDraft] = useState('');
  const orderedIds = comments.map((comment) => comment.id);
  const reorder = useCommentReorderHook(orderedIds, onReorder);
  const visibleSelectedIds = visibleSelectedCommentIds(comments, selectedIds);
  const selectedCount = visibleSelectedIds.size;
  const allSelected = comments.length > 0 && selectedCount === comments.length;
  const commentsLabel = t('Comments');
  const canCreateComment = Boolean(onCreateComment) && newCommentDraft.trim().length > 0 && !sending && !sendDisabled;
  const collapsedRailRef = useRef<HTMLButtonElement | null>(null);
  const expandedToggleRef = useRef<HTMLButtonElement | null>(null);
  const pendingToggleFocusRef = useRef<'collapsed' | 'expanded' | null>(null);
  const panelId = useId();

  const formatTs = formatTimestamp ?? ((ts: number) => {
    const translation = relativeCommentTimeTranslation(ts);
    return t(translation.key, translation.vars);
  });

  async function submitNewComment() {
    if (!onCreateComment || !newCommentDraft.trim()) return;
    const saved = await onCreateComment(newCommentDraft.trim());
    if (saved) setNewCommentDraft('');
  }

  useEffect(() => {
    const target =
      pendingToggleFocusRef.current === 'collapsed'
        ? collapsedRailRef.current
        : pendingToggleFocusRef.current === 'expanded'
          ? expandedToggleRef.current
          : null;
    if (!target) return;
    pendingToggleFocusRef.current = null;
    target.focus();
  }, [collapsed]);

  function handleCollapsedChange(nextCollapsed: boolean, nextFocusTarget: 'collapsed' | 'expanded') {
    pendingToggleFocusRef.current = nextFocusTarget;
    onCollapsedChange(nextCollapsed);
  }

  if (collapsed) {
    return (
      <button
        ref={collapsedRailRef}
        type="button"
        className="comment-side-rail"
        data-testid="comment-side-collapsed-rail"
        aria-label={t('Show {label}', { label: commentsLabel })}
        aria-expanded={false}
        title={t('Show {label}', { label: commentsLabel })}
        onClick={() => handleCollapsedChange(false, 'expanded')}
      >
        <RemixIcon name="message-3-line" size={15} />
        <span>{commentsLabel}</span>
        {comments.length > 0 ? <strong>{comments.length}</strong> : null}
      </button>
    );
  }

  return (
    <aside id={panelId} className="comment-side-panel" data-testid="comment-side-panel" aria-label={commentsLabel}>
      <div className="comment-side-header">
        <div className="comment-side-title">
          <RemixIcon name="message-3-line" size={15} />
          <span>{commentsLabel}</span>
        </div>
        <div className="comment-side-header-actions">
          {comments.length > 0 ? (
            <button type="button" className="comment-side-select-all" disabled={allSelected} onClick={onSelectAll}>
              {t('Select all')}
            </button>
          ) : null}
          <button
            ref={expandedToggleRef}
            type="button"
            className="comment-side-collapse"
            aria-label={t('Hide {label}', { label: commentsLabel })}
            aria-controls={panelId}
            aria-expanded={true}
            title={t('Hide {label}', { label: commentsLabel })}
            onClick={() => handleCollapsedChange(true, 'collapsed')}
          >
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
      </div>
      <div className="comment-side-list" onDragLeave={reorder.onDragLeaveContainer}>
        {comments.length === 0 ? (
          <div className="comment-side-empty">{t('No comments yet')}</div>
        ) : (
          comments.map((comment, index) => {
            const selected = visibleSelectedIds.has(comment.id);
            const active = comment.id === activeCommentId;
            const isDragging = reorder.dragState?.draggingId === comment.id;
            const dropClass =
              reorder.dragState?.overId === comment.id && reorder.dragState.draggingId !== comment.id && reorder.dragState.edge
                ? ` comment-side-item-drop-${reorder.dragState.edge}`
                : '';
            const attachments = getCommentAttachments?.(comment) ?? [];
            return (
              <div
                key={comment.id}
                className={`comment-side-item${selected ? ' selected' : ''}${active ? ' active' : ''}${isDragging ? ' dragging' : ''}${dropClass}`}
                data-testid="comment-side-item"
                data-comment-id={comment.id}
                aria-current={active ? 'true' : undefined}
                role="button"
                tabIndex={0}
                onDragOver={(event) => reorder.onDragOver(event, comment.id)}
                onDrop={(event) => reorder.onDrop(event, comment.id)}
                onClick={() => onReply(comment)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onReply(comment);
                }}
              >
                <div className="comment-side-item-head">
                  <button
                    type="button"
                    className="comment-side-drag-handle"
                    title={t('Drag to reorder')}
                    aria-label={t('Drag to reorder')}
                    draggable={reorder.canReorder}
                    disabled={!reorder.canReorder}
                    onClick={(event) => event.stopPropagation()}
                    onDragStart={(event) => reorder.onDragStart(event, comment.id)}
                    onDragEnd={reorder.clear}
                  >
                    <Icon name="grip-vertical" size={13} />
                  </button>
                  <span className="comment-side-author">
                    <strong>{`${index + 1}. ${getCommentLabel(comment, index)}`}</strong>
                  </span>
                  <span className="comment-side-time">{formatTs(getCommentTimestamp(comment))}</span>
                  <button
                    type="button"
                    className={`comment-side-check${selected ? ' checked' : ''}`}
                    aria-label={selected ? t('Deselect') : t('Select')}
                    aria-pressed={selected}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleSelect(comment.id);
                    }}
                  >
                    {selected ? <Icon name="check" size={11} /> : null}
                  </button>
                </div>
                <div className="comment-side-body">{getCommentBody(comment)}</div>
                {resolveAttachmentUrl && attachments.length > 0 ? (
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
                ) : null}
              </div>
            );
          })
        )}
      </div>
      {selectedCount > 0 ? (
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
            {sending ? t('Sending…') : queueOnSend ? t('Queue') : t('Send to chat')}
          </button>
        </div>
      ) : null}
      {composer ? <div className="comment-side-composer">{composer}</div> : null}
      {renderCreateForm && onCreateComment ? (
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
                  value={newCommentDraft}
                  placeholder={t('Add a comment…')}
                  aria-label={t('Add a comment…')}
                  onChange={(event) => setNewCommentDraft(event.target.value)}
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
      ) : null}
    </aside>
  );
}
