import { agentHandle } from "@jini-ai/core/agent-handles";

import { createUserInterfaceSettingsPanelTranslator } from "./UserInterfaceSettingsPanel.hooks.js";

/** What the panel reads and calls: the two switches' values and their toggles. The host's tab hook
 *  maps its own settings slice onto this shape; the panel never sees the slice's contents. */
export interface UserInterfaceSettingsPanelTab {
  hideChatFabWhileOpen: boolean;
  toggleHideChatFabWhileOpen: () => void;
  wrapTabs: boolean;
  toggleWrapTabs: () => void;
}

/** The host's tab hook: its settings slice in, the switches' state out. */
export type UseUserInterfaceSettingsTab<TSlice> = (slice: TSlice) => UserInterfaceSettingsPanelTab;

export interface UserInterfaceSettingsPanelProps<TSlice> {
  /** Opaque to the panel; handed straight to `useUserInterfaceTabHook`. */
  slice: TSlice;
  locale: string;
  useUserInterfaceTabHook: UseUserInterfaceSettingsTab<TSlice>;
}

/**
 * Settings → User Interface (owner, 2026-10-06). Switches for how the admin's chrome behaves for
 * this operator: whether the floating chat button hides while the assistant dock is open, and
 * (2026-10-07) whether phone tab strips wrap instead of scrolling. Autosaves through the tab's
 * settings slice like every other Settings control; `App.tsx` reads the same `core.interface`
 * values live (`useInterfacePreferences`). The switch reuses `.agent-plugin-switch`'s paint, and
 * the label says the on/off meaning in words so position is never the only signal.
 *
 * The switch renders `jini-settings-interface-switch` / `-knob`; the host paints them by adding
 * those selectors to its own switch rules.
 */
export function UserInterfaceSettingsPanel<TSlice>({ useUserInterfaceTabHook, ...props }: UserInterfaceSettingsPanelProps<TSlice>) {
  const tab = useUserInterfaceTabHook(props.slice);
  const t = createUserInterfaceSettingsPanelTranslator({ locale: props.locale });
  return (
    <>
      <InterfaceSwitchRow
        id="settings-interface-hide-fab-label"
        label={t({ key: "Hide the chat button while the chat is open" })}
        hint={t({ key: "On: the chat panel's ✕ closes it. Off: the button stays on screen above the open panel and closes it." })}
        checked={tab.hideChatFabWhileOpen}
        onToggle={tab.toggleHideChatFabWhileOpen}
        handle="settings-interface-hide-chat-fab"
        agentLabel="Hide the chat button while the chat is open"
      />
      <InterfaceSwitchRow
        id="settings-interface-wrap-tabs-label"
        label={t({ key: "Wrap tabs instead of scrolling" })}
        hint={t({ key: "On: on narrow screens, tab rows wrap onto more lines so every tab is visible. Off: they stay on one row you swipe sideways." })}
        checked={tab.wrapTabs}
        onToggle={tab.toggleWrapTabs}
        handle="settings-interface-wrap-tabs"
        agentLabel="Wrap tabs instead of scrolling"
      />
    </>
  );
}

function InterfaceSwitchRow(props: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onToggle: () => void;
  handle: string;
  agentLabel: string;
}) {
  return (
    <div className="jini-settings-interface-row">
      <div className="jini-settings-interface-text">
        <span id={props.id} className="jini-settings-interface-label">{props.label}</span>
        <p className="jini-settings-interface-hint">{props.hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-labelledby={props.id}
        className="jini-settings-interface-switch"
        onClick={props.onToggle}
        // `checkbox` for the page driver; ARIA stays `switch` (same split as `AgentPluginRow.tsx`).
        {...agentHandle({ handle: props.handle }, { role: "checkbox", label: props.agentLabel })}
      >
        <span className="jini-settings-interface-switch-knob" aria-hidden="true" />
      </button>
    </div>
  );
}
