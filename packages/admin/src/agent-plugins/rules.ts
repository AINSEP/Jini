import type { AgentPluginSummary, AgentPluginFiles, AgentPluginPackageFile, AgentPluginDisableRequest } from './models.js';
import { buildPackageFileTree, firstPackageFilePath } from './package-file-tree.js';

export const AGENT_PLUGINS_READ = 'admin.plugins.read';
export const AGENT_PLUGINS_WRITE = 'admin.plugins.enable';
export const AGENT_PLUGINS_SPEC_URL = 'https://agent-plugins.org/specification';
// Closed vocabulary: no heuristic can distinguish an acronym from a real word reliably.
const acronyms = new Set(['ai', 'api', 'cli', 'css', 'html', 'http', 'id', 'io', 'json', 'mcp', 'rss', 'sdk', 'seo', 'sql', 'ui', 'url', 'ux', 'yaml']);
export function humanizeAgentPluginId({ pluginId }: { pluginId: string }, _optional = {}) {
  return pluginId.split('-').filter(Boolean).map(part => acronyms.has(part.toLowerCase()) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
/** Only wire metadata enters snapshots; never leak lifecycle paths or extra server properties. */
export function agentPluginSummary({ row }: { row: AgentPluginSummary }, _optional = {}): AgentPluginSummary {
  return Object.freeze({ pluginId: row.pluginId, version: row.version ?? null, description: row.description ?? null, keywords: Object.freeze([...row.keywords]), skills: Object.freeze(row.skills.map(s => Object.freeze({ name: s.name, summary: s.summary }))), mcpServerIds: Object.freeze([...row.mcpServerIds]), enabled: row.enabled });
}
export function agentPluginFilesSnapshot({ listing }: { listing: AgentPluginFiles }, _optional = {}): AgentPluginFiles {
  return Object.freeze({ pluginId: listing.pluginId, files: Object.freeze(listing.files.map(f => Object.freeze({ relativePath: f.relativePath, sizeBytes: f.sizeBytes, content: f.content, omitted: f.omitted }))), truncated: listing.truncated, limits: Object.freeze({ maxFiles: listing.limits.maxFiles, maxEntries: listing.limits.maxEntries, maxFileBytes: listing.limits.maxFileBytes, maxTotalBytes: listing.limits.maxTotalBytes }) });
}
export function selectAgentPluginFile({ files, path }: { files: readonly AgentPluginPackageFile[]; path: string }, _optional = {}) {
  const selected = files.find(f => f.relativePath === path);
  if (selected) return selected;
  const first = firstPackageFilePath({ nodes: buildPackageFileTree({ paths: files.map(f => f.relativePath) }) });
  return files.find(f => f.relativePath === first) ?? files[0] ?? null;
}
const omissions = { binary: 'Binary file — not shown.', 'too-large': 'Too large to show here.', symlink: 'Symbolic link — not followed.', unreadable: 'This file could not be read.' };
export function agentPluginFileNotice({ file }: { file: AgentPluginPackageFile }, _optional = {}) {
  return file.omitted === null && file.content !== null ? null : omissions[file.omitted ?? 'unreadable'] ?? omissions.unreadable;
}
/** Confirmation names the target and workspace effect; Turn off never implies file deletion. */
export function agentPluginDisableCopy({ pluginId, variant }: AgentPluginDisableRequest, _optional = {}) {
  const name = humanizeAgentPluginId({ pluginId });
  return { title: variant === 'remove' ? `Turn off ${name}?` : `Disable ${name} for this workspace?`, confirmLabel: variant === 'remove' ? 'Turn off' : 'Disable', body: 'Its skills stop reaching the assistant on the next run. The package stays on disk, remains listed on both tabs, and can be enabled again.' };
}
export type AgentPluginGlyphKind = 'compliance' | 'deploy' | 'design' | 'integration' | 'content' | 'package';
const vocabulary: readonly (readonly [AgentPluginGlyphKind, readonly string[]])[] = [
  ['compliance', ['compliance', 'privacy', 'gdpr', 'ccpa', 'cpra', 'consent', 'security', 'audit', 'wcag', 'accessibility']],
  ['deploy', ['deploy', 'deployment', 'hosting', 'release', 'ship', 'production', 'ci', 'fly']],
  ['design', ['design', 'ui', 'ux', 'uiux', 'theme', 'brand', 'visual']],
  ['integration', ['mcp', 'integration', 'connector', 'webhook', 'api']],
  ['content', ['docs', 'documentation', 'content', 'writing', 'copy', 'blog']],
];
/** Whole words, strongest evidence first: id, keywords, skills. Never guess a category. */
export function agentPluginGlyphKind({ plugin }: { plugin: AgentPluginSummary }, _optional = {}): AgentPluginGlyphKind {
  const tokens = (values: readonly string[]) => new Set(values.flatMap(s => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)));
  for (const tier of [[plugin.pluginId], plugin.keywords, plugin.skills.map(s => s.name)]) {
    const words = tokens(tier); const match = vocabulary.find(([, values]) => values.some(v => words.has(v)));
    if (match) return match[0];
  }
  return 'package';
}
