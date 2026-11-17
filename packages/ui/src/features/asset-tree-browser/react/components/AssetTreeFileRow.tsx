import { useT } from '../../../i18n/index.js';
import { humanBytes, relativeTimeResult, type MenuAnchorRect } from '../../rules.js';
import type { AssetTreeRenameState } from '../../types.js';
import { useAssetTreeFileRow } from './AssetTreeFileRow.hooks.js';

export interface AssetTreeFileRowProps {
  path: string;
  /** Basename relative to the current directory (see `basenameForRename`) — what's actually shown/edited. */
  displayName: string;
  active: boolean;
  selected: boolean;
  kindLabel: string;
  kindGlyph: string;
  size: number;
  modifiedAt: number;
  /** Set only when THIS row is the one being renamed. */
  renaming: AssetTreeRenameState | null;
  onSelectPreview: (path: string) => void;
  onOpen: (path: string) => void;
  onToggleSelect: (path: string) => void;
  onOpenMenu: (path: string, anchor: MenuAnchorRect) => void;
  onRenameDraftChange: (draft: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}

/** Selection checkbox cell; Enter/Space toggle like a native checkbox. */
function RowCheck({ path, displayName, selected, onToggleSelect }: {
  path: string; displayName: string; selected: boolean; onToggleSelect: (path: string) => void;
}) {
  const t = useT();
  return (
    <span
      className="asset-tree-row-check"
      role="checkbox"
      aria-checked={selected}
      aria-label={selected ? t('Deselect {name}', { name: displayName }) : t('Select {name}', { name: displayName })}
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onToggleSelect(path);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          onToggleSelect(path);
        }
      }}
    >
      {selected ? (
        <span className="asset-tree-row-check-mark" aria-hidden>
          ✓
        </span>
      ) : null}
    </span>
  );
}

/** Inline rename input; commits on Enter/blur, cancels on Escape (once — see `skipRenameCommit`). */
function RenameInput({ displayName, renaming, onRenameDraftChange, onCommitRename, onCancelRename }: {
  displayName: string; renaming: NonNullable<AssetTreeFileRowProps['renaming']>;
  onRenameDraftChange: (draft: string) => void; onCommitRename: () => void; onCancelRename: () => void;
}) {
  const t = useT();
  return (
  <input
    autoFocus
    className="asset-tree-rename-input"
    aria-label={t('Rename {name}', { name: displayName })}
    value={renaming.draft}
    disabled={renaming.saving}
    onChange={(event) => onRenameDraftChange(event.target.value)}
    onClick={(event) => event.stopPropagation()}
    onDoubleClick={(event) => event.stopPropagation()}
    onBlur={(event) => {
      if (event.currentTarget.dataset.skipRenameCommit === '1') return;
      onCommitRename();
    }}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.preventDefault();
      event.currentTarget.dataset.skipRenameCommit = '1';
      if (event.key === 'Enter') onCommitRename();
      else onCancelRename();
    }}
  />
  );
}

/** Name cell: the inline rename input while renaming, otherwise the preview/open name button. */
function RowNameCell({ path, displayName, kindLabel, renaming, nameKeyDown, onSelectPreview, onOpen, onRenameDraftChange, onCommitRename, onCancelRename }: {
  path: string; displayName: string; kindLabel: string; renaming: AssetTreeFileRowProps['renaming'];
  nameKeyDown: React.KeyboardEventHandler<HTMLButtonElement>;
  onSelectPreview: (path: string) => void; onOpen: (path: string) => void;
  onRenameDraftChange: (draft: string) => void; onCommitRename: () => void; onCancelRename: () => void;
}) {
  return (
      <div className="asset-tree-row-name-wrap">
        {renaming ? (
          <RenameInput displayName={displayName} renaming={renaming} onRenameDraftChange={onRenameDraftChange} onCommitRename={onCommitRename} onCancelRename={onCancelRename} />
        ) : (
          <button
            type="button"
            className="asset-tree-row-name-btn"
            onClick={() => onSelectPreview(path)}
            onDoubleClick={() => onOpen(path)}
            onKeyDown={nameKeyDown}
          >
            <span className="asset-tree-row-name-wrap">
              <span className="asset-tree-row-name" title={displayName}>
                {displayName}
              </span>
              <span className="asset-tree-row-sub">{kindLabel}</span>
            </span>
          </button>
        )}
      </div>
  );
}

/** Row-actions trigger; Enter/Space open the menu like a button. */
function RowMenuTrigger({ path, displayName, handleMenuTrigger }: {
  path: string; displayName: string; handleMenuTrigger: (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => void;
}) {
  const t = useT();
  return (
    <span
      data-testid={`asset-tree-file-menu-${path}`}
      className="asset-tree-row-menu"
      role="button"
      tabIndex={0}
      aria-label={t('Row actions for {name}', { name: displayName })}
      onClick={handleMenuTrigger}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleMenuTrigger(event);
        }
      }}
    >
      ⋯
    </span>
  );
}

/**
 * One file row: hover-revealed checkbox + `⋯` menu trigger, a kind glyph
 * that opens the preview pane on single click and the file itself on double
 * click, an inline rename input when active, and size/modified-time cells.
 * Keyboard parity with the mouse: Enter/Space on the name previews on the
 * first press and opens on a second press within
 * `DOUBLE_ACTIVATION_WINDOW_MS` (mirrors a double-click for keyboard-only
 * navigation — ported from the origin `DesignFilesPanel`'s row name button).
 */
export function AssetTreeFileRow({
  path, displayName, active, selected, kindLabel, kindGlyph, size, modifiedAt, renaming,
  onSelectPreview, onOpen, onToggleSelect, onOpenMenu, onRenameDraftChange, onCommitRename, onCancelRename,
}: AssetTreeFileRowProps) {
  const t = useT();
  const { handleNameKeyDown, handleMenuTrigger } = useAssetTreeFileRow({ path, onOpen, onSelectPreview, onOpenMenu });
  const relativeTime = relativeTimeResult(modifiedAt);
  const timeLabel = relativeTime.translatable ? t(relativeTime.label, relativeTime.params) : relativeTime.label;

  return (
    <div
      data-testid={`asset-tree-file-row-${path}`}
      className={`asset-tree-row asset-tree-file-row${active ? ' active' : ''}${selected ? ' selected' : ''}`}
    >
      <RowCheck path={path} displayName={displayName} selected={selected} onToggleSelect={onToggleSelect} />
      <span
        className="asset-tree-row-icon"
        aria-hidden
        onClick={() => onSelectPreview(path)}
        onDoubleClick={() => onOpen(path)}
      >
        {kindGlyph}
      </span>
      <RowNameCell
        path={path} displayName={displayName} kindLabel={kindLabel} renaming={renaming} nameKeyDown={handleNameKeyDown}
        onSelectPreview={onSelectPreview} onOpen={onOpen}
        onRenameDraftChange={onRenameDraftChange} onCommitRename={onCommitRename} onCancelRename={onCancelRename}
      />
      <span className="asset-tree-row-size" onClick={() => onSelectPreview(path)} onDoubleClick={() => onOpen(path)}>
        {humanBytes(size)}
      </span>
      <span className="asset-tree-row-time" onClick={() => onSelectPreview(path)} onDoubleClick={() => onOpen(path)}>
        {timeLabel}
      </span>
      <RowMenuTrigger path={path} displayName={displayName} handleMenuTrigger={handleMenuTrigger} />
    </div>
  );
}
