import { Dialog, Notice } from '../../../react/kit.js';
import { useAgentPluginInspector, type AgentPluginInspectorProps } from '../hooks/AgentPluginInspector.hooks.js';
import { AgentPluginFileTree } from './AgentPluginFileTree.js';
import { AgentPluginFileContent } from './AgentPluginFileContent.js';
import { agentPluginsMessagesEn as m } from '../../messages.en.js';
export function AgentPluginInspector({ useAgentPluginInspectorHook = useAgentPluginInspector, ...props }: AgentPluginInspectorProps & { useAgentPluginInspectorHook?: typeof useAgentPluginInspector }) {
  const vm = useAgentPluginInspectorHook(props);
  if (vm.denied) return <Dialog open title={vm.title} closeLabel="Close package files" onClose={props.onClose}><Notice tone="danger">{m.denied}</Notice></Dialog>;
  const status = vm.status && <p role={vm.status.role}>{vm.status.text}</p>;
  return <Dialog open title={vm.title} closeLabel="Close package files" onClose={props.onClose}>
    {vm.listNotice && <p role="note">{vm.listNotice}</p>}
    <AgentPluginFileTree files={vm.files} selectedPath={vm.selectedPath} onOpen={vm.select} />
    {vm.selected ? <AgentPluginFileContent key={vm.selected.relativePath} file={vm.selected} /> : status}
  </Dialog>;
}
