import { useId, type ReactNode } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { AdminKitHooks, AdminKitValues } from "../../react/kit.js";
import type { useVisitorAssistantTabs } from "./use-visitor-assistant-tabs.hooks.js";

/**
 * Two tabs inside "Visitor's AI Assistant" (owner, 2026-10-22): "AI provider" is the screen that was
 * here before, unchanged; "Visitor tools" is the per-tool Auto | Ask first | Off list. Local state,
 * not a URL param: the outer `?tab=` already names this page tab, and nothing links to the inner one.
 * The tools panel mounts only while its tab is open, so the provider screen issues no extra request.
 *
 * Drawn as the Auto | Ask first | Off segmented pill (owner, 2026-10-24: "the active one is white and
 * the inactives are gray"), not `<TabBar>`'s underline row: same `.jini-chat-settings-segmented`
 * classes, but tab buttons on TabBar's own keyboard/roving-tabindex helpers, so it stays a tablist.
 */
export interface VisitorAssistantTabsProps {
  t: (key: string) => string;
  providerPanel: ReactNode;
  /** The host's wired "Visitor tools" panel (normally `VisitorToolsPanel` from this folder). */
  toolsPanel: ReactNode;
  /** Normally `useVisitorAssistantTabs` from this folder. */
  useVisitorAssistantTabsHook: typeof useVisitorAssistantTabs;
  /** The host UI library's TabBar keyboard hook (arrow/Home/End roving focus). */
  useTabBarKeyboardHook: AdminKitHooks["useTabBarKeyboard"];
  /** The host UI library's TabBar roving-tabindex rule. */
  resolveTabIndex: AdminKitValues["resolveTabBarTabIndex"];
}

export function VisitorAssistantTabs(props: VisitorAssistantTabsProps) {
  const { t, providerPanel, toolsPanel, resolveTabIndex } = props;
  const { active, select } = props.useVisitorAssistantTabsHook({});
  const panelId = useId();
  const tabs = [
    { id: "provider", label: t("AI provider"), handle: "ai-assistant-visitor-tab-provider", handleLabel: "Show the visitor AI provider settings" },
    { id: "tools", label: t("Visitor tools"), handle: "ai-assistant-visitor-tab-tools", handleLabel: "Show the visitor tools" },
  ];
  const { onKeyDown } = props.useTabBarKeyboardHook({ tabs, activeId: active, onChange: select });
  return (
    <div className="jini-visitor-assistant-tabs">
      <div className="jini-chat-settings-segmented" role="tablist" aria-label={t("Visitor's AI Assistant")} onKeyDown={onKeyDown}>
        {tabs.map(tab => (
          <button key={tab.id} type="button" role="tab" className="jini-chat-settings-segment"
            aria-selected={active === tab.id} tabIndex={resolveTabIndex({ tabs, activeId: active, tab })}
            onClick={() => select(tab.id)} {...agentHandle({ handle: tab.handle }, { role: "button", label: tab.handleLabel })}>
            {tab.label}
          </button>
        ))}
      </div>
      <div id={panelId} role="tabpanel" aria-label={active === "tools" ? t("Visitor tools") : t("AI provider")}>
        {active === "tools" ? toolsPanel : providerPanel}
      </div>
    </div>
  );
}
