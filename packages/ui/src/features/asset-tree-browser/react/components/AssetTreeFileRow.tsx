import { useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { useT } from '../../../i18n/index.js';
import { humanBytes, isDoubleActivation, relativeTimeResult, type MenuAnchorRect } from '../../rules.js';
import type { AssetTreeRenameState } from '../../types.js';

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
  path,
  displayName,
  active,
  selected,
  kindLabel,
  kindGlyph,
  size,
  modifiedAt,
  renaming,
  onSelectPreview,
  onOpen,
  onToggleSelect,
  onOpenMenu,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
}: AssetTreeFileRowProps) {
  const t = useT();
  const lastActivationRef = useRef<number | undefined>(undefined);
  const relativeTime = relativeTimeResult(modifiedAt);
  const timeLabel = relativeTime.translatable ? t(relativeTime.label, relativeTime.params) : relativeTime.label;

  function handleNameKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const now = Date.now();
    if (isDoubleActivation(lastActivationRef.current, now)) {
      lastActivationRef.current = undefined;
      onOpen(path);
    } else {
      lastActivationRef.current = now;
      onSelectPreview(path);
    }
  }

  function handleMenuTrigger(event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenMenu(path, event.currentTarget.getBoundingClientRect());
  }

  return (
    <div
      data-testid={`asset-tree-file-row-${path}`}
      className={`asset-tree-row asset-tree-file-row${active ? ' active' : ''}${selected ? ' selected' : ''}`}
    >
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
      <span
        className="asset-tree-row-icon"
        aria-hidden
        onClick={() => onSelectPreview(path)}
        onDoubleClick={() => onOpen(path)}
      >
        {kindGlyph}
      </span>
      <div className="asset-tree-row-name-wrap">
        {renaming ? (
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
        ) : (
          <button
            type="button"
            className="asset-tree-row-name-btn"
            onClick={() => onSelectPreview(path)}
            onDoubleClick={() => onOpen(path)}
            onKeyDown={handleNameKeyDown}
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
      <span className="asset-tree-row-size" onClick={() => onSelectPreview(path)} onDoubleClick={() => onOpen(path)}>
        {humanBytes(size)}
      </span>
      <span className="asset-tree-row-time" onClick={() => onSelectPreview(path)} onDoubleClick={() => onOpen(path)}>
        {timeLabel}
      </span>
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
    </div>
  );
}
