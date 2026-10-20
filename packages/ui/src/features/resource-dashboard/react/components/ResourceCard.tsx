import type { ReactNode, RefObject } from 'react';
import { isCardActivationKey, resourceCardClassName, ResourceCardMenu, ResourceCardMeta } from './ResourceCardParts.js';
import type { ResourceBoardItem, ResourceStatusToneMap } from '../../types.js';

export interface ResourceCardProps<TBody = unknown> {
  item: ResourceBoardItem<TBody>;
  selectMode: boolean;
  selected: boolean;
  menuOpen: boolean;
  busy: boolean;
  /** Pre-translated status label (`undefined` when the item has no status) — the card itself never calls `t()`. */
  statusLabel?: string;
  toneMap?: ResourceStatusToneMap;
  /** Pre-translated kebab-menu labels (keyed by `ResourceMenuActionSpec.kind`) — same i18n-at-the-boundary rule. */
  menuActionLabel?: (kind: string, fallback: string) => string;
  moreLabel: string;
  /** Attach only when `menuOpen` is true — lets the owning hook's outside-click effect tell a click inside the open menu apart from a genuine outside click (see `useResourceBoard`'s `menuContainerRef`). */
  menuContainerRef?: RefObject<HTMLDivElement | null>;
  /** Host-supplied render slot for anything beyond title/subtitle/status (DesignsTab's cover-thumbnail resolution stays entirely host-owned). */
  renderBody?: (item: ResourceBoardItem<TBody>) => ReactNode;
  onOpen: () => void;
  onToggleSelected: () => void;
  onToggleMenu: () => void;
  onAction: (kind: string) => void;
}

/**
 * One dashboard card: DesignsTab's `design-card` grid item — clickable to
 * open (or, in select-mode, to toggle selection), a select-mode checkbox OR
 * a kebab menu (never both), a status badge, and a host-supplied body slot.
 * Kanban-column cards reuse this same component (DesignsTab's own
 * `design-kanban-card` is a slimmer variant of the same card, so this
 * primitive renders one shape for both rather than two near-duplicates).
 */
export function ResourceCard<TBody = unknown>({
  item,
  selectMode,
  selected,
  menuOpen,
  busy,
  statusLabel,
  toneMap,
  menuActionLabel,
  moreLabel,
  menuContainerRef,
  renderBody,
  onOpen,
  onToggleSelected,
  onToggleMenu,
  onAction,
}: ResourceCardProps<TBody>) {
  const handleActivate = () => {
    if (selectMode) onToggleSelected();
    else onOpen();
  };
  const menuActions = selectMode ? [] : (item.menuActions ?? []);

  return (
    <div
      className={resourceCardClassName({ selected, selectMode })}
      role="button"
      tabIndex={0}
      data-testid="resource-board-card"
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (isCardActivationKey(event)) {
          event.preventDefault();
          handleActivate();
        }
      }}
    >
      {selectMode ? (
        <span className={`resource-board-card-checkbox${selected ? ' checked' : ''}`} aria-hidden data-testid="resource-board-card-checkbox" />
      ) : null}
      {menuActions.length > 0 ? (
        <ResourceCardMenu
          menuActions={menuActions}
          menuOpen={menuOpen}
          busy={busy}
          moreLabel={moreLabel}
          menuContainerRef={menuContainerRef}
          menuActionLabel={menuActionLabel}
          onToggleMenu={onToggleMenu}
          onAction={onAction}
        />
      ) : null}

      <div className="resource-board-card-body">{renderBody ? renderBody(item) : null}</div>

      <ResourceCardMeta item={item} statusLabel={statusLabel} toneMap={toneMap} />
    </div>
  );
}
