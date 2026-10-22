import { useCallback, type MouseEvent, type ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { useInView } from '../../../../react/hooks/useInView.js';
import { resolveCheckboxClickAction, resolvePreviewClickAction } from '../../rules.js';
import type { AssetGridItem } from '../../types.js';

export interface AssetCardProps<TAsset extends AssetGridItem> {
  asset: TAsset;
  /** This card's flat position in the current asset list — drives shift-range + rubber-band selection. */
  index: number;
  selected: boolean;
  title: string;
  subtitle?: string | undefined;
  kindLabel?: string | undefined;
  sourceLabel?: string | undefined;
  /** Host-supplied, kind-aware thumbnail. Mounted lazily once the card scrolls near the viewport. */
  renderThumbnail: (asset: TAsset) => ReactNode;
  /** Held in place of `renderThumbnail` until the card is in view. Defaults to nothing (an empty box). */
  renderThumbnailPlaceholder?: ((asset: TAsset) => ReactNode) | undefined;
  onToggle: (id: string, index: number) => void;
  onRange: (index: number) => void;
  onPreview: (id: string) => void;
  /** Generic single-asset delete. Omit to hide the built-in Remove action entirely. */
  onDeleteAsset?: ((id: string) => void) | undefined;
  /** Host-owned extra actions row (e.g. an "open origin" link) rendered alongside the generic Remove action. */
  renderCardExtra?: ((asset: TAsset) => ReactNode) | undefined;
}

function renderCardActions<TAsset extends AssetGridItem>(
  { asset, renderCardExtra, onDeleteAsset, t }: Pick<AssetCardProps<TAsset>, 'asset' | 'renderCardExtra' | 'onDeleteAsset'> & {
    t: ReturnType<typeof useT>;
  },
  _options: Record<string, never> = {},
) {
  if (!renderCardExtra && !onDeleteAsset) return null;
  return (
    <div className="asset-grid-card-actions">
      {renderCardExtra ? renderCardExtra(asset) : <span />}
      {onDeleteAsset ? (
        <button type="button" className="asset-grid-card-delete-btn" onClick={() => onDeleteAsset(asset.id)}>
          {t('Remove')}
        </button>
      ) : null}
    </div>
  );
}

export function AssetCard<TAsset extends AssetGridItem>({
  asset,
  index,
  selected,
  title,
  subtitle,
  kindLabel,
  sourceLabel,
  renderThumbnail,
  renderThumbnailPlaceholder,
  onToggle,
  onRange,
  onPreview,
  onDeleteAsset,
  renderCardExtra,
}: AssetCardProps<TAsset>) {
  const t = useT();
  const { ref, inView } = useInView<HTMLDivElement>({ once: true, rootMargin: '300px' });
  const selectionValue = selected ? 'true' : 'false';

  const handlePreviewClick = useCallback(
    (e: MouseEvent) => {
      const action = resolvePreviewClickAction(e);
      if (action === 'toggle') onToggle(asset.id, index);
      else if (action === 'range') onRange(index);
      else onPreview(asset.id);
    },
    [asset.id, index, onToggle, onRange, onPreview],
  );

  const handleCheckboxClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (resolveCheckboxClickAction(e) === 'range') onRange(index);
      else onToggle(asset.id, index);
    },
    [asset.id, index, onToggle, onRange],
  );

  return (
    <figure
      className="asset-grid-card"
      // Must stay in sync with `ASSET_ID_ATTR` in ../../constants.ts — the
      // rubber-band hit-tester reads this literal attribute name.
      data-asset-grid-id={asset.id}
      data-selected={selectionValue}
    >
      <div className="asset-grid-card-thumb">
        <div ref={ref} className="asset-grid-card-thumb-lazy">
          {inView ? renderThumbnail(asset) : (renderThumbnailPlaceholder?.(asset) ?? null)}
        </div>
        <button
          type="button"
          className="asset-grid-card-preview-btn"
          onClick={handlePreviewClick}
          aria-label={t('Preview {title}', { title })}
        >
          <span className="asset-grid-card-preview-overlay" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
        </button>
        <button
          type="button"
          className="asset-grid-card-select-check"
          data-checked={selectionValue}
          aria-pressed={selected}
          aria-label={selected ? t('Deselect asset') : t('Select asset')}
          onClick={handleCheckboxClick}
        >
          {selected ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : null}
        </button>
        {sourceLabel ? (
          <span className="asset-grid-card-badge" data-badge="source">
            {sourceLabel}
          </span>
        ) : null}
        {kindLabel ? (
          <span className="asset-grid-card-badge" data-badge="kind">
            {kindLabel}
          </span>
        ) : null}
      </div>
      <figcaption className="asset-grid-card-meta">
        <button type="button" className="asset-grid-card-title" title={title} onClick={() => onPreview(asset.id)}>
          {title}
        </button>
        {subtitle ? <span className="asset-grid-card-subtitle">{subtitle}</span> : null}
      </figcaption>
      {renderCardActions({ asset, renderCardExtra, onDeleteAsset, t })}
    </figure>
  );
}
