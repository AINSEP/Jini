import { TabStripFrame } from "./TabStripFrame.js";
import type { ReactNode } from "react";
import { agentHandle } from "@jini-ai/agentic";
import { resolveTabBarTabIndex, tabHandleProps, useTabBarKeyboard } from "./TabBar.hooks.js";

export interface TabBarTab {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode | undefined;
  readonly count?: number | undefined;
  readonly tag?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly handle?: string | undefined;
  readonly handleLabel?: string | undefined;
  readonly dot?: boolean | undefined;
  readonly dotLabel?: string | undefined;
}

export interface TabBarProps {
  tabs: readonly TabBarTab[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  containerHandle?: string | undefined;
}

function tabDotAccessibleSuffix(tab: TabBarTab) {
  if (!tab.dot || !tab.dotLabel) return null;
  return <span className="visually-hidden">, {tab.dotLabel}</span>;
}

function TabBarButton({
  tab,
  active,
  tabIndex,
  onChange,
}: {
  tab: TabBarTab;
  active: boolean;
  tabIndex: 0 | -1;
  onChange: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      className="tab-bar-item"
      aria-selected={active}
      aria-label={tab.dot && tab.dotLabel ? [tab.label + ", " + tab.dotLabel, tab.tag, tab.count].filter((part) => part !== undefined).join(" ") : undefined}
      aria-disabled={tab.disabled || undefined}
      disabled={tab.disabled}
      tabIndex={tabIndex}
      onClick={tab.disabled ? undefined : () => onChange(tab.id)}
      {...tabHandleProps({ tab: tab })}
    >
      {tab.dot ? <span className="tab-bar-dot" aria-hidden="true" /> : null}
      {tab.icon ? (
        <span className="tab-bar-icon" aria-hidden="true">
          {tab.icon}
        </span>
      ) : null}
      {tab.label}
      {tabDotAccessibleSuffix(tab)}
      {tab.tag ? <span className="tab-bar-tag">{tab.tag}</span> : null}
      {tab.count !== undefined ? <span className="tab-bar-count">{tab.count}</span> : null}
    </button>
  );
}

/** Controlled button-based selection strip, including roving focus and optional agent handles. */
export function TabBar({ tabs, activeId, onChange, ariaLabel, containerHandle }: TabBarProps) {
  const { onKeyDown } = useTabBarKeyboard({ tabs: tabs, activeId: activeId, onChange: onChange });
  return (
    <TabStripFrame
      className="tab-bar"
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      {...(containerHandle ? agentHandle({ handle: containerHandle }, { role: "region", label: ariaLabel }) : {})}
    >
      {tabs.map((tab) => (
        <TabBarButton
          key={tab.id}
          tab={tab}
          active={activeId === tab.id}
          tabIndex={resolveTabBarTabIndex({ tabs: tabs, activeId: activeId, tab: tab })}
          onChange={onChange}
        />
      ))}
    </TabStripFrame>
  );
}
