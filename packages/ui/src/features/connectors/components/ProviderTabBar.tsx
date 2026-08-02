import { useT } from '../../i18n/index.js';
import type { ProviderTab } from '../types.js';

export interface ProviderTabBarProps {
  tabs: readonly ProviderTab[];
  selectedId: string;
  onSelect: (id: string) => void;
  ariaLabel?: string;
}

/** Config-driven provider-tab bar. A single-provider host still renders one tab. */
export function ProviderTabBar({ tabs, selectedId, onSelect, ariaLabel }: ProviderTabBarProps) {
  const t = useT();
  const resolvedAriaLabel = ariaLabel ?? t('Connector provider');
  return (
    <div className="connectors-provider-tabs" role="tablist" aria-label={resolvedAriaLabel}>
      {tabs.map((tab) => {
        const active = tab.id === selectedId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`connectors-provider-tab${active ? ' is-active' : ''}`}
            onClick={() => onSelect(tab.id)}
            data-testid={`connectors-provider-tab-${tab.id}`}
          >
            {t(tab.label)}
          </button>
        );
      })}
    </div>
  );
}
