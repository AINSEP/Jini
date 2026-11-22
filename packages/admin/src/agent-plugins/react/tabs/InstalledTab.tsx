import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { AgentPluginListPanel } from '../components/AgentPluginListPanel.js';
export function InstalledTab(props: TabViewProps) { return <AgentPluginListPanel props={props} mode="installed" />; }
export default InstalledTab;
