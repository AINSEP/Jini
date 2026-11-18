import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { dayHeadingResult, groupByDay } from '../../rules.js';
import type { AssetGridItem, AssetGridViewMode } from '../../types.js';

export interface AssetGridBodyProps<TAsset extends AssetGridItem> {
  viewMode: AssetGridViewMode;
  assets: TAsset[];
  getDayKey: (asset: TAsset) => string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onMouseDown: (e: React.MouseEvent) => void;
  selecting: boolean;
  renderCard: (asset: TAsset, index: number) => ReactNode;
}

/**
 * Grid mode is one flat card grid; timeline mode groups the SAME cards into
 * day-bucketed sections (newest day first), each with a heading + count.
 * Both share `renderCard` and the caller's flat `index`, so shift-range /
 * rubber-band selection stays consistent whichever mode is active.
 */
export function AssetGridBody<TAsset extends AssetGridItem>({
  viewMode,
  assets,
  getDayKey,
  containerRef,
  onMouseDown,
  selecting,
  renderCard,
  useTHook = useT,
}: AssetGridBodyProps<TAsset> & { useTHook?: typeof useT }) {
  const t = useTHook();

  if (viewMode === 'timeline') {
    const groups = groupByDay({ items: assets, getDayKey });
    return (
      <div
        className="asset-grid-timeline"
        ref={containerRef}
        onMouseDown={onMouseDown}
        data-selecting={selecting ? 'true' : 'false'}
      >
        {groups.map((group) => {
          const heading = dayHeadingResult({ key: group.key });
          return (
            <section key={group.key} className="asset-grid-timeline-day">
              <div className="asset-grid-timeline-head">
                <span className="asset-grid-timeline-dot" aria-hidden />
                <h2 className="asset-grid-timeline-date">{heading.translatable ? t(heading.label) : heading.label}</h2>
                <span className="asset-grid-timeline-count">{group.items.length}</span>
              </div>
              <div className="asset-grid-timeline-grid">
                {group.items.map(({ asset, index }) => renderCard(asset, index))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="asset-grid-grid" ref={containerRef} onMouseDown={onMouseDown} data-selecting={selecting ? 'true' : 'false'}>
      {assets.map((asset, index) => renderCard(asset, index))}
    </div>
  );
}
