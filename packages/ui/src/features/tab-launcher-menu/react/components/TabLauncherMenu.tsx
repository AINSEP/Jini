import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../../i18n/index.js';
import { ALL_KIND_FILTER } from '../../constants.js';
import { useTabLauncherMenu, type UseTabLauncherMenuOptions } from '../hooks/useTabLauncherMenu.js';
import { TabLauncherActionRow } from './TabLauncherActionRow.js';
import { TabLauncherResultRow, type TabLauncherResultRowProps } from './TabLauncherResultRow.js';

export interface TabLauncherMenuProps<TActionCtx = void> extends UseTabLauncherMenuOptions<TActionCtx> {
  searchPlaceholder?: string;
  renderIcon?: (iconName: string | undefined) => ReactNode;
  renderSearchIcon?: () => ReactNode;
  /** Custom hook override for dependency injection / testing. */
  useTabLauncherMenu?: typeof useTabLauncherMenu;
}

function renderResultSection(
  { items, renderLabel, startIndex, selected, ...rowProps }: Pick<TabLauncherResultRowProps, 'openLabel' | 'onHover' | 'onSelect'> & {
    items: readonly TabLauncherResultRowProps['item'][];
    renderLabel: () => string;
    startIndex: number;
    selected: number;
  },
  { renderIcon }: Pick<TabLauncherResultRowProps, 'renderIcon'> = {},
) {
  if (items.length === 0) return null;
  return (
    <section className="jini-tab-launcher-menu__section">
      <div className="jini-tab-launcher-menu__section-header">{renderLabel()}</div>
      <ul className="jini-tab-launcher-menu__list">
        {items.map((item, index) => {
          const selectableIndex = startIndex + index;
          return (
            <TabLauncherResultRow
              key={item.id}
              item={item}
              selectableIndex={selectableIndex}
              selected={selectableIndex === selected}
              renderIcon={renderIcon}
              {...rowProps}
            />
          );
        })}
      </ul>
    </section>
  );
}

/**
 * An anchored, portal-rendered command-palette dropdown for a tab strip's
 * "+" button: viewport-clamped fixed positioning off an anchor element,
 * outside-click/Escape dismiss, text search + kind-filter chips over file
 * results, a separate "open tabs" search, and a "create new" action list —
 * all as one flat keyboard-navigable selection.
 *
 * Origin: `TabLauncherMenu.tsx` (`apps/web/src/components/workspace/`). Its
 * `ProjectFile`/`WorkspaceContextItem` split collapses into one generic
 * `TabLauncherResultItem`; `LauncherAction`/`LauncherContext` become
 * `TabLauncherAction<TActionCtx>` generic over whatever context the host's
 * actions need; the OD analytics contract (`TabLauncherClickProps`) becomes
 * a generic `TabLauncherTrackEvent` union. See `packages/ui/source-map.md`
 * for the full genericization writeup, including why this is a distinct
 * primitive from `features/command-palette/`.
 */
export function TabLauncherMenu<TActionCtx = void>({
  searchPlaceholder,
  renderIcon,
  renderSearchIcon,
  useTabLauncherMenu: useTabLauncherMenuHook = useTabLauncherMenu,
  ...options
}: TabLauncherMenuProps<TActionCtx>) {
  const t = useT();
  const menu = useTabLauncherMenuHook(options);

  useEffect(() => {
    const el = menu.containerRef.current?.querySelector<HTMLElement>(`[data-selectable-idx="${menu.selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [menu.selected, menu.containerRef]);

  // `position` only becomes non-null once the anchored-positioning effect
  // runs against a real `anchor`, which requires a real DOM — so this alone
  // already keeps the portal (and its `document.body` reference) from ever
  // running during SSR, with no separate `typeof document` check needed.
  if (!menu.position) return null;

  const openLabel = t('Open');
  const hasResults = menu.fileResults.length > 0 || menu.tabResults.length > 0;

  return createPortal(
    <div
      ref={menu.containerRef}
      className="jini-tab-launcher-menu"
      style={{ top: menu.position.top, left: menu.position.left }}
      role="dialog"
      aria-label={t('New tab')}
    >
      <div className="jini-tab-launcher-menu__search-row">
        {renderSearchIcon ? <span className="jini-tab-launcher-menu__search-icon" aria-hidden="true">{renderSearchIcon()}</span> : null}
        <input
          autoFocus
          className="jini-tab-launcher-menu__search-input"
          type="text"
          value={menu.query}
          placeholder={searchPlaceholder ?? t('Search files…')}
          onChange={(event) => menu.setQuery(event.target.value)}
          onKeyDown={menu.handleInputKeyDown}
        />
      </div>

      {menu.presentKinds.length > 0 ? (
        <div className="jini-tab-launcher-menu__chips">
          <button
            type="button"
            className={`jini-tab-launcher-menu__chip${menu.kindFilter === ALL_KIND_FILTER ? ' jini-tab-launcher-menu__chip--active' : ''}`}
            onClick={() => menu.setKindFilter(ALL_KIND_FILTER)}
          >
            {t('All files')}
          </button>
          {menu.presentKinds.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`jini-tab-launcher-menu__chip${menu.kindFilter === kind ? ' jini-tab-launcher-menu__chip--active' : ''}`}
              onClick={() => menu.setKindFilter(kind)}
            >
              {kind}
            </button>
          ))}
        </div>
      ) : null}

      <div className="jini-tab-launcher-menu__scroll-body">
        {menu.actions.length > 0 ? (
          <section className="jini-tab-launcher-menu__section">
            <div className="jini-tab-launcher-menu__section-header">{t('Create new')}</div>
            <ul className="jini-tab-launcher-menu__list">
              {menu.actions.map((action) => (
                <TabLauncherActionRow key={action.id} action={action} onSelect={menu.runAction} renderIcon={renderIcon} />
              ))}
            </ul>
          </section>
        ) : null}

        {renderResultSection({
          items: menu.fileResults,
          renderLabel: () => t('Open file'),
          startIndex: 0,
          selected: menu.selected,
          openLabel,
          onHover: menu.setSelected,
          onSelect: menu.selectFile,
        }, { renderIcon })}

        {renderResultSection({
          items: menu.tabResults,
          renderLabel: () => t('Open tabs'),
          startIndex: menu.fileResults.length,
          selected: menu.selected,
          openLabel,
          onHover: menu.setSelected,
          onSelect: menu.selectTab,
        }, { renderIcon })}

        {!hasResults ? <div className="jini-tab-launcher-menu__empty">{t('No files match')}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
