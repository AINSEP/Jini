import { Badge, Button, IconButton, Switch } from '@jini-ai/ui-kit/react';
import type { AgentPluginRowView } from '../hooks/AgentPluginPanel.hooks.js';
import { useAgentPluginRow } from '../hooks/AgentPluginRow.hooks.js';
export function AgentPluginRow({ row }: { row: AgentPluginRowView }, _optional = {}) {
  const vm = useAgentPluginRow({ row });
  return <li data-jini-part="agent-plugins.row"><span aria-hidden>{vm.glyph}</span><h3>{vm.name} {vm.version && <small>{vm.version}</small>}</h3>
    {vm.description && <p>{vm.description}</p>}
    <Badge>{vm.stateLabel}</Badge>
    {vm.installed ? <Switch label={vm.toggleLabel} checked={vm.enabled} disabled={!vm.canWrite || vm.busy} onCheckedChange={vm.toggle} /> : <Button attrs={vm.actionAttrs} disabled={!vm.canWrite || vm.busy} pending={vm.busy} onPress={vm.act}>{vm.actionText}</Button>}
    <Button attrs={vm.expandAttrs} onPress={vm.expand}>Details</Button><IconButton label={vm.inspectLabel} attrs={vm.inspectAttrs} onPress={vm.inspect}>Inspect</IconButton>
    <IconButton label={vm.uninstallLabel} attrs={vm.uninstallAttrs} disabled>Uninstall</IconButton>
    <div id={vm.detailId} hidden={vm.detailHidden}>
      {vm.description && <p>{vm.description}</p>}
      {vm.hasSkills && <section aria-label="Portable components"><h4>Portable components</h4><ul>{vm.skills.map(skill => <li key={skill.name}><strong>{skill.name}</strong><p>{skill.summary}</p></li>)}</ul></section>}
      {vm.hasServers && <section aria-label="MCP servers"><h4>MCP servers</h4><ul>{vm.servers.map(id => <li key={id}>{id}</li>)}</ul></section>}
      {vm.hasKeywords && <section aria-label="Keywords"><h4>Keywords</h4><ul>{vm.keywords.map(word => <li key={word}>{word}</li>)}</ul></section>}
    </div>
  </li>;
}
