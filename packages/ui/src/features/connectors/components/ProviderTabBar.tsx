import { agentHandleProps, buildAgentListHandles } from '@jini-ai/agentic';
import { useT } from '../../i18n/index.js';
import type { ProviderTab } from '../types.js';

export interface ProviderTabBarProps {
  tabs: readonly ProviderTab[];
  selectedId: string;
  onSelect: (id: string) => void;
  ariaLabel?: string;
  /** This bar's own agent handle — see `ConnectorsBrowser`'s `agentHandle` doc. One distinct
   *  sub-handle per provider tab, derived from the tab's own id. */
  agentHandle?: string;
}

/** Config-driven provider-tab bar. A single-provider host still renders one tab. */
export function ProviderTabBar({ tabs, selectedId, onSelect, ariaLabel, agentHandle }: ProviderTabBarProps) {
  const t = useT();
  const resolvedAriaLabel = ariaLabel ?? t('Connector provider');
  const tabHandles = agentHandle ? buildAgentListHandles(agentHandle, tabs.map((tab) => tab.id)) : undefined;
  return (
    <div className="connectors-provider-tabs" role="tablist" aria-label={resolvedAriaLabel}>
      {tabs.map((tab, index) => {
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
            {...agentHandleProps(tabHandles?.[index], { role: 'button', label: t(tab.label) })}
          >
            {t(tab.label)}
          </button>
        );
      })}
    </div>
  );
}
