import type { TabViewProps } from '../../../react/bind-react.js';
import { AgentPluginListPanel } from '../components/AgentPluginListPanel.js';
export function InstalledTab(props: TabViewProps, _optional = {}) { return <AgentPluginListPanel props={props} mode="installed" />; }
export default InstalledTab;
