import type { AgentPluginPackageFile } from '../../models.js';
import { useAgentPluginFileTree } from '../hooks/AgentPluginInspector.hooks.js';
export function AgentPluginFileTree({ files, selectedPath, onOpen }: { files: readonly AgentPluginPackageFile[]; selectedPath: string | null; onOpen: (required: { path: string }) => void }, _optional = {}) {
  const vm = useAgentPluginFileTree({ files, selectedPath, onOpen });
  return <div ref={vm.treeRef} role="tree" aria-label="Package files" onKeyDown={vm.onKeyDown}>{vm.rows.map(row => <div key={row.key} role="treeitem" aria-label={row.name} aria-level={row.depth} aria-setsize={row.setSize} aria-posinset={row.posInSet} aria-expanded={row.expanded} aria-selected={row.selected} tabIndex={row.tabIndex} title={row.path} data-tree-path={row.path} style={row.indent} onClick={row.onClick} onFocus={row.onFocus}><span aria-hidden>{row.icon} </span>{row.name}</div>)}</div>;
}
