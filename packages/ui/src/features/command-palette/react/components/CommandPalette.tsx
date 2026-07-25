import { useCallback, useEffect, useRef } from 'react';
import { useT } from '../../../i18n/index.js';
import type { CommandPaletteItem } from '../../types.js';
import { useWiredCommandPalette } from '../hooks/useCommandPalette.js';
import { CommandPaletteRow } from './CommandPaletteRow.js';

export interface CommandPaletteProps {
  items: readonly CommandPaletteItem[];
  onSelect: (item: CommandPaletteItem) => void;
  onClose: () => void;
  scopeKey?: string | undefined;
  placeholder?: string | undefined;
  /** Custom hook override for dependency injection / testing. */
  useWiredCommandPalette?: typeof useWiredCommandPalette;
}

/**
 * A full-screen Cmd/Ctrl+P-style palette: a single search input over a
 * ranked, keyboard-navigable result list (arrow keys + wraparound, Enter to
 * select, Escape to close), with still-extant recents surfaced first for an
 * empty query. The host owns opening/closing it (there's no built-in
 * keybinding) and supplies the searchable `items`.
 *
 * Origin: `QuickSwitcher.tsx` — the origin's `ProjectFile`/`WorkspaceContextItem`
 * split (files vs. tabs, two different shapes) is replaced by one generic
 * `CommandPaletteItem`; see `packages/ui/source-map.md` for the full
 * genericization writeup, including why this is a distinct primitive from
 * `features/mention-autocomplete/`.
 */
export function CommandPalette({
  items,
  onSelect,
  onClose,
  scopeKey,
  placeholder,
  useWiredCommandPalette: useWiredCommandPaletteHook = useWiredCommandPalette,
}: CommandPaletteProps) {
  const t = useT();
  const palette = useWiredCommandPaletteHook({ items, onSelect, onClose, scopeKey });
  const listRef = useRef<HTMLDivElement | null>(null);
  const setInputRef = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
  }, []);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLDivElement>(`[data-idx="${palette.cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [palette.cursor]);

  const hasQuery = palette.query.trim().length > 0;
  const emptyLabel = hasQuery ? t('No matches') : t('No items');
  const resolvedPlaceholder = placeholder ?? t('Search…');

  return (
    <div className="jini-command-palette-overlay" onMouseDown={onClose} role="dialog" aria-modal="true">
      <div className="jini-command-palette" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={setInputRef}
          className="jini-command-palette__input"
          value={palette.query}
          onChange={(event) => palette.setQuery(event.target.value)}
          onKeyDown={palette.handleKeyDown}
          placeholder={resolvedPlaceholder}
          spellCheck={false}
          aria-label={resolvedPlaceholder}
        />
        <div className="jini-command-palette__list" ref={listRef} role="listbox">
          {palette.results.length === 0 ? (
            <div className="jini-command-palette__empty">{emptyLabel}</div>
          ) : (
            palette.results.map((result, index) => (
              <CommandPaletteRow
                key={result.item.id}
                result={result}
                index={index}
                active={index === palette.cursor}
                onHover={palette.setCursorTo}
                onSelect={palette.selectResult}
              />
            ))
          )}
        </div>
        <div className="jini-command-palette__footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t('Navigate')}</span>
          <span><kbd>↵</kbd> {t('Select')}</span>
          <span><kbd>esc</kbd> {t('Close')}</span>
        </div>
      </div>
    </div>
  );
}
