import type { ResourceCardProps } from './ResourceCard.js';

/** Choose selection or navigation when the card is activated. */
export function useResourceCard<TBody>({ item, selectMode, onOpen, onToggleSelected }: Pick<ResourceCardProps<TBody>, 'item' | 'selectMode' | 'onOpen' | 'onToggleSelected'>, _options = {}) {
  const handleActivate = () => {
    if (selectMode) onToggleSelected();
    else onOpen();
  };
  const menuActions = selectMode ? [] : (item.menuActions ?? []);
  return { handleActivate, menuActions };
}
