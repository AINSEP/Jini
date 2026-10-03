import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  filterBoardItemsByQuery,
  groupItemsByStatus,
  isActionPending,
  pruneSelectedIds,
  sortBoardItems,
  toggleSelectedId,
  withoutPendingAction,
  withPendingAction,
} from '../../rules.js';
import { createLocalStorageViewModeStorage } from '../../dependencies.js';
import type { ResourceBoardDependencies, ResourceBoardPort } from '../../ports.js';
import type { ResourceBoardItem, ResourceBoardViewMode } from '../../types.js';

const ITEM_ACTION_KIND = 'item-action';
const BULK_DELETE_KIND = 'bulk-delete';
const BULK_DELETE_SCOPE = '__bulk__';
const LOAD_FAILED_MESSAGE = 'Failed to load items.';
const REMOVE_FAILED_MESSAGE = 'Failed to delete item.';
const DUPLICATE_FAILED_MESSAGE = 'Failed to duplicate item.';

export interface UseResourceBoardParams<TItem extends ResourceBoardItem> {
  port: ResourceBoardPort<TItem>;
  viewModeStorage?: import('../../ports.js').ResourceViewModeStoragePort;
  /** Scopes the persisted view-mode preference — never a hardcoded storage key (see `ports.ts`). */
  storageScopeKey?: string;
  defaultViewMode?: ResourceBoardViewMode;
  statusOrder?: readonly string[];
  defaultStatus?: string;
  normalizeStatus?: (status: string) => string;
  initialSort?: string;
  /** Bumping this value re-fetches (mirrors TasksView's own `historyTick`-shaped controlled-invalidation pattern) — a host UI that mutated data outside this hook (e.g. its own rename dialog calling the port directly) uses this to force a reload. */
  refreshToken?: string | number;
}

export interface ResourceBoardController<TItem extends ResourceBoardItem> {
  loading: boolean;
  error: string | null;
  /** Raw (pre search-filter) item count — lets a host distinguish "nothing exists yet" from "search matched nothing" without needing its own separate fetch. */
  totalCount: number;
  query: string;
  setQuery: (query: string) => void;
  sort: string | undefined;
  setSort: (value: string) => void;
  viewMode: ResourceBoardViewMode;
  setViewMode: (mode: ResourceBoardViewMode) => void;
  visibleItems: TItem[];
  kanbanColumns: Map<string, TItem[]>;
  selectMode: boolean;
  selected: ReadonlySet<string>;
  enterSelectMode: () => void;
  exitSelectMode: () => void;
  toggleSelected: (id: string) => void;
  bulkDeleteBusy: boolean;
  bulkDelete: () => Promise<{ deleted: number; failed: number }>;
  openMenuId: string | null;
  /** Attach to the currently-open menu's container (only when `openMenuId === item.id`) so the outside-click dismiss effect can tell a click INSIDE the open menu (e.g. clicking a menu item) apart from a genuine outside click — mirrors DesignsTab's own `menuContainerRef` pattern. */
  menuContainerRef: RefObject<HTMLDivElement | null>;
  toggleMenu: (id: string) => void;
  closeMenu: () => void;
  isItemBusy: (id: string) => boolean;
  reload: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  /**
   * Set when a single-item `remove`/`duplicate` rejects or otherwise fails
   * (as opposed to `error`, which is the LOAD failure and hides the whole
   * item list — a delete/duplicate failure must stay visible ALONGSIDE the
   * still-present items, mirroring the origin `DesignsTab.tsx`'s
   * `handleDuplicateProject` toast-on-catch). Cleared at the start of the
   * next `remove`/`duplicate` call. `null` when no mutation has failed (or
   * bulk delete, which already reports its own per-item outcome counts and
   * never rejects — see `bulkDelete`).
   */
  actionError: string | null;
}

/**
 * Loads a board item list from the injected port and owns every generic
 * DesignsTab-shaped concern: search, sort, view-mode (persisted), select
 * mode + bulk delete, the single-open-at-a-time kebab menu (with
 * outside-click/Escape dismiss, mirroring the origin's own
 * `menuOpenId`/effect), per-item busy tracking, and kanban-column
 * derivation. Interactive rename (which needs a text input the origin
 * collects via its own `Dialog`) is deliberately NOT handled here — see
 * `ResourceBoard.tsx`'s `onRenameRequest` prop and
 * `packages/ui/archived provenance ledger`'s "Dropped" list.
 */
export function useResourceBoard<TItem extends ResourceBoardItem>(params: UseResourceBoardParams<TItem>): ResourceBoardController<TItem> {
  const { port, refreshToken } = params;
  const viewModeStorage = params.viewModeStorage;
  const storageScopeKey = params.storageScopeKey ?? 'resource-dashboard:view';
  const defaultViewMode = params.defaultViewMode ?? 'grid';
  const statusOrder = params.statusOrder ?? [];

  const [items, setItems] = useState<TItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<string | undefined>(params.initialSort);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewModeState] = useState<ResourceBoardViewMode>(() => {
    const stored = (viewModeStorage ?? createLocalStorageViewModeStorage()).getViewMode(storageScopeKey);
    return stored ?? defaultViewMode;
  });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await port.fetchItems();
      setItems(fetched);
      setError(null);
    } catch {
      setError(LOAD_FAILED_MESSAGE);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, refreshToken]);

  // Drop selected ids that no longer exist (DesignsTab's own "prune selection" effect).
  useEffect(() => {
    setSelected((current) => pruneSelectedIds(current, new Set(items.map((item) => item.id))));
  }, [items]);

  // Leaving grid view exits select mode entirely (DesignsTab hides select-mode UI in kanban view).
  useEffect(() => {
    if (viewMode === 'kanban' && selectMode) {
      setSelectMode(false);
      setSelected(new Set());
    }
  }, [viewMode, selectMode]);

  // Single-open-at-a-time kebab menu: outside-click/Escape dismiss. A click
  // INSIDE the open menu (e.g. a menu item) must NOT close it before its own
  // click handler runs — checked via `menuContainerRef.contains(target)`,
  // same guard DesignsTab's own `menuContainerRef`-based effect uses.
  useEffect(() => {
    if (!openMenuId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuId(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      const container = menuContainerRef.current;
      if (container && container.contains(event.target as Node)) return;
      setOpenMenuId(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [openMenuId]);

  const setViewMode = useCallback(
    (mode: ResourceBoardViewMode) => {
      setViewModeState(mode);
      (viewModeStorage ?? createLocalStorageViewModeStorage()).setViewMode(storageScopeKey, mode);
    },
    [viewModeStorage, storageScopeKey],
  );

  const enterSelectMode = useCallback(() => setSelectMode(true), []);
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);
  const toggleSelected = useCallback((id: string) => setSelected((current) => toggleSelectedId(current, id)), []);

  const toggleMenu = useCallback((id: string) => setOpenMenuId((current) => (current === id ? null : id)), []);
  const closeMenu = useCallback(() => setOpenMenuId(null), []);

  const isItemBusy = useCallback((id: string) => isActionPending(pendingKeys, id, ITEM_ACTION_KIND), [pendingKeys]);

  const remove = useCallback(
    async (id: string) => {
      setPendingKeys((current) => withPendingAction(current, id, ITEM_ACTION_KIND));
      setActionError(null);
      try {
        const ok = await port.deleteItem(id);
        // Selection pruning for a removed id is handled by the `items`-watching
        // effect above, so a single `setItems` call here is sufficient.
        if (ok) setItems((current) => current.filter((item) => item.id !== id));
      } catch {
        // A rejection here used to propagate silently to a caller that
        // discarded the promise with `void` (see `ResourceBoard.tsx`) — no
        // visible error, no reload, item still shown as present. Surface it
        // instead, matching the origin's own catch-and-report shape.
        setActionError(REMOVE_FAILED_MESSAGE);
      } finally {
        setPendingKeys((current) => withoutPendingAction(current, id, ITEM_ACTION_KIND));
        setOpenMenuId((current) => (current === id ? null : current));
      }
    },
    [port],
  );

  const duplicate = useCallback(
    async (id: string) => {
      if (!port.duplicateItem) return;
      setPendingKeys((current) => withPendingAction(current, id, ITEM_ACTION_KIND));
      setActionError(null);
      try {
        const created = await port.duplicateItem(id);
        if (created) setItems((current) => [...current, created]);
      } catch {
        setActionError(DUPLICATE_FAILED_MESSAGE);
      } finally {
        setPendingKeys((current) => withoutPendingAction(current, id, ITEM_ACTION_KIND));
        setOpenMenuId((current) => (current === id ? null : current));
      }
    },
    [port],
  );

  const bulkDelete = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return { deleted: 0, failed: 0 };
    setBulkDeleteBusy(true);
    setPendingKeys((current) => withPendingAction(current, BULK_DELETE_SCOPE, BULK_DELETE_KIND));
    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            return await port.deleteItem(id);
          } catch {
            return false;
          }
        }),
      );
      const deletedIds = new Set(ids.filter((_id, index) => results[index]));
      setItems((current) => current.filter((item) => !deletedIds.has(item.id)));
      exitSelectMode();
      const deleted = results.filter(Boolean).length;
      return { deleted, failed: results.length - deleted };
    } finally {
      setPendingKeys((current) => withoutPendingAction(current, BULK_DELETE_SCOPE, BULK_DELETE_KIND));
      setBulkDeleteBusy(false);
    }
  }, [selected, port, exitSelectMode]);

  const visibleItems = useMemo(() => sortBoardItems(filterBoardItemsByQuery(items, query), sort), [items, query, sort]);

  const kanbanColumns = useMemo(
    () =>
      groupItemsByStatus(visibleItems, statusOrder, {
        ...(params.defaultStatus !== undefined ? { defaultStatus: params.defaultStatus } : {}),
        ...(params.normalizeStatus !== undefined ? { normalizeStatus: params.normalizeStatus } : {}),
      }),
    [visibleItems, statusOrder, params.defaultStatus, params.normalizeStatus],
  );

  return {
    loading,
    error,
    actionError,
    totalCount: items.length,
    query,
    setQuery,
    sort,
    setSort,
    viewMode,
    setViewMode,
    visibleItems,
    kanbanColumns,
    selectMode,
    selected,
    enterSelectMode,
    exitSelectMode,
    toggleSelected,
    bulkDeleteBusy,
    bulkDelete,
    openMenuId,
    menuContainerRef,
    toggleMenu,
    closeMenu,
    isItemBusy,
    reload,
    remove,
    duplicate,
  };
}

export type UseWiredResourceBoardParams<TItem extends ResourceBoardItem> = {
  dependencies: ResourceBoardDependencies<TItem>;
} & Omit<UseResourceBoardParams<TItem>, 'port' | 'viewModeStorage'>;

/** Wirer: binds `port`/`viewModeStorage` from a host-supplied `dependencies`. */
export function useWiredResourceBoard<TItem extends ResourceBoardItem>(
  params: UseWiredResourceBoardParams<TItem>,
): ResourceBoardController<TItem> {
  const { dependencies, ...rest } = params;
  return useResourceBoard({
    port: dependencies.port,
    ...(dependencies.viewModeStorage !== undefined ? { viewModeStorage: dependencies.viewModeStorage } : {}),
    ...rest,
  });
}
