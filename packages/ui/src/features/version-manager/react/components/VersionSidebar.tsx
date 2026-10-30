import { useT } from '../../../i18n/index.js';
import type { VersionRecord } from '../../types.js';

export interface VersionSidebarProps<TVersion extends VersionRecord> {
  countLabel: string;
  search: string;
  onSearchChange: (value: string) => void;
  showSearch: boolean;
  loading: boolean;
  versions: TVersion[];
  visibleVersions: TVersion[];
  selectedVersionId: string | null;
  onSelect: (id: string) => void;
  onPrefetch: (id: string) => void;
  formatDate: (version: TVersion) => string;
  sourceLabel: (version: TVersion) => string;
  sourceClassName: (version: TVersion) => string;
  restoredFrom: (version: TVersion) => TVersion | null;
}

/** The version list + search box half of the modal — sidebar navigation,
 *  independent of whatever the preview pane is doing. */
export function VersionSidebar<TVersion extends VersionRecord>({
  countLabel,
  search,
  onSearchChange,
  showSearch,
  loading,
  versions,
  visibleVersions,
  selectedVersionId,
  onSelect,
  onPrefetch,
  formatDate,
  sourceLabel,
  sourceClassName,
  restoredFrom,
}: VersionSidebarProps<TVersion>) {
  const t = useT();
  const noResultsMessage = visibleVersions.length === 0 ? t('No results for “{query}”.', { query: search.trim() }) : null;
  const emptyMessage = versions.length === 0 ? t('No versions yet.') : noResultsMessage;

  return (
    <div className="jini-version-sidebar">
      <div className="jini-version-sidebar-head">
        <span className="jini-version-count">{countLabel}</span>
      </div>
      {showSearch ? (
        <div className="jini-version-search">
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('Search…')}
            aria-label={t('Search…')}
          />
          {search ? (
            <button
              type="button"
              className="jini-version-search-clear"
              aria-label={t('Clear')}
              onClick={() => onSearchChange('')}
            >
              {t('Clear')}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="jini-version-list" role="listbox" aria-label={t('Version history')}>
        {loading ? (
          <div className="jini-version-skeleton-list" role="status" aria-label={t('Loading versions…')}>
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="jini-version-skeleton-item" aria-hidden="true" />
            ))}
          </div>
        ) : null}
        {!loading && emptyMessage ? <div className="jini-version-empty">{emptyMessage}</div> : null}
        {!loading && !emptyMessage ? (
          visibleVersions.map((version) => {
            const selected = version.id === selectedVersionId;
            const itemRestoredFrom = restoredFrom(version);
            const prefetch = () => onPrefetch(version.id);
            return (
              <button
                key={version.id}
                type="button"
                className={`jini-version-item${selected ? ' active' : ''}`}
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(version.id)}
                onMouseEnter={prefetch}
                onFocus={prefetch}
              >
                <span className="jini-version-item-top">
                  {version.current ? <span className="jini-version-current-badge">{t('Current')}</span> : null}
                  <span className={`jini-version-source-badge ${sourceClassName(version)}`}>
                    {sourceLabel(version)}
                  </span>
                  <span className="jini-version-time">{formatDate(version)}</span>
                </span>
                <span className="jini-version-item-title">
                  {version.prompt || version.label || t('Version {version}', { version: version.version })}
                </span>
                <span className="jini-version-item-meta">
                  {t('Version {version}', { version: version.version })}
                  {itemRestoredFrom ? (
                    <span className="jini-version-item-restored">
                      {t('Restored from v{version}', { version: itemRestoredFrom.version })}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })
        ) : null}
      </div>
    </div>
  );
}
