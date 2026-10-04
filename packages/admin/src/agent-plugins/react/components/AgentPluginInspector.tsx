import { Dialog, Notice } from '@jini-ai/ui-kit/react';
import { useAgentPluginInspector, type AgentPluginInspectorProps } from '../hooks/AgentPluginInspector.hooks.js';
import { AgentPluginFileTree } from './AgentPluginFileTree.js';
import { AgentPluginFileContent } from './AgentPluginFileContent.js';
import { agentPluginsMessagesEn as m } from '../../messages.en.js';
export function AgentPluginInspector(props: AgentPluginInspectorProps, _optional = {}) {
  const vm = useAgentPluginInspector(props);
  return <Dialog open title={vm.title} closeLabel="Close package files" onClose={props.onClose}>{vm.denied ? <Notice tone="danger">{m.denied}</Notice> : <>
    {vm.listNotice && <p role="note">{vm.listNotice}</p>}
    <AgentPluginFileTree files={vm.files} selectedPath={vm.selectedPath} onOpen={vm.select} />
    {vm.selected ? <AgentPluginFileContent key={vm.selected.relativePath} file={vm.selected} /> : vm.status && <p role={vm.status.role}>{vm.status.text}</p>}
  </>}</Dialog>;
}
