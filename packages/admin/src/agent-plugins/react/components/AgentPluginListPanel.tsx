import { Button, Notice, Spinner } from '@jini-ai/ui-kit/react';
import type { TabViewProps } from '../../../react/bind-react.js';
import { useAgentPluginPanel } from '../hooks/AgentPluginPanel.hooks.js';
import { AgentPluginRow } from './AgentPluginRow.js';
import { agentPluginsMessagesEn as m } from '../../messages.en.js';
export function AgentPluginListPanel({ props, mode }: { props: TabViewProps; mode: 'installed' | 'downloaded' }, _optional = {}) {
  const vm = useAgentPluginPanel({ props, mode });
  return vm.denied ? <Notice tone="danger">{m.denied}</Notice> : <section aria-label={vm.label}><p>{vm.lede}</p>
    {vm.error && <Notice tone="danger">{vm.error}</Notice>}{vm.loading && <Spinner label={m.loading} />}
    {vm.actionError && <p role="alert">{vm.actionError}</p>}{vm.empty && <p role="status">{m.empty}</p>}
    <Button onPress={vm.reload}>Reload packages</Button><ul>{vm.rows.map(row => <AgentPluginRow key={row.id} row={row} />)}</ul>
    <p id={vm.uninstallNoteId}>{vm.uninstallNotice}</p><p>Package format: <a href={vm.specUrl} target="_blank" rel="noreferrer">Agent Plugins open standard</a></p>
  </section>;
}
