import type { Logger } from '@jini-ai/core/primitives';
/**
 * @module ConversationList
 *
 * The conversation switcher: new / select / delete / search / inline rename. Drop it
 * into `ChatPane`'s `leadingAccessory` slot — it needs no changes to `ChatPane` itself.
 *
 * Storage-agnostic by construction. It takes data and callbacks and owns nothing durable, so a
 * host backs it with `@jini-ai/chat/store/sqlite`'s `ChatHistoryStore`, an HTTP endpoint, or an in-memory
 * array without this file knowing the difference.
 *
 * Search is a **client-side filter by default**, and delegates to `onSearch` when a host provides
 * one. That default is not laziness: a host with no server search still gets a working filter,
 * and one whose list grows past a page swaps in a server query by passing a prop. The rule for
 * when to swap is concrete — a client filter over a *paginated* list silently searches only the
 * loaded page, so the moment a host paginates, it must provide `onSearch`.
 *
 * Rename has an explicit keyboard-accessible action as well as the legacy double-click shortcut.
 *
 * Unstyled semantic markup with `jini-conv-*` class names, matching every other component in this
 * package — a host supplies the CSS.
 */
import { useT } from '../hooks/context.js';
import { Icon } from './Icon.js';
import { useConversationListView } from './ConversationList.hooks.js';
import { conversationTriggerAttributes } from './ConversationList.rules.js';
import { ConversationTitleEditor } from './ConversationTitleEditor.js';

/** The minimum a row needs to render. Mirrors `@jini-ai/chat/core`'s `ChatConversation`. */
export interface ConversationListItem {
  id: string;
  title: string | null;
  messageCount?: number;
  updatedAt?: number;
}

export interface ConversationListProps {
  report?: Pick<Logger, 'error'> | undefined;
  conversations: ConversationListItem[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void | Promise<void>;
  /** Omit to hide deletion controls. */
  onDelete?: (id: string) => void | Promise<void>;
  /** Omit to hide renaming controls and its double-click shortcut. */
  onRename?: (id: string, title: string) => void | Promise<void>;
  /**
   * Server-backed search. Omit for the built-in client filter.
   *
   * **Required once the list is paginated** — see this module's header.
   */
  onSearch?: (query: string) => Promise<ConversationListItem[]>;
  /**
   * Confirm before deleting. Defaults to `window.confirm`; pass a custom dialog, or
   * `() => Promise.resolve(true)` to delete without asking.
   */
  confirmDelete?: (item: ConversationListItem) => boolean | Promise<boolean>;
  /** Disables the "New" action — e.g. while the current conversation is still empty. */
  createDisabled?: boolean;
  emptyState?: React.ReactNode;
  /** Replaces the trigger's accessible name (default "Conversations — {active title}"). */
  triggerLabel?: string;
  /**
   * `false` drops the trigger's native `title` tooltip, for a host that draws its own tooltip over
   * the icon (the browser's dark tip would otherwise show on top of it). Defaults to true.
   */
  nativeTitle?: boolean;
}

function relativeTime(updatedAt: number | undefined, now: number): string {
  if (updatedAt === undefined) return '';
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Only the host-supported actions are rendered; row selection remains independent. */
function ConversationActions({ itemId, editing, canRename, canDelete, onRename, onDelete, t }: {
  itemId: string;
  editing: boolean;
  canRename: boolean;
  canDelete: boolean;
  onRename: () => void;
  onDelete: () => void;
  t: (key: string) => string;
}) {
  return <>
    {canRename && !editing ? <button
      type="button"
      className="jini-conv-item-rename"
      aria-label={t('Rename chat')}
      data-testid={`conversation-rename-button-${itemId}`}
      onClick={onRename}
    >
      <Icon name="pencil" size={12} />
    </button> : null}
    {canDelete ? <button
      type="button"
      className="jini-conv-item-delete"
      aria-label={t('Delete conversation')}
      data-testid={`conversation-delete-${itemId}`}
      onClick={(event) => {
        event.stopPropagation();
        onDelete();
      }}
    >
      <Icon name="close" size={12} />
    </button> : null}
  </>;
}

/** Hooks ConversationList calls; defaults to the real ones, a test hands in fakes. */
export const defaultConversationListHooks = { useT, useConversationListView };
export type ConversationListHooks = typeof defaultConversationListHooks;

export function ConversationList({
  conversations: savedConversations,
  activeConversationId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onSearch,
  confirmDelete,
  createDisabled = false,
  emptyState,
  triggerLabel,
  nativeTitle = true, hooks = defaultConversationListHooks, report,
}: ConversationListProps & { hooks?: ConversationListHooks | undefined }) {
  const t = hooks.useT();
  const { open, setOpen, query, setQuery, conversations, rawTitles, editingId, setEditingId, rootRef, visible, now, commitRename, startRename, requestDelete, active, emptyLabel, scheduleSelect, createConversation } = hooks.useConversationListView({ savedConversations, activeConversationId, onSelect, onCreate, onDelete, onRename, onSearch, confirmDelete, emptyState, t }, { report });

  return (
    <div className="jini-conv" ref={rootRef}>
      {/* Icon-only, and the label lives on the panel instead. An earlier version put the active
          conversation's title in the trigger AND a "Conversations" heading in the panel, which
          read as the same word twice and pushed the pane header out of alignment. */}
      <button
        type="button"
        className={`jini-conv-trigger${open ? ' jini-conv-trigger-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        {...conversationTriggerAttributes({ activeTitle: active?.title, t }, { label: triggerLabel, nativeTitle })}
        data-testid="conversation-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="comment" size={16} />
      </button>

      {open ? (
        <div className="jini-conv-menu" role="menu" data-testid="conversation-menu">
          <div className="jini-conv-head">
            <span className="jini-conv-heading">
              {t('Conversations')}
              {/* A separate element, not string concatenation: as one text node it rendered as
                  "Conversations0" with nothing to space or style the number against. */}
              <span className="jini-conv-count" data-testid="conversation-count">
                {conversations.length}
              </span>
            </span>
            <button
              type="button"
              className="jini-conv-new"
              disabled={createDisabled}
              data-testid="conversation-new"
              // `disabled` alone guards this: a disabled button never dispatches a click.
              onClick={createConversation}
            >
              <Icon name="plus" size={12} />
              <span>{t('New')}</span>
            </button>
          </div>

          <label className="jini-conv-search">
            <Icon name="search" size={13} />
            <input
              type="search"
              value={query}
              placeholder={t('Search conversations')}
              data-testid="conversation-search"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>

          <div className="jini-conv-list" data-testid="conversation-list">
            {conversations.length === 0 || visible.length === 0 ? (
              <div className="jini-conv-empty">{emptyLabel()}</div>
            ) : (
              visible.map((item) => (
                <div
                  key={item.id}
                  className={`jini-conv-item${item.id === activeConversationId ? ' jini-conv-item-active' : ''}`}
                  data-testid={`conversation-item-${item.id}`}
                >
                  {onRename && editingId === item.id ? (
                    <ConversationTitleEditor
                      title={rawTitles.get(item.id) ?? null}
                      data-testid={`conversation-rename-${item.id}`}
                      onCommit={(next) => commitRename(item.id, next)}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="jini-conv-item-select"
                      data-testid={`conversation-select-${item.id}`}
                      title={onRename ? t('Double-click to rename') : undefined}
                      onClick={() => scheduleSelect(item.id)}
                      onDoubleClick={onRename ? () => startRename(item.id) : undefined}
                    >
                      <span className="jini-conv-item-title">{item.title ?? t('Untitled')}</span>
                      <span className="jini-conv-item-meta">
                        {item.messageCount === undefined ? '' : `${item.messageCount} msg · `}
                        {relativeTime(item.updatedAt, now)}
                      </span>
                    </button>
                  )}
                  <ConversationActions itemId={item.id} editing={editingId === item.id}
                    canRename={Boolean(onRename)} canDelete={Boolean(onDelete)}
                    onRename={() => startRename(item.id)} onDelete={() => requestDelete(item)} t={t} />
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
