import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** Plugin source (draft working copy) tools: static declarations, independent of host vocabulary. */
const PLUGIN_SOURCE_METADATA = {
  plugin_source_create: { search: { keywords: 'plugin source code create scaffold site local server content filter fields types' }, approval: { class: 'edit', confirmation: 'direct' } },
  plugin_source_open: { search: { keywords: 'plugin source open draft edit installed working copy' }, approval: { class: 'edit', confirmation: 'direct' } },
  plugin_source_list: { search: { keywords: 'plugin source draft list files code' }, approval: { class: 'read', confirmation: 'direct' } },
  plugin_source_read: { search: { keywords: 'plugin source draft read file code' }, approval: { class: 'read', confirmation: 'direct' } },
  plugin_source_write: { search: { keywords: 'plugin source draft write file code create overwrite' }, approval: { class: 'edit', confirmation: 'direct' } },
  plugin_source_edit: { search: { keywords: 'plugin source draft edit file code exact replace string' }, approval: { class: 'edit', confirmation: 'direct' } },
  plugin_source_delete: {
    title: 'Permanently delete this plugin file',
    summary: 'This permanently removes the selected file from the plugin source.',
    search: { keywords: 'plugin source draft delete file permanently remove' }, approval: { class: 'delete', confirmation: 'plan' } },
  plugin_source_seal: { search: { keywords: 'plugin source seal validate integrity install version patch reload code' }, approval: { class: 'edit', confirmation: 'direct' } },
  plugin_source_rollback: { search: { keywords: 'plugin source rollback previous version restore code' }, approval: { class: 'edit', confirmation: 'direct' } },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;

/** Install/list/enable/uninstall tools after the host-worded install entry; static declarations. */
const PLUGIN_LIFECYCLE_METADATA = {
  "plugins_list": {
    search: {
      keywords: "plugin plugins extensions installed available list have installed my",
      queries: [
        "What plugins are installed on the site?",
        "Can you show me which plugins are enabled versus disabled?",
        "Is there a plugin with a validation error I should know about?",
        "What's the trust tier on this third-party plugin?",
        "Show me every discovered plugin, built-in and site-installed.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // Vendor-neutral on purpose (no-vendor-in-core): vendor names ship in each provider's agent plugin.
  "provider_status": {
    search: {
      keywords: "provider plugin status configured set up analytics product analytics error tracking errors observability tracing traces telemetry monitoring connected key saved",
      queries: [
        "Is analytics set up on my site?",
        "Is error tracking configured?",
        "Did my observability settings save?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // --- plugins -------------------------------------------------------------------------------------------
  // Enable vocabulary covers both site and Agent Plugins; finding a plugin is a separate action.
  "plugins_set_enabled": {
    title: 'Change plugin access',
    summary: 'This changes whether the selected plugin can run on this site.',
    search: {
      keywords: "plugin plugins agent plugin agent-plugin agent-plugins enable disable turn on off activate deactivate switch on switch off " +
        "extension addon add-on skill skills capability use it install it already installed not active inactive",
      queries: [
        "Can you turn on this plugin?",
        "How do I disable a plugin we don't want running?",
        "Why won't this plugin enable — is it invalid or incompatible?",
        "Will enabling this plugin change our database schema?",
        "Can you toggle this plugin off?",
      ],
    },
    approval: { class: 'escalation', confirmation: 'plan', rule: 'plugin-enable' },
  },
  // Uninstall covers both plugin families, including agent-plugin, skill and package vocabulary.
  "plugins_uninstall": {
    title: 'Uninstall this plugin',
    summary: 'This removes the selected plugin from this site.',
    search: {
      keywords: "plugin plugins uninstall remove delete trash extension get rid of agent plugin agent-plugin agent-plugins " +
        "skill skills package packages permanently",
    },
    approval: { class: 'trash', confirmation: 'plan' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;

/** plugin-runtime registration declarations; shared placement rationale is in the host aggregator.
 * The install tool's search keywords name the host's plugin package term, so the host passes it in
 * (`pluginKeyword`) and the package never names one. */
export function createPluginRuntimeToolMetadata({ pluginKeyword }: { pluginKeyword: string }, _optional: Record<string, never> = {}) {
  return {
    ...PLUGIN_SOURCE_METADATA,
    "plugins_install": {
      search: {
        keywords: `plugin plugins install add new upload folder zip attachment local package upgrade replace version site plugin ${pluginKeyword} extension addon add-on`,
      },
      approval: { class: 'edit', confirmation: 'direct' },
    },
    ...PLUGIN_LIFECYCLE_METADATA,
  } as const satisfies ToolMetadataById<ToolApprovalPolicy>;
}
