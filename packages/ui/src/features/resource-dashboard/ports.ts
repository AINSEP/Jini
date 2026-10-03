/**
 * The DI seam for both composed components. Two separate port interfaces,
 * matching the two composed components — nothing here is shared, which is
 * itself evidence for the shared-vs-separate verdict recorded in `types.ts`
 * and `packages/ui/archived provenance ledger`: the only shared surface in this feature
 * is pure (`rules.ts`) plus one presentational leaf (`StatusPill`), never a
 * transport-level one.
 */
import type { ResourceBoardItem, ResourceBoardViewMode, ResourceRowItem, ResourceRunHistoryItem } from './types.js';

// --- ResourceBoard --------------------------------------------------------

/**
 * `renameItem`/`duplicateItem` are optional: DesignsTab's own `Props`
 * already makes `onRename`/`onDuplicate` optional callbacks (a host without
 * a rename or duplicate concept for its resource simply omits them), so
 * this primitive mirrors that rather than forcing every host to implement
 * both. `deleteItem` is required — every origin (and every plausible
 * resource-dashboard host) supports removing an item; `ResourceBoard`'s
 * select-mode + bulk-delete bar is only rendered when a host additionally
 * enables it via the `enableBulkDelete` prop (see `ResourceBoard.tsx`), not
 * gated on a separate port method.
 */
export interface ResourceBoardPort<TItem extends ResourceBoardItem = ResourceBoardItem> {
  fetchItems(): Promise<TItem[]>;
  renameItem?(id: string, name: string): Promise<TItem | null>;
  duplicateItem?(id: string): Promise<TItem | null>;
  deleteItem(id: string): Promise<boolean>;
}

/** Generic "grid/kanban" view-mode preference storage, scoped by a host-supplied `scopeKey` (never a hardcoded `"od:designs:view"`-shaped literal — see the origin's `DESIGNS_VIEW_STORAGE_KEY`, deliberately not ported verbatim). */
export interface ResourceViewModeStoragePort {
  getViewMode(scopeKey: string): ResourceBoardViewMode | null;
  setViewMode(scopeKey: string, mode: ResourceBoardViewMode): void;
}

export interface ResourceBoardDependencies<TItem extends ResourceBoardItem = ResourceBoardItem> {
  port: ResourceBoardPort<TItem>;
  /** Optional — `dependencies.ts` supplies a real SSR-guarded `localStorage`-backed default when omitted, same pattern as `features/browser-chrome`'s history storage. */
  viewModeStorage?: ResourceViewModeStoragePort;
}

// --- ResourceRowList -------------------------------------------------------

/**
 * `fetchRowHistory` is optional: a row shape with no run-history concept at
 * all simply omits it, and `ResourceRowList` never renders an
 * expand affordance for a row whose port has no history method — the same
 * "capability derived from which optional port methods exist" pattern
 * `features/source-config-list` already established. Everything else a row
 * can DO (run/edit/pause-resume/delete in the origin) is deliberately NOT a
 * port method here: those are arbitrary, host-defined actions
 * (`ResourceRowItem.actions`) dispatched through a single `onRowAction`
 * callback the orchestrator owns, because their semantics vary too much
 * per host to generalize into fixed port methods (see `types.ts`).
 */
export interface ResourceRowListPort<TRow extends ResourceRowItem = ResourceRowItem> {
  fetchRows(): Promise<TRow[]>;
  fetchRowHistory?(id: string): Promise<ResourceRunHistoryItem[]>;
}

export interface ResourceRowListDependencies<TRow extends ResourceRowItem = ResourceRowItem> {
  port: ResourceRowListPort<TRow>;
}
