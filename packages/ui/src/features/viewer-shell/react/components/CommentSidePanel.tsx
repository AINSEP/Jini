import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { RemixIcon } from '../../../../react/components/RemixIcon.js';
import { useCommentReorder, type UseCommentReorderResult } from '../hooks/useCommentReorder.js';
import { relativeCommentTimeTranslation, visibleSelectedCommentIds } from '../../rules.js';
import type { CommentSideDragState, ViewerCommentAttachment, ViewerCommentBase } from '../../types.js';

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
  const commentsLabel = t('Comments');
  const panelId = useId();
  const formatTs = useCommentTimestampFormatter(formatTimestamp);
  const { collapsedRailRef, expandedToggleRef, handleCollapsedChange } = useCollapseToggleFocus({
    collapsed,
    onCollapsedChange,
  });

  if (collapsed) {
    return (
      <CommentSideRail
        railRef={collapsedRailRef}
        commentsLabel={commentsLabel}
        commentCount={comments.length}
        onExpand={() => handleCollapsedChange(false, 'expanded')}
      />
    );
  }

  return (
    <aside id={panelId} className="comment-side-panel" data-testid="comment-side-panel" aria-label={commentsLabel}>
      <CommentSideHeader
        toggleRef={expandedToggleRef}
        panelId={panelId}
        commentsLabel={commentsLabel}
        commentCount={comments.length}
        selectedCount={selectedCount}
        onSelectAll={onSelectAll}
        onCollapse={() => handleCollapsedChange(true, 'collapsed')}
      />
      <div className="comment-side-list" onDragLeave={reorder.onDragLeaveContainer}>
        {comments.length === 0 ? (
          <div className="comment-side-empty">{t('No comments yet')}</div>
        ) : (
          comments.map((comment, index) => (
            <CommentSideItem
              key={comment.id}
              comment={comment}
              index={index}
              selected={visibleSelectedIds.has(comment.id)}
              active={comment.id === activeCommentId}
              reorder={reorder}
              onReply={onReply}
              onToggleSelect={onToggleSelect}
              getCommentLabel={getCommentLabel}
              getCommentTimestamp={getCommentTimestamp}
              getCommentBody={getCommentBody}
              getCommentAttachments={getCommentAttachments}
              resolveAttachmentUrl={resolveAttachmentUrl}
              formatTs={formatTs}
            />
          ))
        )}
      </div>
      <CommentSideSelectBar
        selectedCount={selectedCount}
        sending={sending}
        sendDisabled={sendDisabled}
        queueOnSend={queueOnSend}
        onClearSelection={onClearSelection}
        onSendSelected={onSendSelected}
      />
      {composer ? <div className="comment-side-composer">{composer}</div> : null}
      <CommentSideCreateForm
        renderCreateForm={renderCreateForm}
        draft={newCommentDraft}
        onDraftChange={setNewCommentDraft}
        onCreateComment={onCreateComment}
        sending={sending}
        sendDisabled={sendDisabled}
      />
    </aside>
  );
}

type ToggleFocusTarget = 'collapsed' | 'expanded';

/** Moves focus onto whichever collapse/expand control replaced the one the
 *  user just clicked, once the `collapsed` change has re-rendered. */
function useCollapseToggleFocus({
  collapsed,
  onCollapsedChange,
}: {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const collapsedRailRef = useRef<HTMLButtonElement | null>(null);
  const expandedToggleRef = useRef<HTMLButtonElement | null>(null);
  const pendingToggleFocusRef = useRef<ToggleFocusTarget | null>(null);

  useEffect(() => {
    const targets = { collapsed: collapsedRailRef.current, expanded: expandedToggleRef.current };
    const pending = pendingToggleFocusRef.current;
    const target = pending ? targets[pending] : null;
    if (!target) return;
    pendingToggleFocusRef.current = null;
    target.focus();
  }, [collapsed]);

  function handleCollapsedChange(nextCollapsed: boolean, nextFocusTarget: ToggleFocusTarget) {
    pendingToggleFocusRef.current = nextFocusTarget;
    onCollapsedChange(nextCollapsed);
  }

  return { collapsedRailRef, expandedToggleRef, handleCollapsedChange };
}

function useCommentTimestampFormatter(formatTimestamp: ((timestampMs: number) => string) | undefined) {
  const t = useT();
  return (
    formatTimestamp ??
    ((ts: number) => {
      const translation = relativeCommentTimeTranslation(ts);
      return t(translation.key, translation.vars);
    })
  );
}

function CommentSideRail({
  railRef,
  commentsLabel,
  commentCount,
  onExpand,
}: {
  railRef: RefObject<HTMLButtonElement | null>;
  commentsLabel: string;
  commentCount: number;
  onExpand: () => void;
}) {
  const t = useT();
  const showLabel = t('Show {label}', { label: commentsLabel });
  return (
    <button
      ref={railRef}
      type="button"
      className="comment-side-rail"
      data-testid="comment-side-collapsed-rail"
      aria-label={showLabel}
      aria-expanded={false}
      title={showLabel}
      onClick={onExpand}
    >
      <RemixIcon name="message-3-line" size={15} />
      <span>{commentsLabel}</span>
      {commentCount > 0 ? <strong>{commentCount}</strong> : null}
    </button>
  );
}

function CommentSideHeader({
  toggleRef,
  panelId,
  commentsLabel,
  commentCount,
  selectedCount,
  onSelectAll,
  onCollapse,
}: {
  toggleRef: RefObject<HTMLButtonElement | null>;
  panelId: string;
  commentsLabel: string;
  commentCount: number;
  selectedCount: number;
  onSelectAll: () => void;
  onCollapse: () => void;
}) {
  const t = useT();
  const hideLabel = t('Hide {label}', { label: commentsLabel });
  const allSelected = commentCount > 0 && selectedCount === commentCount;
  return (
    <div className="comment-side-header">
      <div className="comment-side-title">
        <RemixIcon name="message-3-line" size={15} />
        <span>{commentsLabel}</span>
      </div>
      <div className="comment-side-header-actions">
        {commentCount > 0 ? (
          <button type="button" className="comment-side-select-all" disabled={allSelected} onClick={onSelectAll}>
            {t('Select all')}
          </button>
        ) : null}
        <button
          ref={toggleRef}
          type="button"
          className="comment-side-collapse"
          aria-label={hideLabel}
          aria-controls={panelId}
          aria-expanded={true}
          title={hideLabel}
          onClick={onCollapse}
        >
          <Icon name="chevron-right" size={14} />
        </button>
      </div>
    </div>
  );
}

/** ` comment-side-item-drop-<edge>` while another comment is dragged over
 *  `commentId` with a known edge, else `''`. */
function dropEdgeClassName(dragState: CommentSideDragState | null, commentId: string): string {
  const showsDropEdge = dragState?.overId === commentId && dragState.draggingId !== commentId && dragState.edge;
  return showsDropEdge ? ` comment-side-item-drop-${dragState.edge}` : '';
}

function commentItemClassName({
  selected,
  active,
  isDragging,
  dropClass,
}: {
  selected: boolean;
  active: boolean;
  isDragging: boolean;
  dropClass: string;
}): string {
  return `comment-side-item${selected ? ' selected' : ''}${active ? ' active' : ''}${isDragging ? ' dragging' : ''}${dropClass}`;
}

function CommentSideItem<TComment extends ViewerCommentBase>({
  comment,
  index,
  selected,
  active,
  reorder,
  onReply,
  onToggleSelect,
  getCommentLabel,
  getCommentTimestamp,
  getCommentBody,
  getCommentAttachments,
  resolveAttachmentUrl,
  formatTs,
}: {
  comment: TComment;
  index: number;
  selected: boolean;
  active: boolean;
  reorder: UseCommentReorderResult;
  onReply: (comment: TComment) => void;
  onToggleSelect: (commentId: string) => void;
  getCommentLabel: (comment: TComment, index: number) => string;
  getCommentTimestamp: (comment: TComment) => number;
  getCommentBody: (comment: TComment) => ReactNode;
  getCommentAttachments: ((comment: TComment) => ViewerCommentAttachment[]) | undefined;
  resolveAttachmentUrl: ((attachment: ViewerCommentAttachment) => string) | undefined;
  formatTs: (timestampMs: number) => string;
}) {
  const t = useT();
  const className = commentItemClassName({
    selected,
    active,
    isDragging: reorder.dragState?.draggingId === comment.id,
    dropClass: dropEdgeClassName(reorder.dragState, comment.id),
  });
  const attachments = getCommentAttachments?.(comment) ?? [];
  const dragLabel = t('Drag to reorder');
  return (
    <div
      className={className}
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
          title={dragLabel}
          aria-label={dragLabel}
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
        <CommentSideAttachments attachments={attachments} resolveAttachmentUrl={resolveAttachmentUrl} />
      ) : null}
    </div>
  );
}

function CommentSideAttachments({
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

function CommentSideSelectBar({
  selectedCount,
  sending,
  sendDisabled,
  queueOnSend,
  onClearSelection,
  onSendSelected,
}: {
  selectedCount: number;
  sending: boolean;
  sendDisabled: boolean;
  queueOnSend: boolean;
  onClearSelection: () => void;
  onSendSelected: () => void | Promise<void>;
}) {
  const t = useT();
  if (selectedCount === 0) return null;
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
        {sending ? t('Sending…') : queueOnSend ? t('Queue') : t('Send to chat')}
      </button>
    </div>
  );
}

function CommentSideCreateForm({
  renderCreateForm,
  draft,
  onDraftChange,
  onCreateComment,
  sending,
  sendDisabled,
}: {
  renderCreateForm: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
  onCreateComment: ((note: string) => boolean | Promise<boolean>) | undefined;
  sending: boolean;
  sendDisabled: boolean;
}) {
  const t = useT();
  if (!renderCreateForm || !onCreateComment) return null;
  // Bind the narrowed callback: TypeScript drops the narrowing inside the
  // nested async `submitNewComment` closure below.
  const createComment = onCreateComment;
  const canCreateComment = draft.trim().length > 0 && !sending && !sendDisabled;
  const addLabel = t('Add a comment…');

  async function submitNewComment() {
    if (!draft.trim()) return;
    const saved = await createComment(draft.trim());
    if (saved) onDraftChange('');
  }

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
