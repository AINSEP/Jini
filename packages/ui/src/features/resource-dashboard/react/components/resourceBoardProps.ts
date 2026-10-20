import { UNMATCHED_STATUS_BUCKET } from '../../constants.js';
import type { useT } from '../../../i18n/index.js';
import type { ResourceBoardController, UseWiredResourceBoardParams } from '../hooks/useResourceBoard.js';
import type { ResourceKanbanColumn } from './ResourceKanbanBoard.js';
import type { ResourceBoardViewProps } from './ResourceBoardView.js';
import type { ResourceBoardItem, ResourceBoardViewMode, ResourceStatusOption } from '../../types.js';

type Translate = ReturnType<typeof useT>;

/** `useWiredResourceBoard` params: the column order comes from `statusOptions`, and each optional setting is forwarded only when the host set it. */
export function resourceBoardHookParams<TItem extends ResourceBoardItem>(
  { dependencies, statusOptions }: Pick<UseWiredResourceBoardParams<TItem>, 'dependencies'> & { statusOptions: ResourceStatusOption[] },
  {
    defaultStatus,
    normalizeStatus,
    initialSort,
    storageScopeKey,
    defaultViewMode,
    refreshToken,
  }: {
    defaultStatus?: string | undefined;
    normalizeStatus?: ((status: string) => string) | undefined;
    initialSort?: string | undefined;
    storageScopeKey?: string | undefined;
    defaultViewMode?: ResourceBoardViewMode | undefined;
    refreshToken?: string | number | undefined;
  },
): UseWiredResourceBoardParams<TItem> {
  return {
    dependencies,
    statusOrder: statusOptions.map((option) => option.value),
    ...(defaultStatus !== undefined ? { defaultStatus } : {}),
    ...(normalizeStatus !== undefined ? { normalizeStatus } : {}),
    ...(initialSort !== undefined ? { initialSort } : {}),
    ...(storageScopeKey !== undefined ? { storageScopeKey } : {}),
    ...(defaultViewMode !== undefined ? { defaultViewMode } : {}),
    ...(refreshToken !== undefined ? { refreshToken } : {}),
  };
}

/** One translated kanban column per status option (in order), plus a trailing translated "Other" column only when some item matched no option. */
export function buildKanbanColumns<TItem extends ResourceBoardItem<TBody>, TBody>({
  statusOptions,
  columns,
  t,
}: {
  statusOptions: ResourceStatusOption[];
  columns: Map<string, TItem[]>;
  t: Translate;
}): ResourceKanbanColumn<TBody>[] {
  const kanbanColumns: ResourceKanbanColumn<TBody>[] = statusOptions.map((option) => ({
    status: option.value,
    label: t(option.label),
    // Non-null: `useWiredResourceBoard` (in `ResourceBoard`, via
    // `resourceBoardHookParams` above) is called with `statusOrder:
    // statusOptions.map(option => option.value)`, and `groupItemsByStatus`
    // (rules.ts) always seeds one Map entry per `statusOrder` value before
    // placing any item — so every `option.value` here is guaranteed present.
    items: columns.get(option.value)!,
  }));
  const unmatched = columns.get(UNMATCHED_STATUS_BUCKET);
  if (unmatched && unmatched.length > 0) {
    kanbanColumns.push({ status: UNMATCHED_STATUS_BUCKET, label: t('Other'), items: unmatched });
  }
  return kanbanColumns;
}

/**
 * Routes a kebab-menu action: `delete`/`duplicate` run in-hook, `rename`
 * bubbles to `onRenameRequest` with the item's current title, anything else
 * bubbles to `onCustomItemAction` — the menu is closed before either bubble.
 */
export function createItemActionHandler<TItem extends ResourceBoardItem>(
  { board }: { board: Pick<ResourceBoardController<TItem>, 'remove' | 'duplicate' | 'closeMenu' | 'visibleItems'> },
  {
    onRenameRequest,
    onCustomItemAction,
  }: {
    onRenameRequest?: ((id: string, currentTitle: string) => void) | undefined;
    onCustomItemAction?: ((id: string, kind: string) => void) | undefined;
  },
): (id: string, kind: string) => void {
  return (id, kind) => {
    if (kind === 'delete') {
      void board.remove(id);
      return;
    }
    if (kind === 'duplicate') {
      void board.duplicate(id);
      return;
    }
    if (kind === 'rename') {
      board.closeMenu();
      // Non-null: `id` only ever reaches this handler via a menu-action
      // click closure `ResourceBoardView` builds per rendered item (from
      // this SAME render's `board.visibleItems`), so the item is always
      // still present in the array at lookup time.
      const current = board.visibleItems.find((item) => item.id === id)!;
      onRenameRequest?.(id, current.title);
      return;
    }
    board.closeMenu();
    onCustomItemAction?.(id, kind);
  };
}

/** The create CTA's props: `createLabel` (defaulting to the translated "New") is only forwarded alongside `onCreate`, since the toolbar renders the button only when it has a handler. */
export function boardCreateProps(
  { t }: { t: Translate },
  { createLabel, onCreate }: { createLabel?: string | undefined; onCreate?: (() => void) | undefined },
): Pick<ResourceBoardViewProps, 'createLabel' | 'onCreate'> {
  return onCreate ? { createLabel: createLabel ?? t('New'), onCreate } : {};
}

/** Resolves a status value to its translated option label, falling back to the raw value as the translation key for a status no option covers. */
export function statusLabelFor({ t, statusOptions }: { t: Translate; statusOptions: ResourceStatusOption[] }): (status: string) => string {
  return (status) => t(statusOptions.find((option) => option.value === status)?.label ?? status);
}
