import { orFallbackSync } from '@jini-ai/core/errors/idioms';
/**
 * The only file in this feature allowed to touch a concrete adapter.
 *
 * Unlike `features/source-config-list`'s `addSource` (which inherently needs
 * a host-specific `createSource` callback with no generic default), neither
 * `ResourceBoardPort` nor `ResourceRowListPort` has an "add" concept at all
 * — both origins delegate creation entirely to host UI (DesignsTab's
 * `onNewProject`, TasksView's template-gallery + `NewAutomationModal`, both
 * out of this primitive's scope, see `archived UI provenance ledger`'s
 * "Dropped" list). So both fakes below can ship a genuinely useful
 * zero-config default, same reasoning as `features/asset-grid`'s read-only
 * fake.
 */
import { fakeLatencyDelay } from '../../utils/fake-latency.js';
import type {
  ResourceBoardDependencies,
  ResourceBoardPort,
  ResourceRowListDependencies,
  ResourceRowListPort,
  ResourceViewModeStoragePort,
} from './ports.js';
import type { ResourceBoardItem, ResourceBoardViewMode, ResourceRowItem, ResourceRunHistoryItem } from './types.js';

// --- ResourceBoard ---------------------------------------------------------

export interface FakeResourceBoardPortOptions<TItem extends ResourceBoardItem> {
  items?: TItem[];
  /** Simulated network latency in ms; 0 (default) resolves synchronously. */
  latencyMs?: number;
  /** Whether the fake wires `renameItem`. Defaults to true. */
  supportsRename?: boolean;
  /** Whether the fake wires `duplicateItem`. Defaults to true. */
  supportsDuplicate?: boolean;
  /** Builds the duplicated item's id/title when `duplicateItem` is invoked. Defaults to `${id}-copy` / `${title} copy`. */
  onDuplicate?: (item: TItem) => TItem;
}

/** An in-memory test double good enough for demos and for driving this feature's own hook/component tests. */
export function createFakeResourceBoardPort<TItem extends ResourceBoardItem>(
  options: FakeResourceBoardPortOptions<TItem> = {},
): ResourceBoardPort<TItem> {
  const store = options.items ? [...options.items] : [];
  const delay = fakeLatencyDelay({}, { latencyMs: options.latencyMs });

  const port: ResourceBoardPort<TItem> = {
    fetchItems() {
      return delay({ value: [...store] });
    },
    deleteItem(id: string): Promise<boolean> {
      const index = store.findIndex((item) => item.id === id);
      if (index === -1) return delay({ value: false });
      store.splice(index, 1);
      return delay({ value: true });
    },
  };

  if (options.supportsRename ?? true) {
    port.renameItem = (id: string, name: string): Promise<TItem | null> => {
      const index = store.findIndex((item) => item.id === id);
      if (index === -1) return delay({ value: null });
      const updated = { ...store[index]!, title: name };
      store[index] = updated;
      return delay({ value: updated });
    };
  }

  if (options.supportsDuplicate ?? true) {
    port.duplicateItem = (id: string): Promise<TItem | null> => {
      const index = store.findIndex((item) => item.id === id);
      if (index === -1) return delay({ value: null });
      const original = store[index]!;
      const duplicate = options.onDuplicate
        ? options.onDuplicate(original)
        : ({ ...original, id: `${original.id}-copy`, title: `${original.title} copy` } as TItem);
      store.push(duplicate);
      return delay({ value: duplicate });
    };
  }

  return port;
}

/**
 * Real, SSR-guarded `localStorage`-backed view-mode storage — a generic
 * browser preference, not host business logic, so (same reasoning as
 * `features/browser-chrome`'s history storage) this ships as a real
 * implementation rather than a fake/test double.
 */
export function createLocalStorageViewModeStorage(): ResourceViewModeStoragePort {
  return {
    getViewMode(scopeKey: string): ResourceBoardViewMode | null {
      if (typeof window === 'undefined') return null;
      return orFallbackSync({
        work: () => {
          const raw = window.localStorage.getItem(scopeKey);
          return raw === 'grid' || raw === 'kanban' ? raw : null;
        },
        fallback: null,
        step: 'read resource view mode preference',
      });
    },
    setViewMode(scopeKey: string, mode: ResourceBoardViewMode): void {
      if (typeof window === 'undefined') return;
      // Ignore storage quota and private-mode failures.
      orFallbackSync({
        work: () => {
          window.localStorage.setItem(scopeKey, mode);
        },
        fallback: undefined,
        step: 'save resource view mode preference',
      });
    },
  };
}

export function createFakeResourceBoardDependencies<TItem extends ResourceBoardItem>(
  options: FakeResourceBoardPortOptions<TItem> = {},
): ResourceBoardDependencies<TItem> {
  return { port: createFakeResourceBoardPort(options) };
}

// --- ResourceRowList --------------------------------------------------------

export interface FakeResourceRowListPortOptions<TRow extends ResourceRowItem> {
  rows?: TRow[];
  /** Simulated network latency in ms; 0 (default) resolves synchronously. */
  latencyMs?: number;
  /** Whether the fake wires `fetchRowHistory`. Defaults to true. */
  supportsHistory?: boolean;
  /** Per-row history, keyed by row id. Rows with no entry return an empty list. */
  historyByRowId?: Record<string, ResourceRunHistoryItem[]>;
}

export function createFakeResourceRowListPort<TRow extends ResourceRowItem>(
  options: FakeResourceRowListPortOptions<TRow> = {},
): ResourceRowListPort<TRow> {
  const rows = options.rows ? [...options.rows] : [];
  const delay = fakeLatencyDelay({}, { latencyMs: options.latencyMs });

  const port: ResourceRowListPort<TRow> = {
    fetchRows() {
      return delay({ value: [...rows] });
    },
  };

  if (options.supportsHistory ?? true) {
    port.fetchRowHistory = (id: string): Promise<ResourceRunHistoryItem[]> => delay({ value: [...(options.historyByRowId?.[id] ?? [])] });
  }

  return port;
}

export function createFakeResourceRowListDependencies<TRow extends ResourceRowItem>(
  options: FakeResourceRowListPortOptions<TRow> = {},
): ResourceRowListDependencies<TRow> {
  return { port: createFakeResourceRowListPort(options) };
}
