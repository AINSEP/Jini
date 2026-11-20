import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { AgentPluginListPanel } from '../components/AgentPluginListPanel.js';
export function DownloadedTab(props: TabViewProps) { return <AgentPluginListPanel props={props} mode="downloaded" />; }
export default DownloadedTab;
