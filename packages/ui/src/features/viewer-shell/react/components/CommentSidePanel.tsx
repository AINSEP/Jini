import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { RemixIcon } from '../../../../react/components/RemixIcon.js';
import { useCommentReorder, type UseCommentReorderResult } from '../hooks/useCommentReorder.js';
import { relativeCommentTimeTranslation, visibleSelectedCommentIds } from '../../rules.js';
import type { CommentSideDragState, ViewerCommentAttachment, ViewerCommentBase } from '../../types.js';
import { CommentSideAttachments, CommentSideCreateForm, CommentSideSelectBar } from './CommentSideParts.js';

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
   * baked in. See `070311a07^:packages/ui/source-map.md` (section "features/viewer-shell/") for the full discrepancy
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
  useTHook?: typeof useT;
  useCommentTimestampFormatterHook?: typeof useCommentTimestampFormatter;
  useCollapseToggleFocusHook?: typeof useCollapseToggleFocus;
}

/**
 * A collapsible comment side-panel: a rail button when collapsed, a full
 * list (with drag-to-reorder, multi-select, and an optional inline composer)
 * when expanded. Already prop-abstracted in the source component; the one
 * real gap found on a full read (not called out by the recon doc that named
 * this extraction) is that the comment-label and timestamp derivation are
 * OD-specific logic, not just an OD-specific *type* — see
 * `getCommentLabel`/`getCommentTimestamp` above and
 * `070311a07^:packages/ui/source-map.md` (section "features/viewer-shell/").
 */
export function CommentSidePanel<TComment extends ViewerCommentBase>({
  useCommentReorder: useCommentReorderHook = useCommentReorder,
  useTHook = useT,
  useCommentTimestampFormatterHook = useCommentTimestampFormatter,
  useCollapseToggleFocusHook = useCollapseToggleFocus,
  ...props
}: CommentSidePanelProps<TComment>) {
  const { comments, selectedIds, collapsed, onCollapsedChange, onReorder } = props;
  const t = useTHook();
  const [newCommentDraft, setNewCommentDraft] = useState('');
  const reorder = useCommentReorderHook(comments.map((comment) => comment.id), onReorder);
  const visibleSelectedIds = visibleSelectedCommentIds({ comments, selectedIds });
  const commentsLabel = t('Comments');
  const panelId = useId();
  const formatTs = useCommentTimestampFormatterHook(props.formatTimestamp);
  const { collapsedRailRef, expandedToggleRef, handleCollapsedChange } = useCollapseToggleFocusHook({
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
    <CommentSideExpanded
      {...props}
      panelId={panelId}
      toggleRef={expandedToggleRef}
      commentsLabel={commentsLabel}
      reorder={reorder}
      visibleSelectedIds={visibleSelectedIds}
      formatTs={formatTs}
      newCommentDraft={newCommentDraft}
      onNewCommentDraftChange={setNewCommentDraft}
      onCollapse={() => handleCollapsedChange(true, 'collapsed')}
    />
  );
}

type CommentSideExpandedProps<TComment extends ViewerCommentBase> = CommentSideListProps<TComment> & {
  panelId: string;
  toggleRef: RefObject<HTMLButtonElement | null>;
  commentsLabel: string;
  newCommentDraft: string;
  onNewCommentDraftChange: (draft: string) => void;
  onCollapse: () => void;
};

function CommentSideExpanded<TComment extends ViewerCommentBase>(props: CommentSideExpandedProps<TComment>) {
  const { comments, sending, queueOnSend = false, sendDisabled = false, renderCreateForm = true } = props;
  const selectedCount = props.visibleSelectedIds.size;
  return (
    <aside id={props.panelId} className="jini-comment-side-panel" data-testid="comment-side-panel" aria-label={props.commentsLabel}>
      <CommentSideHeader
        toggleRef={props.toggleRef}
        panelId={props.panelId}
        commentsLabel={props.commentsLabel}
        commentCount={comments.length}
        selectedCount={selectedCount}
        onSelectAll={props.onSelectAll}
        onCollapse={props.onCollapse}
      />
      <CommentSideList {...props} />
      <CommentSideSelectBar
        selectedCount={selectedCount}
        sending={sending}
        sendDisabled={sendDisabled}
        queueOnSend={queueOnSend}
        onClearSelection={props.onClearSelection}
        onSendSelected={props.onSendSelected}
      />
      {props.composer ? <div className="jini-comment-side-composer">{props.composer}</div> : null}
      <CommentSideCreateForm
        renderCreateForm={renderCreateForm}
        draft={props.newCommentDraft}
        onDraftChange={props.onNewCommentDraftChange}
        onCreateComment={props.onCreateComment}
        sending={sending}
        sendDisabled={sendDisabled}
      />
    </aside>
  );
}

type CommentSideListProps<TComment extends ViewerCommentBase> = CommentSidePanelProps<TComment> & {
  reorder: UseCommentReorderResult;
  visibleSelectedIds: ReadonlySet<string>;
  formatTs: (timestampMs: number) => string;
};

function CommentSideList<TComment extends ViewerCommentBase>({ useTHook = useT, ...props }: CommentSideListProps<TComment> & { useTHook?: typeof useT }) {
  const t = useTHook();
  const { comments, reorder, visibleSelectedIds, activeCommentId, formatTs } = props;
  return (
    <div className="jini-comment-side-list" onDragLeave={reorder.onDragLeaveContainer}>
      {comments.length === 0 ? (
        <div className="jini-comment-side-empty">{t('No comments yet')}</div>
      ) : (
        comments.map((comment, index) => (
          <CommentSideItem
            key={comment.id}
            comment={comment}
            index={index}
            selected={visibleSelectedIds.has(comment.id)}
            active={comment.id === activeCommentId}
            reorder={reorder}
            onReply={props.onReply}
            onToggleSelect={props.onToggleSelect}
            getCommentLabel={props.getCommentLabel}
            getCommentTimestamp={props.getCommentTimestamp}
            getCommentBody={props.getCommentBody}
            getCommentAttachments={props.getCommentAttachments}
            resolveAttachmentUrl={props.resolveAttachmentUrl}
            formatTs={formatTs}
          />
        ))
      )}
    </div>
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
      const translation = relativeCommentTimeTranslation({ timestampMs: ts });
      return t(translation.key, translation.vars);
    })
  );
}

function CommentSideRail({
  railRef,
  commentsLabel,
  commentCount,
  onExpand,
  useTHook = useT,
}: {
  railRef: RefObject<HTMLButtonElement | null>;
  commentsLabel: string;
  commentCount: number;
  onExpand: () => void;
  useTHook?: typeof useT;
}) {
  const t = useTHook();
  const showLabel = t('Show {label}', { label: commentsLabel });
  return (
    <button
      ref={railRef}
      type="button"
      className="jini-comment-side-rail"
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
  useTHook = useT,
}: {
  toggleRef: RefObject<HTMLButtonElement | null>;
  panelId: string;
  commentsLabel: string;
  commentCount: number;
  selectedCount: number;
  onSelectAll: () => void;
  onCollapse: () => void;
  useTHook?: typeof useT;
}) {
  const t = useTHook();
  const hideLabel = t('Hide {label}', { label: commentsLabel });
  const allSelected = commentCount > 0 && selectedCount === commentCount;
  return (
    <div className="jini-comment-side-header">
      <div className="jini-comment-side-title">
        <RemixIcon name="message-3-line" size={15} />
        <span>{commentsLabel}</span>
      </div>
      <div className="jini-comment-side-header-actions">
        {commentCount > 0 ? (
          <button type="button" className="jini-comment-side-select-all" disabled={allSelected} onClick={onSelectAll}>
            {t('Select all')}
          </button>
        ) : null}
        <button
          ref={toggleRef}
          type="button"
          className="jini-comment-side-collapse"
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

function CommentSideCheck({ selected, onToggle, useTHook = useT }: { selected: boolean; onToggle: () => void; useTHook?: typeof useT; }) {
  const t = useTHook();
  return (
    <button
      type="button"
      className={`comment-side-check${selected ? ' checked' : ''}`}
      aria-label={selected ? t('Deselect') : t('Select')}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {selected ? <Icon name="check" size={11} /> : null}
    </button>
  );
}

function CommentSideItemHead<TComment extends ViewerCommentBase>({
  comment,
  index,
  selected,
  reorder,
  label,
  timeLabel,
  onToggleSelect,
  useTHook = useT,
}: {
  comment: TComment;
  index: number;
  selected: boolean;
  reorder: UseCommentReorderResult;
  label: string;
  timeLabel: string;
  onToggleSelect: (commentId: string) => void;
  useTHook?: typeof useT;
}) {
  const dragLabel = useTHook()('Drag to reorder');
  return (
    <div className="jini-comment-side-item-head">
      <button
        type="button"
        className="jini-comment-side-drag-handle"
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
      <span className="jini-comment-side-author">
        <strong>{`${index + 1}. ${label}`}</strong>
      </span>
      <span className="jini-comment-side-time">{timeLabel}</span>
      <CommentSideCheck selected={selected} onToggle={() => onToggleSelect(comment.id)} />
    </div>
  );
}

type CommentSideItemProps<TComment extends ViewerCommentBase> = {
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
};

function CommentSideItem<TComment extends ViewerCommentBase>(props: CommentSideItemProps<TComment>) {
  const { comment, index, selected, active, reorder, onReply, resolveAttachmentUrl } = props;
  const className = commentItemClassName({
    selected,
    active,
    isDragging: reorder.dragState?.draggingId === comment.id,
    dropClass: dropEdgeClassName(reorder.dragState, comment.id),
  });
  const attachments = props.getCommentAttachments?.(comment) ?? [];
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
      <CommentSideItemHead
        comment={comment}
        index={index}
        selected={selected}
        reorder={reorder}
        label={props.getCommentLabel(comment, index)}
        timeLabel={props.formatTs(props.getCommentTimestamp(comment))}
        onToggleSelect={props.onToggleSelect}
      />
      <div className="jini-comment-side-body">{props.getCommentBody(comment)}</div>
      {resolveAttachmentUrl && attachments.length > 0 ? (
        <CommentSideAttachments attachments={attachments} resolveAttachmentUrl={resolveAttachmentUrl} />
      ) : null}
    </div>
  );
}
