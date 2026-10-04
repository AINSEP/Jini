import type { TabViewProps } from '../../../react/bind-react.js';
import { AgentPluginListPanel } from '../components/AgentPluginListPanel.js';
export function DownloadedTab(props: TabViewProps, _optional = {}) { return <AgentPluginListPanel props={props} mode="downloaded" />; }
export default DownloadedTab;
