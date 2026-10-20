import type { KeyboardEvent, RefObject } from 'react';
import { StatusPill } from './StatusPill.js';
import type { ResourceBoardItem, ResourceMenuActionSpec, ResourceStatusToneMap } from '../../types.js';

/** The card's own class list: `is-selected` and `select-mode` modifiers on top of the base class. */
export function resourceCardClassName({ selected, selectMode }: { selected: boolean; selectMode: boolean }): string {
  return `resource-board-card${selected ? ' is-selected' : ''}${selectMode ? ' select-mode' : ''}`;
}

/** Enter/Space activate the card (open, or toggle selection in select-mode), matching a native button. */
export function isCardActivationKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' ';
}

/** The open kebab menu's items — clicks and keydowns inside it never bubble to the card. */
export function ResourceCardMenuItems({
  menuActions,
  busy,
  menuActionLabel,
  onAction,
}: {
  menuActions: ResourceMenuActionSpec[];
  busy: boolean;
  menuActionLabel: ((kind: string, fallback: string) => string) | undefined;
  onAction: (kind: string) => void;
}) {
  return (
    <div
      className="resource-board-card-menu"
      role="menu"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {menuActions.map((action) => (
        <button
          key={action.kind}
          type="button"
          role="menuitem"
          className={action.danger ? 'danger' : undefined}
          disabled={busy}
          onClick={() => onAction(action.kind)}
        >
          {menuActionLabel ? menuActionLabel(action.kind, action.label) : action.label}
        </button>
      ))}
    </div>
  );
}

/** The kebab "more" button plus, while `menuOpen`, its menu — `menuContainerRef` is attached only while open (see `ResourceCardProps.menuContainerRef`). */
export function ResourceCardMenu({
  menuActions,
  menuOpen,
  busy,
  moreLabel,
  menuContainerRef,
  menuActionLabel,
  onToggleMenu,
  onAction,
}: {
  menuActions: ResourceMenuActionSpec[];
  menuOpen: boolean;
  busy: boolean;
  moreLabel: string;
  menuContainerRef: RefObject<HTMLDivElement | null> | undefined;
  menuActionLabel: ((kind: string, fallback: string) => string) | undefined;
  onToggleMenu: () => void;
  onAction: (kind: string) => void;
}) {
  return (
    <div className="resource-board-card-menu-anchor" ref={menuOpen ? menuContainerRef : undefined}>
      <button
        type="button"
        className="resource-board-card-more"
        aria-label={moreLabel}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => {
          event.stopPropagation();
          onToggleMenu();
        }}
        // `stopPropagation` on `onClick` above only stops the CLICK the
        // browser synthesizes from an Enter/Space keydown — the raw
        // keydown event itself still bubbles to the outer card's own
        // `onKeyDown` (a separate event), which would otherwise ALSO
        // treat that same keypress as "activate the card" and open/
        // toggle-select it at the same time this button's own action
        // runs. Stop it here too.
        onKeyDown={(event) => event.stopPropagation()}
      >
        {moreLabel}
      </button>
      {menuOpen ? <ResourceCardMenuItems menuActions={menuActions} busy={busy} menuActionLabel={menuActionLabel} onAction={onAction} /> : null}
    </div>
  );
}

/** Title, optional subtitle, and the status badge (only when the item has a status AND a pre-translated label). */
export function ResourceCardMeta<TBody>({
  item,
  statusLabel,
  toneMap,
}: {
  item: ResourceBoardItem<TBody>;
  statusLabel: string | undefined;
  toneMap: ResourceStatusToneMap | undefined;
}) {
  return (
    <div className="resource-board-card-meta">
      <div className="resource-board-card-title" title={item.title}>
        {item.title}
      </div>
      {item.subtitle ? <div className="resource-board-card-subtitle">{item.subtitle}</div> : null}
      {item.status && statusLabel ? <StatusPill status={item.status} label={statusLabel} {...(toneMap ? { toneMap } : {})} /> : null}
    </div>
  );
}
