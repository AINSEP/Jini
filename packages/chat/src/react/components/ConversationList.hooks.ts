import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createConsoleLogger, type Logger } from '@jini-ai/core/primitives';
import type { ConversationListProps } from './ConversationList.js';
import type { useT } from '../hooks/context.js';
import { stripConversationTitleMarkdown } from '../../core/persistence/title.js';
import type { ConversationListItem } from './ConversationList.js';

/** Project saved/search titles for presentation without renaming durable conversations.
 * The switcher has no prompt or title provenance, so keep wording and casing while stripping
 * markup through the same owner as the panel title. Caller arrays and objects stay untouched.
 * @param input.conversations - The loaded conversations.
 * @param input.serverResults - Optional server search results, or null before a response.
 * @returns Plain-text display lists and raw titles for lossless editing. Hosts ellipsize rows in CSS.
 * @complexity O(n + sum(t²)) worst-case cleanup time; O(n + sum(t)) space for n items of length t.
 */
export function useConversationListTitles({ conversations, serverResults }: {
  conversations: ConversationListItem[]; serverResults: ConversationListItem[] | null;
}, _options = {}): {
  conversations: ConversationListItem[]; serverResults: ConversationListItem[] | null;
  rawTitles: ReadonlyMap<string, string | null>;
} {
  return useMemo(() => {
    const rawTitles = new Map<string, string | null>();
    const display = (items: ConversationListItem[]) => items.map(item => ({
      ...item, title: item.title === null ? null : stripConversationTitleMarkdown({ text: item.title }) || null,
    }));
    // Search results can contain unloaded rows or newer titles for loaded ids; visible results win.
    for (const item of conversations) rawTitles.set(item.id, item.title);
    for (const item of serverResults ?? []) rawTitles.set(item.id, item.title);
    return { conversations: display(conversations), serverResults: serverResults === null ? null : display(serverResults), rawTitles };
  }, [conversations, serverResults]);
}

/**
 * How long a click waits to see whether it is really the first half of a double-click.
 *
 * Covers the common OS double-click window, including deliberate clicks 300ms apart.
 */
const DOUBLE_CLICK_GRACE_MS = 500;

function reportConversationListHostEffectFailure({ effectName, error }: { effectName: string; error: unknown }, { report: logger = createConsoleLogger({ prefix: '' }) }: { report?: Pick<Logger, 'error'> | undefined } = {}) {
  logger.error({ message: `[@jini-ai/chat] ConversationList ${effectName} host effect failed:` }, { error });
}

/** Invokes a host callback and reports a synchronous throw or async rejection without leaving it unhandled. */
function runConversationListHostEffect({ effectName, effect }: { effectName: string; effect: () => void | Promise<unknown> }, { report }: { report?: Pick<Logger, 'error'> | undefined } = {}) {
  let result: void | Promise<unknown>;
  try {
    result = effect();
  } catch (error) {
    reportConversationListHostEffectFailure({ effectName, error }, { report });
    return;
  }
  void Promise.resolve(result).catch((error: unknown) => {
    reportConversationListHostEffectFailure({ effectName, error }, { report });
  });
}

/** Manage search, selection timing, rename, deletion, and host effects for the switcher. */
export function useConversationListView({ savedConversations, activeConversationId, onSelect, onCreate, onDelete, onRename, onSearch, confirmDelete, emptyState, t }: {
  savedConversations: ConversationListProps['conversations']; activeConversationId: ConversationListProps['activeConversationId'];
  onSelect: ConversationListProps['onSelect']; onCreate: ConversationListProps['onCreate']; onDelete: ConversationListProps['onDelete'];
  onRename: ConversationListProps['onRename']; onSearch: ConversationListProps['onSearch']; confirmDelete: ConversationListProps['confirmDelete'];
  emptyState: ConversationListProps['emptyState']; t: ReturnType<typeof useT>;
}, { report }: { report?: Pick<Logger, 'error'> | undefined } = {}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [savedServerResults, setServerResults] = useState<ConversationListItem[] | null>(null);
  const { conversations, serverResults, rawTitles } = useConversationListTitles({ conversations: savedConversations, serverResults: savedServerResults });
  const [editingId, setEditingId] = useState<string | null>(null);
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
   * means a single click stays pending for the grace window. Press Escape (or click outside) inside it
   * and the menu closes while the timer survives, so the row is selected anyway — and if the pending
   * click was on Delete, it selects an id that no longer exists.
   */
  useEffect(() => {
    if (!open) cancelPendingSelect();
  }, [open, cancelPendingSelect]);

  // Close on outside click / Escape. Registered only while open so a closed switcher costs
  // nothing on every document event.
  useEffect(() => {
    if (!open) return undefined;
    // The root div is committed before any effect runs, so it is never null here. Capturing it
    // (rather than reading the ref per event) keeps a late event during unmount, after React has
    // detached the ref but before this cleanup runs, measured against the real node.
    const root = rootRef.current as HTMLDivElement;
    function onPointerDown(event: MouseEvent) {
      if (!root.contains(event.target as Node)) setOpen(false);
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
    if (!onSearch) return undefined;
    if (!deferredQuery) {
      setServerResults(null);
      return undefined;
    }
    // `cancelled` guards the classic out-of-order response: a slow query for "a" resolving after
    // a fast one for "abc" would otherwise overwrite the newer, correct results.
    let cancelled = false;
    // A search failure just leaves the prior (possibly stale) results in place rather than
    // wiping the list — degraded, not wrong, so reporting the rejection is all that's warranted.
    runConversationListHostEffect({ effectName: 'onSearch', effect: () =>
      onSearch(deferredQuery).then((results) => {
        if (!cancelled) setServerResults(results);
      }),
    }, { report });
    return () => {
      cancelled = true;
    };
  }, [onSearch, deferredQuery, report]);

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
    (id: string, next: string) => {
      setEditingId(null);
      // No optimistic title update happens here — the row keeps rendering `item.title` from
      // props until the host's own state updates, so a rejection cannot leave the UI showing a
      // title the server didn't accept. Reporting the failure is what closes the remaining gap.
      if (onRename) runConversationListHostEffect({ effectName: 'onRename', effect: () => onRename(id, next) }, { report });
    },
    [onRename, report],
  );

  const startRename = (id: string) => {
    if (!onRename) return;
    cancelPendingSelect();
    setEditingId(id);
  };

  const requestDelete = useCallback(
    (item: ConversationListItem) => {
      if (!onDelete) return;
      const confirmer =
        confirmDelete ??
        // Only ever called from a click handler, so a browser `window` always exists here.
        ((c: ConversationListItem) =>
          window.confirm(t('Delete "{title}"? This cannot be undone.').replace('{title}', () => c.title ?? t('Untitled'))));
      // No optimistic removal — the row stays in `conversations` until the host's own state
      // drops it — so a rejected confirmer or `onDelete` cannot leave a deleted-looking row
      // behind; it only means the item silently never disappears. `onDelete` is the effect name
      // reported here since a rejecting confirmer is, from the host's perspective, also "the
      // delete didn't happen."
      runConversationListHostEffect({ effectName: 'onDelete', effect: async () => {
        if (await confirmer(item)) await onDelete(item.id);
      } }, { report });
    },
    [confirmDelete, onDelete, t, report],
  );

  const active = conversations.find((c) => c.id === activeConversationId) ?? null;

  const emptyLabel = () => conversations.length === 0 ? emptyState ?? t('No conversations yet') : t('No conversations match');

  const scheduleSelect = (id: string) => {
    cancelPendingSelect();
    pendingSelectRef.current = setTimeout(() => {
      pendingSelectRef.current = null;
      onSelect(id);
      setOpen(false);
    }, DOUBLE_CLICK_GRACE_MS);
  };
  // No optimistic row is inserted — the list still comes straight from props — so a
  // rejection here cannot leave a phantom conversation on screen; it only means the
  // switcher closed without one actually being created. Reporting the failure closes
  // the remaining gap between "switcher closed" and "the host actually knows".
  const createConversation = () => {
    runConversationListHostEffect({ effectName: 'onCreate', effect: () => onCreate() }, { report });
    setOpen(false);
  };
  return { open, setOpen, query, setQuery, conversations, rawTitles, editingId, setEditingId, rootRef, visible, now, commitRename, startRename, requestDelete, active, emptyLabel, scheduleSelect, createConversation };
}
