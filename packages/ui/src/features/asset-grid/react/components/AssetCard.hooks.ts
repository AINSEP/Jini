import { useCallback, type MouseEvent } from 'react';
import { resolveCheckboxClickAction, resolvePreviewClickAction } from '../../rules.js';
import type { AssetGridItem } from '../../types.js';
import type { AssetCardProps } from './AssetCard.js';

/** Preserve modifier-key selection and preview behavior for one asset. */
export function useAssetCard<TAsset extends AssetGridItem>({ asset, index, onToggle, onRange, onPreview }: Pick<AssetCardProps<TAsset>, 'asset' | 'index' | 'onToggle' | 'onRange' | 'onPreview'>, _options = {}) {
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
  return { handlePreviewClick, handleCheckboxClick };
}
