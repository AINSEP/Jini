/**
 * @file Pure rules for the assistant dock header's icon buttons (owner, 2026-10-11): the white
 * tooltip under each one (same bubble as the subagents icon's `InfoTip`) and the gear's settings
 * menu. Kept out of the `.tsx` files so the behaviour is testable without rendering.
 */

import { CHAT_AGENT_PLUGIN_OPTIONS } from "./chat-agent-plugin-preferences.js";
import type { ChatAgentPluginsController } from "./hooks/use-chat-agent-plugins.hooks.js";
import type { AssistantRuntimePreferences, AssistantRuntimePreferencesController } from "./hooks/use-assistant-runtime-preferences.hooks.js";

/** Structural slice of the host's chat display choices: how tool calls show, the Done line, thinking. */
export interface DockChatDisplayPreferences {
  toolCalls: "show" | "collapsed" | "hidden";
  showUsageLine: boolean;
  showThinking: boolean;
}

/** Structural slice of the host's chat display controller: the current choices and their saver. */
export interface DockChatDisplay {
  preferences: DockChatDisplayPreferences;
  update: (patch: Partial<DockChatDisplayPreferences>) => void;
}

/** The host's tool-call choices, in display order; `label` is the dock dictionary's key. */
export type DockToolCallOptions = readonly { value: DockChatDisplayPreferences["toolCalls"]; label: string }[];

/** The host's reply-length choices, in display order; `label` is the dock dictionary's key. */
export type DockReplyLengthOptions = readonly { value: AssistantRuntimePreferences["replyLength"]; label: string }[];

/**
 * Whether a hover/focus on `target` should open the header tooltip. Never while the control's own
 * popup is open (its trigger reports `aria-expanded="true"`) or for anything inside that popup —
 * the conversation switcher renders its menu inside the tooltip's wrapper, and the gear's portaled
 * menu still bubbles React focus events through it, so either would otherwise cover the open menu.
 * @param input.target - The event target the hover/focus came from.
 * @returns `true` only for a control whose popup is closed.
 * @complexity O(depth) for the two `closest` walks.
 */
export function shouldShowHeaderTip({ target }: { target: EventTarget | null }): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('[role="menu"]') === null && target.closest('[aria-expanded="true"]') === null;
}

/**
 * One row of the gear menu. A plain `menuitem` runs and closes the menu; a `menuitemradio` or
 * `menuitemcheckbox` row is a setting, applied in place with the menu left open so several can be
 * changed in one visit. `disabled` rows render but do nothing when chosen.
 */
export interface DockSettingsMenuItem {
  key: string;
  label: string;
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox";
  checked?: boolean;
  /** Help for this row's own InfoTip. A radio row's help is folded into its section's one tip
   * (`groupOptionTooltips`), so only toggle and plain rows keep an ⓘ of their own. */
  tooltip?: string;
  disabled?: boolean;
  onSelect?: () => void;
}

/** A run of rows, under an optional heading; sections after the first are drawn with a divider. */
export interface DockSettingsMenuSection {
  key: string;
  label?: string;
  /** One line explaining the whole section, shown under its heading in the Chat settings dialog. */
  description?: string;
  /** The one InfoTip right after the heading; set by `groupOptionTooltips`, one "• Option: help" line per option. */
  tooltip?: string;
  items: DockSettingsMenuItem[];
}

/**
 * Whether a section is one multi-option choice (every row a `menuitemradio`): the gear draws it as
 * the Chat settings dialog's segmented control (owner, 2026-10-21) and folds its help into one tip.
 * @param section - One section as built.
 * @returns `true` for a non-empty all-radio section.
 * @complexity O(n) in the section's rows.
 */
export function isChoiceSection(section: DockSettingsMenuSection): boolean {
  return section.items.length > 0 && section.items.every((item) => item.role === "menuitemradio");
}

/**
 * One ⓘ per multi-option setting (owner, 2026-10-18: "ONE tooltip next to 'Tool calls' with 3
 * bullets for Show, Collapsed, Hidden … looks way cleaner"), instead of one beside every option.
 * A radio section's per-option help becomes a "• Label: help" line each in the section's own
 * tooltip, and its rows lose theirs. Any other section passes through untouched, so a new choice
 * group only needs per-option `tooltip`s to get the same single tip in the gear and the dialog.
 * @param section - One section as built, with per-option help on its rows.
 * @returns The section with its options' help grouped under its heading.
 * @complexity O(n) in the section's rows.
 */
export function groupOptionTooltips(section: DockSettingsMenuSection): DockSettingsMenuSection {
  const helped = section.items.filter((item) => item.tooltip);
  if (!helped.length || !isChoiceSection(section)) return section;
  return {
    ...section,
    tooltip: helped.map((item) => `• ${item.label}: ${item.tooltip}`).join("\n"),
    items: section.items.map(({ tooltip: _grouped, ...item }) => item),
  };
}

/**
 * The gear menu (owner, 2026-10-11): the chat's display settings right in the dropdown — Tool calls
 * as a Show/Collapsed/Hidden radio group, then Done line and Thinking as on/off rows. They replaced
 * the one-tab Chat settings modal. More settings now opens the advanced dialog while these quick
 * changes stay available. Both surfaces receive these same actions and stored preferences.
 * Agent plugins (owner, 2026-10-18) follows as an Auto/Ask first/Off radio group: a per-person
 * choice of whether the assistant loads matching installed plugins by itself.
 * Reply length follows as Short/Normal/Detailed, using the same segmented control for every runtime.
 * Use Claude in Chrome and Prefer subagents (2026-10-22) follow as on/off rows, each only when the
 * selected runtime supports it (`visibleAssistantRuntimePreferences`); the server reads them per run.
 * @param input.t - The dock's translator.
 * @param input.toolCallOptions - The host's Tool calls choices, in display order.
 * @param input.replyLengthOptions - The host's Reply length choices, in display order.
 * @param options.display - The current choices and their saver (`useChatDisplayPreferences`).
 * @param options.agentPlugins - The Agent plugins mode and its saver (`useChatAgentPlugins`); no section without it.
 * @param options.runtime - Reply length and runtime switches, their saver and which ones apply; no rows without it.
 * @returns The sections, in display order.
 * @complexity O(1).
 */
export function dockSettingsMenuSections(
  { t, toolCallOptions, replyLengthOptions }: { t: (key: string) => string; toolCallOptions: DockToolCallOptions; replyLengthOptions: DockReplyLengthOptions },
  { display, agentPlugins, runtime, onMoreSettings }: {
    display: DockChatDisplay;
    agentPlugins?: Pick<ChatAgentPluginsController, "mode" | "update"> | undefined;
    runtime?: DockRuntimeSwitches | undefined;
    onMoreSettings?: (() => void) | undefined;
  },
): DockSettingsMenuSection[] {
  const { preferences, update } = display;
  const toolCallTooltips = {
    show: t("See each tool call as the assistant works. Open a card to inspect its details."),
    collapsed: t("Keep tool calls together in one compact line per reply. Tap or click the line to see them."),
    hidden: t("Hide routine tool calls to keep the conversation clear. Failed calls still appear so you can see what went wrong."),
  };
  const agentPluginTooltips = {
    auto: t('Let the assistant use relevant installed plugins automatically. A "Using" chip shows which ones it loaded, and × stops future use in this chat.'),
    ask: t("Choose which matching plugins to use before they load. You'll be asked once in each chat that needs them."),
    off: t("Stop the assistant from loading plugins automatically. You can still choose a plugin yourself when you want it."),
  };
  const sections: DockSettingsMenuSection[] = [
    {
      key: "tool-calls",
      label: t("Tool calls"),
      description: t("How tool calls appear in the chat."),
      items: toolCallOptions.map((option) => ({
        key: `tool-calls-${option.value}`,
        label: t(option.label),
        role: "menuitemradio",
        checked: preferences.toolCalls === option.value,
        tooltip: toolCallTooltips[option.value],
        onSelect: () => update({ toolCalls: option.value }),
      })),
    },
    {
      key: "transcript",
      items: [
        { key: "done-line", label: t("Done line"), role: "menuitemcheckbox", checked: preferences.showUsageLine,
          tooltip: t("Show the time, cost, and running total below each reply. Some models may not report every detail."), onSelect: () => update({ showUsageLine: !preferences.showUsageLine }) },
        { key: "thinking", label: t("Thinking"), role: "menuitemcheckbox", checked: preferences.showThinking,
          tooltip: t("Show reasoning shared by the model, folded into the conversation. Some models do not provide it."), onSelect: () => update({ showThinking: !preferences.showThinking }) },
      ],
    },
    ...(agentPlugins ? [{
      key: "agent-plugins",
      label: t("Agent plugins"),
      items: CHAT_AGENT_PLUGIN_OPTIONS.map((option) => ({
        key: `agent-plugins-${option.value}`,
        label: t(option.label),
        role: "menuitemradio" as const,
        checked: agentPlugins.mode === option.value,
        tooltip: agentPluginTooltips[option.value],
        onSelect: () => agentPlugins.update(option.value),
      })),
    }] : []),
    ...replyLengthSection({ t, replyLengthOptions }, { runtime }),
    ...runtimeSection({ t }, { runtime }),
    ...(onMoreSettings ? [{ key: "more-settings", items: [{ key: "more-settings", label: t("More settings…"), onSelect: onMoreSettings }] }] : []),
  ];
  // Every section passes through `groupOptionTooltips`, so a radio group added above gets one tip.
  return sections.map(groupOptionTooltips);
}

/** Runtime preferences and their saver, plus which switches the selected runtime supports. */
export type DockRuntimeSwitches = Pick<AssistantRuntimePreferencesController, "preferences" | "update"> & { visible: Record<keyof AssistantRuntimePreferences, boolean> };

/** Reply length uses the same segmented choice renderer as Tool calls. Pure, O(1) fixed options. */
function replyLengthSection(
  { t, replyLengthOptions }: { t: (key: string) => string; replyLengthOptions: DockReplyLengthOptions },
  { runtime }: { runtime?: DockRuntimeSwitches | undefined },
): DockSettingsMenuSection[] {
  if (!runtime) return [];
  return [{
    key: "reply-length",
    label: t("Reply length"),
    tooltip: t("How much the assistant writes back. Short: just the result and what needs you."),
    items: replyLengthOptions.map(option => ({
      key: `reply-length-${option.value}`, label: t(option.label), role: "menuitemradio",
      checked: runtime.preferences.replyLength === option.value,
      onSelect: () => runtime.update({ replyLength: option.value }),
    })),
  }];
}

/** The runtime switches as one unheaded run of on/off rows; none when no switch applies. */
function runtimeSection(
  { t }: { t: (key: string) => string },
  { runtime }: { runtime?: DockRuntimeSwitches | undefined },
): DockSettingsMenuSection[] {
  if (!runtime) return [];
  const { preferences, update, visible } = runtime;
  const items: DockSettingsMenuItem[] = [
    ...(visible.useClaudeInChrome ? [{ key: "use-claude-in-chrome", label: t("Use Claude in Chrome"), role: "menuitemcheckbox" as const, checked: preferences.useClaudeInChrome,
      tooltip: t("Let the assistant check pages in your own signed-in Chrome. Site owner only."), onSelect: () => update({ useClaudeInChrome: !preferences.useClaudeInChrome }) }] : []),
    ...(visible.preferSubagents ? [{ key: "prefer-subagents", label: t("Prefer subagents"), role: "menuitemcheckbox" as const, checked: preferences.preferSubagents,
      tooltip: t("Hand long or many-step work to a subagent so the chat stays short."), onSelect: () => update({ preferSubagents: !preferences.preferSubagents }) }] : []),
  ];
  return items.length ? [{ key: "runtime", items }] : [];
}

/**
 * Runs a chosen row. A disabled row leaves the menu open and calls nothing, so clicking the
 * placeholder does not look like it did something. A setting row (radio/checkbox) applies without
 * closing, so focus stays on it and the new check mark is visible at once.
 * @param input.item - The chosen row.
 * @param input.selectItem - The menu hook's close-then-run action.
 * @returns Whether the row was run.
 */
export function activateDockMenuItem({ item, selectItem }: {
  item: DockSettingsMenuItem;
  selectItem: (input: { onSelect: () => void }) => void;
}): boolean {
  if (item.disabled || !item.onSelect) return false;
  if (item.role === "menuitemradio" || item.role === "menuitemcheckbox") item.onSelect();
  else selectItem({ onSelect: item.onSelect });
  return true;
}
