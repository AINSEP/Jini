import type { UUID } from "@jini-ai/core/primitives";
import { ensureSettingDefinitions, type EnsureSettingDefinitionsDeps, SCOPE_BIT } from "@jini-ai/core/settings";

/**
 * @file `core.interface`: the admin's per-operator UI preferences, shown on Settings → User Interface.
 *
 * `hideChatFabWhileOpen` (owner, 2026-10-06): whether the floating chat button hides while the
 * assistant dock is open. Default `true` keeps the behaviour the owner already approved (the dock's
 * own ✕ closes it); `false` keeps the button on screen over the open dock so it can toggle it closed.
 *
 * `wrapTabs` (owner, 2026-10-07): on phones, whether the admin's tab strips wrap onto more rows
 * instead of scrolling sideways. Default `false` keeps the one-row swipeable strip.
 *
 * Per operator, same mask as `@jini-ai/core/settings`' Appearance and Language definitions: how one
 * admin wants the chrome to behave is not a property of the workspace. The `workspace` bit stays in
 * the mask so an operator with no user row still inherits a workspace default.
 *
 * `adminTheme` (owner, 2026-10-17): the operator's admin theme id, chosen on Studio → Admin Themes and
 * mirrored by the admin's `admin-themes/registry.ts`. A free-form string, not an enum, so a new theme
 * package is a drop-in on the admin side alone; the admin falls back to classic for an unknown id.
 *
 * `core.*` because the settings namespace fence admits that prefix only for a platform-wide core
 * definition, the same constraint `site-title.ts` documents.
 */

export const ADMIN_INTERFACE_NAMESPACE = "core.interface";
export const HIDE_CHAT_FAB_WHILE_OPEN_KEY = "hideChatFabWhileOpen";
export const WRAP_TABS_KEY = "wrapTabs";
/** The assistant dock's Chat settings → Display (owner, 2026-10-11); mirrored by the admin's
 *  `components/AssistantDock/chat-display-preferences.ts`. */
export const CHAT_TOOL_CALLS_KEY = "chatToolCalls";
export const CHAT_SHOW_USAGE_LINE_KEY = "chatShowUsageLine";
export const CHAT_SHOW_THINKING_KEY = "chatShowThinking";
export const CHAT_AGENT_PLUGINS_KEY = "chatAgentPlugins";
/** Per-person assistant runtime preference (2026-10-21): when the run's CLI has a native subagent
 *  tool and Task/Agent is not denied, steer multi-step or output-heavy work to a subagent. Default
 *  `true`. Read fresh per run by `assistant/runtime-preferences.ts`; mirrored by the admin's
 *  `components/AssistantDock/assistant-runtime-preferences.ts`. */
export const PREFER_SUBAGENTS_KEY = "preferSubagents";
/** Per-person reply verbosity; Normal preserves the existing prompt without extra guidance. */
export const REPLY_LENGTH_KEY = "replyLength";
/** Per-person (2026-10-21): let this person's Claude Code runs use Claude in Chrome (`--chrome`) —
 *  the operator's real, logged-in Chrome. Default `false` (owner decision OD-4, 2026-11-17, replacing
 *  the 2026-10-22 "it should just work": one browser serves every chat on a daemon, so it is opt-in;
 *  a person's stored choice is never rewritten). It
 *  still applies only to the owner on a runtime whose CLI passes the `--chrome` probe, and Bash stays
 *  disabled. The assistant may change it only through an always-ask card (`features/settings/tool-registrations.ts`). Same reader and mirror as above. */
export const USE_CLAUDE_IN_CHROME_KEY = "useClaudeInChrome";
export const ADMIN_THEME_KEY = "adminTheme";
/** Per-admin-theme colours; Classic retains core.appearance.accentColor's scalar contract. */
export const ADMIN_THEME_ACCENTS_KEY = "adminThemeAccents";

/** The Sites list's sort, pins and hidden sites; mirrored by the admin's `use-site-list-prefs.hooks.ts`. */
export const SITE_LIST_KEY = "sitesList";

const PER_OPERATOR_SCOPES = SCOPE_BIT.user | SCOPE_BIT.workspace;

export interface EnsureAdminInterfaceSettingDefinitionsInput {
  /** The trusted boot-time actor the registration is attributed to. */
  systemPrincipalId: UUID;
}

/**
 * Idempotently registers the host's admin interface and theme-accent definitions. Safe on every boot.
 *
 * @complexity O(1), eleven definitions.
 */
export async function ensureAdminInterfaceSettingDefinitions(
  deps: EnsureSettingDefinitionsDeps,
  input: EnsureAdminInterfaceSettingDefinitionsInput
): Promise<void> {
  await ensureSettingDefinitions(deps, {
    namespace: ADMIN_INTERFACE_NAMESPACE,
    definitions: [
      { key: HIDE_CHAT_FAB_WHILE_OPEN_KEY, schema: { type: "boolean" }, defaultValue: true, scopes: PER_OPERATOR_SCOPES },
      { key: WRAP_TABS_KEY, schema: { type: "boolean" }, defaultValue: false, scopes: PER_OPERATOR_SCOPES },
      { key: CHAT_TOOL_CALLS_KEY, schema: { type: "enum", values: ["show", "collapsed", "hidden"] }, defaultValue: "collapsed", scopes: PER_OPERATOR_SCOPES },
      { key: CHAT_SHOW_USAGE_LINE_KEY, schema: { type: "boolean" }, defaultValue: true, scopes: PER_OPERATOR_SCOPES },
      { key: CHAT_AGENT_PLUGINS_KEY, schema: { type: "enum", values: ["auto", "ask", "off"] }, defaultValue: "auto", scopes: PER_OPERATOR_SCOPES },
      { key: CHAT_SHOW_THINKING_KEY, schema: { type: "boolean" }, defaultValue: false, scopes: PER_OPERATOR_SCOPES },
      { key: PREFER_SUBAGENTS_KEY, schema: { type: "boolean" }, defaultValue: true, scopes: PER_OPERATOR_SCOPES },
      { key: REPLY_LENGTH_KEY, schema: { type: "enum", values: ["short", "normal", "detailed"] }, defaultValue: "normal", scopes: PER_OPERATOR_SCOPES },
      { key: USE_CLAUDE_IN_CHROME_KEY, schema: { type: "boolean" }, defaultValue: false, scopes: PER_OPERATOR_SCOPES },
      { key: ADMIN_THEME_KEY, schema: { type: "string" }, defaultValue: "classic", scopes: PER_OPERATOR_SCOPES },
      { key: SITE_LIST_KEY, schema: { type: "json" }, defaultValue: {}, scopes: PER_OPERATOR_SCOPES },
    ],
    systemPrincipalId: input.systemPrincipalId,
  });
  await ensureSettingDefinitions(deps, {
    namespace: "core.appearance",
    definitions: [
      // Theme ids are extensible, so this cannot be a fixed set of scalar fields. Keep this
      // object separate: legacy readers and agent writers still own the Classic scalar.
      { key: ADMIN_THEME_ACCENTS_KEY, schema: { type: "json" }, defaultValue: {}, scopes: PER_OPERATOR_SCOPES },
    ],
    systemPrincipalId: input.systemPrincipalId,
  });
}
