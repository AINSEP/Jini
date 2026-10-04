import { Notice } from '@jini-ai/ui-kit/react';
import type { TabViewProps } from '../../../react/bind-react.js';
import { useMarketplaceTab } from '../hooks/MarketplaceTab.hooks.js';
import { agentPluginsMessagesEn as m } from '../../messages.en.js';
export function MarketplaceTab(props: TabViewProps, _optional = {}) {
  const vm = useMarketplaceTab(props);
  return vm.denied ? <Notice tone="danger">{m.denied}</Notice> : <section aria-label="Agent Plugin Marketplace"><h2>{m.marketplaceTitle}</h2><p>{m.marketplaceDescription}</p><p>{m.marketplaceHint}</p><a href={vm.specUrl} target="_blank" rel="noreferrer">Read the package format</a></section>;
}
export default MarketplaceTab;
