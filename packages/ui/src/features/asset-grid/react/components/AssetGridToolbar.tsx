import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { ALL_FACET_VALUE } from '../../constants.js';
import type { AssetGridFacetOption, AssetGridViewMode } from '../../types.js';

export interface AssetGridToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string | undefined;
  kind: string;
  onKindChange: (value: string) => void;
  kindFacets: AssetGridFacetOption[];
  kindFacetsLabel?: string | undefined;
  source: string;
  onSourceChange: (value: string) => void;
  sourceFacets: AssetGridFacetOption[];
  sourceFacetsLabel?: string | undefined;
  viewMode: AssetGridViewMode;
  onViewModeChange: (mode: AssetGridViewMode) => void;
  onRefresh: () => void;
  loading: boolean;
  /** Host-specific extra toolbar controls (e.g. an Upload button), rendered after the built-in controls. */
  toolbarActions?: ReactNode;
  useTHook?: typeof useT;
}

type Facets = AssetGridToolbarProps['kindFacets'];

/** A facet filter `<select>`; renders nothing when the host supplied no facets. */
function FacetSelect({ facets, label, value, onChange }: {
  facets: Facets; label: string; value: string; onChange: (value: string) => void;
}) {
  if (facets.length === 0) return null;
  return (
    <select aria-label={label} className="asset-grid-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {facets.map((f) => (
        <option key={f.value || ALL_FACET_VALUE} value={f.value}>
          {f.label}
        </option>
      ))}
    </select>
  );
}

/** Grid / timeline switch. */
function ViewModeToggle({ viewMode, onViewModeChange, useTHook = useT }: {
  viewMode: AssetGridViewMode; onViewModeChange: (mode: AssetGridViewMode) => void;
  useTHook?: typeof useT;
}) {
  const t = useTHook();
  return (
    <div className="asset-grid-view-toggle" role="group" aria-label={t('View mode')}>
      <button
        type="button"
        className="asset-grid-view-toggle-btn"
        data-active={viewMode === 'grid' ? 'true' : 'false'}
        aria-pressed={viewMode === 'grid'}
        onClick={() => onViewModeChange('grid')}
      >
        <Icon name="grid" size={14} />
        {t('Grid')}
      </button>
      <button
        type="button"
        className="asset-grid-view-toggle-btn"
        data-active={viewMode === 'timeline' ? 'true' : 'false'}
        aria-pressed={viewMode === 'timeline'}
        onClick={() => onViewModeChange('timeline')}
      >
        <Icon name="history" size={14} />
        {t('Timeline')}
      </button>
    </div>
  );
}

export function AssetGridToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  kind,
  onKindChange,
  kindFacets,
  kindFacetsLabel,
  source,
  onSourceChange,
  sourceFacets,
  sourceFacetsLabel,
  viewMode,
  onViewModeChange,
  onRefresh,
  loading,
  toolbarActions,
  useTHook = useT,
}: AssetGridToolbarProps) {
  const t = useTHook();

  return (
    <div className="asset-grid-toolbar">
      <div className="asset-grid-search-wrap">
        <Icon name="search" size={15} className="asset-grid-search-icon" />
        <input
          className="asset-grid-search"
          type="search"
          placeholder={searchPlaceholder ?? t('Search…')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label={t('Search')}
        />
      </div>
      <FacetSelect facets={kindFacets} label={kindFacetsLabel ?? t('Filter by kind')} value={kind} onChange={onKindChange} />
      <FacetSelect facets={sourceFacets} label={sourceFacetsLabel ?? t('Filter by source')} value={source} onChange={onSourceChange} />
      <ViewModeToggle viewMode={viewMode} onViewModeChange={onViewModeChange} />
      <button
        type="button"
        className="asset-grid-refresh-btn"
        onClick={onRefresh}
        aria-busy={loading}
        aria-label={t('Refresh')}
      >
        <Icon name="refresh" size={15} className={loading ? 'asset-grid-spin' : undefined} />
        {t('Refresh')}
      </button>
      {toolbarActions}
    </div>
  );
}
