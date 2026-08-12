/**
 * @module ConversationList
 *
 * The conversation switcher: new / select / delete / search / rename-on-double-click. Drop it
 * into `ChatPane`'s `leadingAccessory` slot — it needs no changes to `ChatPane` itself.
 *
 * Storage-agnostic by construction. It takes data and callbacks and owns nothing durable, so a
 * host backs it with `@jini-ai/sqlite`'s `ChatHistoryStore`, an HTTP endpoint, or an in-memory
 * array without this file knowing the difference.
 *
 * Search is a **client-side filter by default**, and delegates to `onSearch` when a host provides
 * one. That default is not laziness: a host with no server search still gets a working filter,
 * and one whose list grows past a page swaps in a server query by passing a prop. The rule for
 * when to swap is concrete — a client filter over a *paginated* list silently searches only the
 * loaded page, so the moment a host paginates, it must provide `onSearch`.
 *
 * Rename is double-click, restoring parity with Open Design's original `ConversationsMenu`; its
 * own newer in-pane menu dropped the affordance, which is a regression rather than a decision.
 *
 * Unstyled semantic markup with `jini-conv-*` class names, matching every other component in this
 * package — a host supplies the CSS.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../hooks/context.js';
import { Icon } from './Icon.js';

/**
 * How long a click waits to see whether it is really the first half of a double-click.
 *
 * Chosen below the ~500ms OS double-click threshold on purpose: this only has to disambiguate
 * two clicks a user made deliberately in quick succession, and a longer wait would make ordinary
 * conversation switching feel sticky.
 */
const DOUBLE_CLICK_GRACE_MS = 220;

/** The minimum a row needs to render. Mirrors `@jini-ai/chat/core`'s `ChatConversation`. */
export interface ConversationListItem {
  id: string;
  title: string | null;
  messageCount?: number;
  updatedAt?: number;
}

export interface ConversationListProps {
  conversations: ConversationListItem[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onRename: (id: string, title: string) => void | Promise<void>;
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
}

function reportConversationListHostEffectFailure(effectName: string, error: unknown) {
  console.error(`[@jini-ai/chat] ConversationList ${effectName} host effect failed:`, error);
}

/** Invokes a host callback and reports a synchronous throw or async rejection without leaving it unhandled. */
function runConversationListHostEffect(effectName: string, effect: () => void | Promise<unknown>) {
  let result: void | Promise<unknown>;
  try {
    result = effect();
  } catch (error) {
    reportConversationListHostEffectFailure(effectName, error);
    return;
  }
  void Promise.resolve(result).catch((error: unknown) => {
    reportConversationListHostEffectFailure(effectName, error);
  });
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

export function ConversationList({
  conversations,
  activeConversationId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onSearch,
  confirmDelete,
  createDisabled = false,
  emptyState,
}: ConversationListProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [serverResults, setServerResults] = useState<ConversationListItem[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const deferredQuery = useDeferredValue(query);
  /**
   * Pending single-click selection, held so a double-click can cancel it.
   *
   * A double-click always delivers its first `click` too, so selecting immediately would close
   * the menu out from under the rename editor — the row would be selected and the switcher shut
   * before `dblclick` ever arrived. Open Design's original switcher has exactly this bug. The
   * delay is only perceptible if you are looking for it, and it costs nothing but a timer.
   */
  const pendingSelectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingSelect = useCallback(() => {
    if (pendingSelectRef.current === null) return;
    clearTimeout(pendingSelectRef.current);
    pendingSelectRef.current = null;
  }, []);

  // A timer that fires after unmount would call `setOpen` on a dead component.
  useEffect(() => cancelPendingSelect, [cancelPendingSelect]);

  /*
   * Closing the switcher also abandons a click that has not yet resolved into a selection.
   *
   * The grace window exists so a double-click can become a rename rather than a selection, which
   * means a single click stays pending for 220ms. Press Escape (or click outside) inside that window
   * and the menu closes while the timer survives, so the row is selected anyway — and if the pending
   * click was on Delete, it selects an id that no longer exists.
   */
  useEffect(() => {
    if (!open) cancelPendingSelect();
  }, [open, cancelPendingSelect]);

  // Close on outside click / Escape. Registered only while open so a closed switcher costs
  // nothing on every document event.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // A stale query is worse than no query: reopening to yesterday's filter looks like data loss.
  useEffect(() => {
    if (open) return;
    setQuery('');
    setServerResults(null);
    setEditingId(null);
  }, [open]);

  useEffect(() => {
    if (!onSearch) return;
    if (!deferredQuery) {
      setServerResults(null);
      return;
    }
    // `cancelled` guards the classic out-of-order response: a slow query for "a" resolving after
    // a fast one for "abc" would otherwise overwrite the newer, correct results.
    let cancelled = false;
    // A search failure just leaves the prior (possibly stale) results in place rather than
    // wiping the list — degraded, not wrong, so reporting the rejection is all that's warranted.
    runConversationListHostEffect('onSearch', () =>
      onSearch(deferredQuery).then((results) => {
        if (!cancelled) setServerResults(results);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [onSearch, deferredQuery]);

  const visible = useMemo(() => {
    if (onSearch) return serverResults ?? conversations;
    const needle = deferredQuery.trim().toLocaleLowerCase();
    if (!needle) return conversations;
    return conversations.filter((c) =>
      (c.title ?? t('Untitled')).toLocaleLowerCase().includes(needle),
    );
  }, [onSearch, serverResults, conversations, deferredQuery, t]);

  // One timestamp for the whole render so every row's "5m ago" is computed against the same
  // instant — otherwise rows drawn either side of a second boundary disagree.
  const now = Date.now();

  const commitRename = useCallback(
    (id: string) => {
      const next = draft.trim();
      setEditingId(null);
      // An empty rename is a cancel, not a request to erase the title — a user who selects all
      // and hits Enter has almost certainly changed their mind.
      //
      // No optimistic title update happens here — the row keeps rendering `item.title` from
      // props until the host's own state updates, so a rejection cannot leave the UI showing a
      // title the server didn't accept. Reporting the failure is what closes the remaining gap.
      if (next) runConversationListHostEffect('onRename', () => onRename(id, next));
    },
    [draft, onRename],
  );

  const requestDelete = useCallback(
    (item: ConversationListItem) => {
      const confirmer =
        confirmDelete ??
        ((c: ConversationListItem) =>
          typeof window === 'undefined'
            ? true
            : window.confirm(t('Delete "{title}"? This cannot be undone.').replace('{title}', c.title ?? t('Untitled'))));
      // No optimistic removal — the row stays in `conversations` until the host's own state
      // drops it — so a rejected confirmer or `onDelete` cannot leave a deleted-looking row
      // behind; it only means the item silently never disappears. `onDelete` is the effect name
      // reported here since a rejecting confirmer is, from the host's perspective, also "the
      // delete didn't happen."
      runConversationListHostEffect('onDelete', async () => {
        if (await confirmer(item)) await onDelete(item.id);
      });
    },
    [confirmDelete, onDelete, t],
  );

  const active = conversations.find((c) => c.id === activeConversationId) ?? null;

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
        aria-label={active?.title ? `${t('Conversations')} — ${active.title}` : t('Conversations')}
        title={active?.title ?? t('Conversations')}
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
              onClick={() => {
                if (createDisabled) return;
                // No optimistic row is inserted — the list still comes straight from props — so a
                // rejection here cannot leave a phantom conversation on screen; it only means the
                // switcher closed without one actually being created. Reporting the failure closes
                // the remaining gap between "switcher closed" and "the host actually knows".
                runConversationListHostEffect('onCreate', () => onCreate());
                setOpen(false);
              }}
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
            {conversations.length === 0 ? (
              <div className="jini-conv-empty">{emptyState ?? t('No conversations yet')}</div>
            ) : visible.length === 0 ? (
              <div className="jini-conv-empty">{t('No conversations match')}</div>
            ) : (
              visible.map((item) => (
                <div
                  key={item.id}
                  className={`jini-conv-item${item.id === activeConversationId ? ' jini-conv-item-active' : ''}`}
                  data-testid={`conversation-item-${item.id}`}
                >
                  {editingId === item.id ? (
                    <input
                      autoFocus
                      className="jini-conv-rename"
                      value={draft}
                      data-testid={`conversation-rename-${item.id}`}
                      onChange={(event) => setDraft(event.currentTarget.value)}
                      onBlur={() => commitRename(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename(item.id);
                        else if (event.key === 'Escape') setEditingId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="jini-conv-item-select"
                      data-testid={`conversation-select-${item.id}`}
                      title={t('Double-click to rename')}
                      onClick={() => {
                        cancelPendingSelect();
                        pendingSelectRef.current = setTimeout(() => {
                          pendingSelectRef.current = null;
                          onSelect(item.id);
                          setOpen(false);
                        }, DOUBLE_CLICK_GRACE_MS);
                      }}
                      onDoubleClick={() => {
                        cancelPendingSelect();
                        setEditingId(item.id);
                        setDraft(item.title ?? '');
                      }}
                    >
                      <span className="jini-conv-item-title">{item.title ?? t('Untitled')}</span>
                      <span className="jini-conv-item-meta">
                        {item.messageCount === undefined ? '' : `${item.messageCount} msg · `}
                        {relativeTime(item.updatedAt, now)}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="jini-conv-item-delete"
                    aria-label={t('Delete conversation')}
                    data-testid={`conversation-delete-${item.id}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      requestDelete(item);
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
