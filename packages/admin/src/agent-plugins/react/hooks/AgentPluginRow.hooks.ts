import { useId } from 'react';
import type { AgentPluginRowView } from './AgentPluginPanel.hooks.js';
export function useAgentPluginRow({ row }: { row: AgentPluginRowView }, _optional = {}) {
  const detailId = useId();
  return { ...row, detailId, expandAttrs: { ...row.expandAttrs, 'aria-controls': detailId }, installed: row.mode === 'installed', detailHidden: !row.expanded };
}
