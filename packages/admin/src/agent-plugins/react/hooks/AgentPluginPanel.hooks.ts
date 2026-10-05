import type { TabViewProps } from '../../../react/bind-react.js';
import { agentPluginsMessagesEn as m } from '../../messages.en.js';
import { AGENT_PLUGINS_READ, AGENT_PLUGINS_WRITE, AGENT_PLUGINS_SPEC_URL, humanizeAgentPluginId, agentPluginGlyphKind } from '../../rules.js';
import { useAgentPluginsPageScope } from './AgentPluginsPage.hooks.js';
const glyphs = { compliance: '◈', deploy: '↗', design: '◇', integration: '⇄', content: '▤', package: '▣' };
export function useAgentPluginPanel({ props, mode }: { props: TabViewProps; mode: 'installed' | 'downloaded' }, _optional = {}) {
  const { controller, snapshot: state, permissions, uninstallNoteId } = useAgentPluginsPageScope({});
  const canRead = permissions.includes(AGENT_PLUGINS_READ) && !!props.permissions?.includes(AGENT_PLUGINS_READ);
  const canWrite = canRead && permissions.includes(AGENT_PLUGINS_WRITE) && !!props.permissions?.includes(AGENT_PLUGINS_WRITE);
  // Scope is intentionally unfiltered on BOTH tabs, including switched-off bundled packages.
  const busyIds = state?.busyIds ?? [], expandedIds = state?.expandedIds ?? [];
  const rows = (canRead ? state?.plugins ?? [] : []).map(plugin => {
    const name = humanizeAgentPluginId({ pluginId: plugin.pluginId }), busy = busyIds.includes(plugin.pluginId);
    const expanded = expandedIds.includes(plugin.pluginId);
    // Derived from the id alone, so handles survive sorting and switching tabs.
    const handle = `agent-plugin-${encodeURIComponent(plugin.pluginId)}`;
    const turnOff = () => controller?.requestDisable({ pluginId: plugin.pluginId, variant: mode === 'installed' ? 'disable' : 'remove' });
    return {
      id: plugin.pluginId, name, version: plugin.version, description: plugin.description,
      glyph: glyphs[agentPluginGlyphKind({ plugin })], enabled: plugin.enabled, stateLabel: plugin.enabled ? 'Enabled' : 'Disabled',
      busy, expanded, mode, canWrite, toggleLabel: `${plugin.enabled ? 'Disable' : 'Enable'} ${name}`,
      actionLabel: `${plugin.enabled ? 'Turn off' : 'Enable'} ${name}`, actionText: plugin.enabled ? 'Turn off' : 'Enable',
      skills: plugin.skills, keywords: plugin.keywords, servers: plugin.mcpServerIds,
      hasSkills: plugin.skills.length > 0, hasKeywords: plugin.keywords.length > 0, hasServers: plugin.mcpServerIds.length > 0,
      toggle(_required: { checked: boolean }, _optional = {}) { if (!canWrite) return; if (plugin.enabled) turnOff(); else void controller?.setEnabled({ pluginId: plugin.pluginId, enabled: true }); },
      act(_required: Record<string, never>, _optional = {}) { if (!canWrite) return; if (plugin.enabled) turnOff(); else void controller?.setEnabled({ pluginId: plugin.pluginId, enabled: true }); },
      expand(_required: Record<string, never>, _optional = {}) { controller?.toggleExpanded({ pluginId: plugin.pluginId }); },
      inspect(_required: Record<string, never>, _optional = {}) { controller?.inspect({ pluginId: plugin.pluginId }); },
      expandAttrs: { 'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${name}`, 'aria-expanded': expanded, 'data-agent-handle': `${handle}-expand` },
      actionAttrs: { 'aria-label': `${plugin.enabled ? 'Turn off' : 'Enable'} ${name}`, 'data-agent-handle': `${handle}-activation` },
      inspectAttrs: { 'data-agent-handle': `${handle}-inspect` },
      uninstallAttrs: { 'aria-describedby': uninstallNoteId },
      inspectLabel: `Inspect ${name} package files`, uninstallLabel: `Uninstall ${name} — unavailable`,
    };
  });
  return { denied: !canRead, mode, rows, loading: !state || (!state.plugins && !state.error), error: state?.error, actionError: state?.actionError, empty: !!state && state.plugins !== null && rows.length === 0,
    lede: mode === 'installed' ? m.installedLede : m.downloadedLede,
    label: mode === 'installed' ? 'Installed Agent Plugins' : 'Downloaded Agent Plugins',
    uninstallNotice: typeof props.params.uninstallNotice === 'string' ? props.params.uninstallNotice : m.uninstallUnavailable,
    uninstallNoteId, specUrl: AGENT_PLUGINS_SPEC_URL,
    reload(_required: Record<string, never>, _optional = {}) { void controller?.load({}); },
  };
}
export type AgentPluginRowView = ReturnType<typeof useAgentPluginPanel>['rows'][number];
