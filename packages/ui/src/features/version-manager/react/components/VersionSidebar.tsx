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

function VersionSearchBox({ search, onSearchChange, useTHook = useT }: Pick<VersionSidebarProps<VersionRecord>, 'search' | 'onSearchChange'> & { useTHook?: typeof useT }) {
  const t = useTHook();
  return (
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
  );
}

function VersionSkeletonList({ useTHook = useT }: { useTHook?: typeof useT } = {}) {
  const t = useTHook();
  return (
    <div className="jini-version-skeleton-list" role="status" aria-label={t('Loading versions…')}>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="jini-version-skeleton-item" aria-hidden="true" />
      ))}
    </div>
  );
}

interface VersionSidebarItemProps<TVersion extends VersionRecord>
  extends Pick<
    VersionSidebarProps<TVersion>,
    'onSelect' | 'onPrefetch' | 'formatDate' | 'sourceLabel' | 'sourceClassName' | 'restoredFrom'
  > {
  version: TVersion;
  selected: boolean;
}

function VersionSidebarItem<TVersion extends VersionRecord>({
  version,
  selected,
  onSelect,
  onPrefetch,
  formatDate,
  sourceLabel,
  sourceClassName,
  restoredFrom,
  useTHook = useT,
}: VersionSidebarItemProps<TVersion> & { useTHook?: typeof useT }) {
  const t = useTHook();
  const itemRestoredFrom = restoredFrom(version);
  const prefetch = () => onPrefetch(version.id);
  return (
    <button
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
        <span className={`jini-version-source-badge ${sourceClassName(version)}`}>{sourceLabel(version)}</span>
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
  useTHook = useT,
}: VersionSidebarProps<TVersion> & { useTHook?: typeof useT }) {
  const t = useTHook();
  const noResultsMessage = visibleVersions.length === 0 ? t('No results for “{query}”.', { query: search.trim() }) : null;
  const emptyMessage = versions.length === 0 ? t('No versions yet.') : noResultsMessage;

  return (
    <div className="jini-version-sidebar">
      <div className="jini-version-sidebar-head">
        <span className="jini-version-count">{countLabel}</span>
      </div>
      {showSearch ? <VersionSearchBox search={search} onSearchChange={onSearchChange} /> : null}
      <div className="jini-version-list" role="listbox" aria-label={t('Version history')}>
        {loading ? <VersionSkeletonList /> : null}
        {!loading && emptyMessage ? <div className="jini-version-empty">{emptyMessage}</div> : null}
        {!loading && !emptyMessage ? (
          visibleVersions.map((version) => (
            <VersionSidebarItem
              key={version.id}
              version={version}
              selected={version.id === selectedVersionId}
              onSelect={onSelect}
              onPrefetch={onPrefetch}
              formatDate={formatDate}
              sourceLabel={sourceLabel}
              sourceClassName={sourceClassName}
              restoredFrom={restoredFrom}
            />
          ))
        ) : null}
      </div>
    </div>
  );
}
