import type { TabViewProps } from '../../../react/bind-react.js';
import { AGENT_PLUGINS_READ, AGENT_PLUGINS_SPEC_URL } from '../../rules.js';
export function useMarketplaceTab({ permissions = [] }: TabViewProps, _optional = {}) { return { denied: !permissions.includes(AGENT_PLUGINS_READ), specUrl: AGENT_PLUGINS_SPEC_URL }; }
