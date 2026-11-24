import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** agent-plugins registration declarations; shared placement rationale is in the host aggregator.
 * The customize tool's search keywords name the host's bundled theme plugin id, so the host passes it in
 * (`bundledThemePluginId`) and the package never names one. */
export function createAgentPluginsToolMetadata({ bundledThemePluginId }: { bundledThemePluginId: string }, _optional: Record<string, never> = {}) {
  return {
  load_agent_plugin: { approval: { class: 'read', confirmation: 'direct' } },
  
  // OAuth-authenticated Agent Plugins use the generic connection card.
  "agent_plugin_connect": {
    search: {
      keywords: "connect sign in signin login link account database setup set up enable activate authorize authorization oauth plugin",
    },
    approval: { class: 'edit', confirmation: 'direct', input: 'human-form' },
    mcpUi: { redeemable: true },
  },
  "agent_plugin_write_note": {
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // Always asks: an update keeps an enabled plugin enabled, so without a click an assistant (or a
  // prompt injection) could make a new unverified local/zip package live. Install lands OFF and
  // enabling goes through plugins_set_enabled's own escalation, so install stays direct.
  "agent_plugins_update": {
    title: 'Change agent plugin access',
    summary: 'This changes the selected agent plugin installation or the access it has.',
    search: { keywords: "agent plugin update upgrade replace zip folder version digest" },
    approval: { class: 'escalation', confirmation: 'policy' },
  },
  "agent_plugins_install": {
    search: {
      keywords: "agent plugin plugins install add upload attachment zip folder bundled bundledId ui-ux-design package agent-plugins plugin.json upgrade replace version",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  agent_plugins_customize: {
    search: { keywords: `edit customize change bundled agent plugin ${bundledThemePluginId} fork copy skills source EACCES PLUGIN_BUNDLED` },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // --- agent plugins (agent-plugins.org packages — a DIFFERENT system from the host plugin system above) -----------
  // Search vocabulary targets discovery intent before an operator knows manifest terminology.
  "search_agent_plugin_local": {
    search: {
      keywords: "agent plugin plugins agent-plugin agent-plugins search find looking for do I have installed capability capabilities skill skills addon add-on package packages extension extensions bundle available covers supports mcp server marketplace",
      queries: [
        "Is there a plugin for deploying to my hosting provider?",
        "What agent plugins do I have installed?",
        "Do we already have something installed that handles GDPR or cookie consent?",
        "Find a plugin that can help with accessibility review.",
        "Is there an installed plugin that declares an MCP server, and what does it cover?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
}
