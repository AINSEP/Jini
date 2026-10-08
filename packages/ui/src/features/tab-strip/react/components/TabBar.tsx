import { TabStripFrame } from "./TabStripFrame.js";
import type { ReactNode } from "react";
import { agentHandle } from "@jini-ai/agentic";
import { resolveTabBarTabIndex, tabHandleProps, useTabBarKeyboard } from "./TabBar.hooks.js";

/**
 * @file Controlled horizontal tabs: id/label pairs, active id and change callback, with no routing,
 * persistence or panel lifecycle. SettingsDialogShell also owns a header/sidebar/dialog lifecycle;
 * hosts needing only a tab row can use this standalone component.
 * Optional agent handles tag only elements whose handles are supplied.
 */
export interface TabBarTab {
  readonly id: string;
  readonly label: string;
  /** Inline icon before the label. Always aria-hidden because adjacent text already names the
   * tab. Omit for the plain text layout; this slot does not require SettingsDialogShell. */
  readonly icon?: ReactNode | undefined;
  /** Shown next to the label when present (e.g. a theme count per tier). Omit to show none. */
  readonly count?: number | undefined;
  /** Pill after the label, using the admin Sidebar's shared "Soon" styling. A tagged tab stays
   * clickable so its panel can explain status; use disabled when there is no destination. */
  readonly tag?: string | undefined;
  /**
   * Renders this tab greyed out and non-interactive: no `onChange` call, not part of the tab
   * order (native `disabled`), `aria-disabled` set for assistive tech. For scaffolding a future
   * tab (e.g. a "Marketplace (soon)" placeholder with no real destination yet) that should be
   * visibly present without inviting a click into nothing.
   */
  readonly disabled?: boolean | undefined;
  /** Publishes this tab button as agent-addressable via `agentHandle()` (`@jini-ai/agentic`). Omit
   *  to leave the tab untagged. */
  readonly handle?: string | undefined;
  /** Plain-English description of what switching to this tab does, paired with {@link handle}.
   *  Defaults to `label` (untranslated tab labels, e.g. Deployment's, still read fine as a
   *  description; a caller with a translated `label` should pass its own). Ignored if `handle` is
   *  omitted. */
  readonly handleLabel?: string | undefined;
  /**
   * A filled dot before the label exposes configuration state across panels shown one at a time,
   * without making the tab row denser as providers are added. Meaning comes from presence rather
   * than color alone. The dot is aria-hidden; dotLabel supplies its text equivalent as a suffix
   * to the tab's accessible name.
   */
  readonly dot?: boolean | undefined;
  /** Visually-hidden text appended to this tab's accessible name when {@link dot} is set — e.g.
   *  "Connected". Required whenever `dot` is true; ignored otherwise. */
  readonly dotLabel?: string | undefined;
}

export interface TabBarProps {
  tabs: readonly TabBarTab[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  /** Publishes the tablist container itself as agent-addressable. Omit to leave it untagged. */
  containerHandle?: string | undefined;
}

/** The visually-hidden accessible-name SUFFIX {@link TabBarTab.dot} adds — e.g. "GitHub Pages,
 *  Connected", never "Connected GitHub Pages". Deliberately its own function rather than folded into
 *  the visual dot span rendered before the label (`TabBarButton` below): the visual dot is
 *  `aria-hidden` and belongs immediately before the label, where a leading bullet reads naturally,
 *  but the ACCESSIBLE text has to come AFTER the label text in DOM order for the tab's accessible
 *  name (label + this suffix, concatenated in DOM order) to read as a sentence rather than a
 *  fragment stitched on backwards. Split out for the same complexity-gate reason {@link
 *  TabBarButton}'s own doc gives. */
function tabDotAccessibleSuffix(tab: TabBarTab) {
  if (!tab.dot || !tab.dotLabel) return null;
  return <span className="visually-hidden">, {tab.dotLabel}</span>;
}

/** One tab button. A named top-level component avoids the nesting penalty for branches inside
 * an inline map callback under the cyclomatic/cognitive complexity gate. Derived props live in
 * TabBar.hooks.tsx; tabDotAccessibleSuffix stays here because it renders JSX. */
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
export function TabBar({ tabs, activeId, onChange, ariaLabel, containerHandle }: TabBarProps, _optional: Record<string, never> = {}) {
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
