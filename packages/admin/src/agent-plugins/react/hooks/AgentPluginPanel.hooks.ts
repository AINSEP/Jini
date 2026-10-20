import type { TabViewProps } from '../../../core/react/bind-react.js';
import { agentPluginsMessagesEn as m } from '../../messages.en.js';
import type { AgentPluginSummary, AgentPluginsState } from '../../models.js';
import { AGENT_PLUGINS_READ, AGENT_PLUGINS_WRITE, AGENT_PLUGINS_SPEC_URL, humanizeAgentPluginId, agentPluginGlyphKind } from '../../rules.js';
import { useAgentPluginsPageScope, type AgentPluginsPageScope } from './AgentPluginsPage.hooks.js';
const glyphs = { compliance: '◈', deploy: '↗', design: '◇', integration: '⇄', content: '▤', package: '▣' };
type PanelMode = 'installed' | 'downloaded';
export function useAgentPluginPanel({ props, mode }: { props: TabViewProps; mode: PanelMode }, _optional = {}) {
  const { controller, snapshot: state, permissions, uninstallNoteId } = useAgentPluginsPageScope({});
  const { canRead, canWrite } = panelGrants({ permissions, granted: props.permissions ?? [] });
  const rows = panelRows({ state, canRead, controller, mode, canWrite, uninstallNoteId });
  return { denied: !canRead, mode, rows, ...panelStatus({ state, rowCount: rows.length }),
    ...panelCopy({ mode, params: props.params }),
    uninstallNoteId, specUrl: AGENT_PLUGINS_SPEC_URL,
    reload(_required: Record<string, never>, _optional = {}) { void controller?.load({}); },
  };
}
export type AgentPluginRowView = ReturnType<typeof useAgentPluginPanel>['rows'][number];
/** Both the page scope and the tab's own grants must allow an action. */
function panelGrants({ permissions, granted }: { permissions: readonly string[]; granted: readonly string[] }, _optional = {}) {
  const both = (permission: string) => permissions.includes(permission) && granted.includes(permission);
  const canRead = both(AGENT_PLUGINS_READ);
  return { canRead, canWrite: canRead && both(AGENT_PLUGINS_WRITE) };
}
function panelStatus({ state, rowCount }: { state: Readonly<AgentPluginsState> | null; rowCount: number }, _optional = {}) {
  return { loading: !state || (!state.plugins && !state.error), error: state?.error, actionError: state?.actionError, empty: !!state && state.plugins !== null && rowCount === 0 };
}
function panelCopy({ mode, params }: { mode: PanelMode; params: TabViewProps['params'] }, _optional = {}) {
  const installed = mode === 'installed';
  return { lede: installed ? m.installedLede : m.downloadedLede,
    label: installed ? 'Installed Agent Plugins' : 'Downloaded Agent Plugins',
    uninstallNotice: typeof params.uninstallNotice === 'string' ? params.uninstallNotice : m.uninstallUnavailable };
}
interface RowContext { readonly controller: AgentPluginsPageScope['controller']; readonly mode: PanelMode; readonly canWrite: boolean; readonly uninstallNoteId: string }
function panelRows({ state, canRead, ...context }: RowContext & { state: Readonly<AgentPluginsState> | null; canRead: boolean }, _optional = {}) {
  // Scope is intentionally unfiltered on BOTH tabs, including switched-off bundled packages.
  const busyIds = state?.busyIds ?? [], expandedIds = state?.expandedIds ?? [];
  return (canRead ? state?.plugins ?? [] : []).map(plugin => agentPluginRowView({ ...context, plugin, busy: busyIds.includes(plugin.pluginId), expanded: expandedIds.includes(plugin.pluginId) }));
}
function agentPluginRowView({ plugin, busy, expanded, controller, mode, canWrite, uninstallNoteId }: RowContext & { plugin: AgentPluginSummary; busy: boolean; expanded: boolean }, _optional = {}) {
  const name = humanizeAgentPluginId({ pluginId: plugin.pluginId });
  // Derived from the id alone, so handles survive sorting and switching tabs.
  const handle = `agent-plugin-${encodeURIComponent(plugin.pluginId)}`;
  const turnOff = () => controller?.requestDisable({ pluginId: plugin.pluginId, variant: mode === 'installed' ? 'disable' : 'remove' });
  // The switch and the button do the same thing: turning off asks first, enabling writes directly.
  const activate = () => { if (!canWrite) return; if (plugin.enabled) turnOff(); else void controller?.setEnabled({ pluginId: plugin.pluginId, enabled: true }); };
  const verb = plugin.enabled ? 'Turn off' : 'Enable';
  return {
    id: plugin.pluginId, name, version: plugin.version, description: plugin.description,
    glyph: glyphs[agentPluginGlyphKind({ plugin })], enabled: plugin.enabled, stateLabel: plugin.enabled ? 'Enabled' : 'Disabled',
    busy, expanded, mode, canWrite, toggleLabel: `${plugin.enabled ? 'Disable' : 'Enable'} ${name}`,
    actionLabel: `${verb} ${name}`, actionText: verb,
    skills: plugin.skills, keywords: plugin.keywords, servers: plugin.mcpServerIds,
    hasSkills: plugin.skills.length > 0, hasKeywords: plugin.keywords.length > 0, hasServers: plugin.mcpServerIds.length > 0,
    toggle(_required: { checked: boolean }, _optional = {}) { activate(); },
    act(_required: Record<string, never>, _optional = {}) { activate(); },
    expand(_required: Record<string, never>, _optional = {}) { controller?.toggleExpanded({ pluginId: plugin.pluginId }); },
    inspect(_required: Record<string, never>, _optional = {}) { controller?.inspect({ pluginId: plugin.pluginId }); },
    expandAttrs: { 'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${name}`, 'aria-expanded': expanded, 'data-agent-handle': `${handle}-expand` },
    actionAttrs: { 'aria-label': `${verb} ${name}`, 'data-agent-handle': `${handle}-activation` },
    inspectAttrs: { 'data-agent-handle': `${handle}-inspect` },
    uninstallAttrs: { 'aria-describedby': uninstallNoteId },
    inspectLabel: `Inspect ${name} package files`, uninstallLabel: `Uninstall ${name} — unavailable`,
  };
}
