import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** settings registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "settings_clear_value": {
    title: 'Reset this setting',
    summary: 'This removes the selected override and applies the inherited setting.',
    search: {
      keywords: "reset setting back to default clear override undo setting",
      queries: [
        "Put that setting back to its default.",
        "Clear a setting override.",
        "Undo that setting.",
        "Reset one setting to default.",
      ],
    },
    approval: { class: 'escalation', confirmation: 'plan', rule: 'execution-setting' },
  },
  "settings_get_effective": {
    search: {
      keywords: "setting settings configuration config value current site settings what settings configuration options current values",
      queries: [
        "What's the actual value being used for this setting right now?",
        "Can you resolve the final setting value after all the overrides?",
        "What settings apply to me as a user versus the whole workspace?",
        "I want the effective, precedence-resolved values for a namespace.",
        "What's the value that actually wins between global, workspace, and user settings?",
        "What settings does my site have?",
        "Show me all current site settings.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "settings_get_raw": {
    search: {
      keywords: "setting raw value layer global workspace user default unresolved debug",
      queries: [
        "Can you show me the raw values for this setting at every layer?",
        "What's the workspace-level value versus the global default for this setting?",
        "I want to see all the unresolved layers for one setting key.",
        "Can you break down this setting by global, workspace, user, and default?",
        "Before precedence is applied, what does each layer say for this setting?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "settings_list_definitions": {
    search: {
      keywords: "setting settings configuration options available what can all site settings",
      queries: [
        "What settings are available in this workspace?",
        "Can you show me every setting definition, platform and site-owned?",
        "I want to see setting keys and their current status, not values.",
        "What namespace do our settings live under?",
        "List all the active setting definitions we can configure.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "settings_list_ui_locales": {
    search: {
      keywords: "supported available languages locale codes admin interface UI menus labels Spanish Portuguese pt-BR Italian Polish German English switch change language translation options",
      queries: [
        "Which languages can the admin interface use?",
        "What locale code do I use for Portuguese?",
        "Does the admin support Italian?",
        "List supported UI languages.",
        "Can you switch to Polish?",
        "Change the language to Spanish.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "settings_set_ui_preference": {
    search: {
      keywords: "preference language theme accent color notification sounds personal admin ui my settings",
      queries: [
        "Can you switch my admin panel to dark theme?",
        "How do I change my interface language in the admin UI?",
        "Can you turn off notification sounds for me?",
        "I want to change my own accent color in the admin panel.",
        "Can this change another operator's preferences, or just mine?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // Added for t07, after the original blind catalog: owner settings writes and single-layer undo.
  "settings_set_value": {
    title: 'Change this setting',
    summary: 'This applies the selected setting and may change how the assistant runs.',
    search: {
      keywords: "change set update setting settings option config configuration timezone time zone date format site setting turn on turn off enable disable agent plugins plugin mode auto ask first off change model switch to opus sonnet gpt effort thinking level chat agent runtime",
      queries: [
        "Change the site's timezone to Pacific.",
        "Turn off comments on new posts.",
        "Set the date format to day-month-year.",
        "Change a site setting.",
        "Update a configuration option.",
        "Change my Agent plugins mode to Auto, Ask first, or Off.",
        "Change model, switch to Opus, Sonnet or GPT, or change my thinking level: use core.execution localCli.agentId / localCli.model / localCli.reasoning at scope=user; each change needs confirmation and applies next turn. Set model and reasoning to empty strings before switching agents if their old choices are incompatible. Use the chat picker's current model ids.",
      ],
    },
    approval: { class: 'escalation', confirmation: 'plan', rule: 'execution-setting' },
  },
  // settings_reset and settings_register_definitions remain deliberately
    // UNWIRED (never agent-callable — bulk/schema-level settings access, see file header).
    // Entries added for consistency, same reasoning as backup_execute_restore above.
  "settings_reset": {
    search: {
      keywords: "setting settings reset all defaults wipe clear everything bulk namespace",
    },
  },
  "settings_register_definitions": {
    search: {
      keywords: "setting settings definition definitions register schema rename change type deprecate add new remove",
    },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
