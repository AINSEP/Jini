import { useId, type ComponentType, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { InfoTip, RemixIcon } from "../../../react/kit.js";
import type { useTaxonomyRowMenu } from "../../../screens/taxonomy/TaxonomyRowMenu.hooks.js";
import { activateDockMenuItem, isChoiceSection, type DockSettingsMenuItem, type DockSettingsMenuSection } from "./dock-header-rules.js";

type DockMenu = ReturnType<typeof useTaxonomyRowMenu>;

/** Structural slice of the host's segmented-pill radio group (the Chat settings dialog's own control). */
export interface DockSettingsSegmentedProps {
  name: string;
  items: readonly { key: string; label: string; checked?: boolean | undefined; disabled?: boolean | undefined; change: () => void }[];
  inputRole?: "menuitemradio" | undefined;
  checkedRef?: ((input: HTMLInputElement | null) => void) | undefined;
}

/**
 * The dock header's gear (owner, 2026-10-11): a small menu under it, right-aligned. Built from the
 * admin's row menu — the same `.row-menu-popup`/`.row-menu-item` styling and the same open/close,
 * positioning and roving-focus hook `TaxonomyRowMenu` uses (published `RowMenu` hard-codes its ⋮
 * trigger and has no disabled rows). The hook already anchors the popup's right edge to the
 * trigger's, which keeps it inside the narrow dock.
 * Rows come in sections (a heading, then its rows); a setting row carries a check mark that is
 * always laid out and only shown when on, so toggling never shifts the menu. `notice` is a status
 * line under the rows (a failed save). A row's ⓘ sits beside its button; a radio group's single
 * ⓘ (`groupOptionTooltips`) sits beside its heading.
 * A radio group (Tool calls, Agent plugins) is the Chat settings dialog's own segmented control
 * (owner, 2026-10-21), not a column of check rows. It takes ONE roving-focus stop, its checked
 * option: ↑/↓ move between stops as before, ←/→ pick within the pill (native radio keys).
 * Disabled rows use `aria-disabled`, not `disabled`, so keyboard focus can still land on them.
 * The host injects the menu hook (`useTaxonomyRowMenuHook`, normally `useTaxonomyRowMenu`) and its segmented
 * control (`ChatSettingsSegmented`), which lives in the host's chat UI library.
 */
export function DockSettingsMenu({ label, sections, notice, useTaxonomyRowMenuHook, ChatSettingsSegmented }: {
  label: string; sections: DockSettingsMenuSection[]; notice?: string | undefined; useTaxonomyRowMenuHook: typeof useTaxonomyRowMenu;
  ChatSettingsSegmented: ComponentType<DockSettingsSegmentedProps>;
}) {
  const helpId = useId();
  // Each section's first row index in the flat roving-focus order; a segmented choice is one stop.
  let nextIndex = 0;
  const placed = sections.map((section) => {
    const firstIndex = nextIndex;
    nextIndex += isChoiceSection(section) ? 1 : section.items.length;
    return { section, firstIndex };
  });
  const menu = useTaxonomyRowMenuHook({ itemCount: nextIndex });
  return <>
    <button
      ref={menu.triggerRef}
      type="button"
      className="jini-assistant-dock-icon-button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={menu.open}
      onClick={menu.onTriggerClick}
      onKeyDown={menu.onTriggerKeyDown}
    >
      <RemixIcon name="settings-3-line" size={16} />
    </button>
    {menu.open ? createPortal(
      <div
        ref={menu.menuRef}
        role="menu"
        aria-label={label}
        className={`row-menu-popup jini-dock-settings-menu${menu.position?.placement === "above" ? " row-menu-popup-above" : ""}`}
        style={popupStyle(menu.position)}
        onKeyDown={menu.onMenuKeyDown}
      >
        {placed.map(({ section, firstIndex }, sectionIndex) => <MenuSection key={section.key} section={section} separated={sectionIndex > 0}
          firstIndex={firstIndex} helpId={helpId} menu={menu} Segmented={ChatSettingsSegmented} />)}
        {notice ? <p className="jini-dock-settings-menu-notice" role="status">{notice}</p> : null}
      </div>,
      document.body,
    ) : null}
  </>;
}

/** Off-screen and hidden until the hook has measured the popup; lifted when it opens above the gear. */
function popupStyle(position: DockMenu["position"]): CSSProperties {
  return {
    position: "fixed",
    top: position ? position.top : -9999,
    left: position ? position.left : -9999,
    visibility: position ? "visible" : "hidden",
    transform: position?.placement === "above" ? "translateY(-100%)" : undefined,
    maxHeight: popupMaxHeight(position),
  };
}

/**
 * Caps the menu to the room on its side of the gear so it scrolls instead of running off-screen
 * when neither side fits it (a short phone viewport with the dock sheet half-way up). The hook
 * checks "fits below" first, so a capped below-menu still fits below on re-measure and never flips.
 */
function popupMaxHeight(position: DockMenu["position"]): string | undefined {
  if (!position) return undefined;
  return position.placement === "above" ? `${Math.max(0, position.top - 4)}px` : `calc(100dvh - ${position.top + 8}px)`;
}

function MenuSection({ section, separated, firstIndex, helpId, menu, Segmented }: {
  section: DockSettingsMenuSection; separated: boolean; firstIndex: number; helpId: string; menu: DockMenu;
  Segmented: ComponentType<DockSettingsSegmentedProps>;
}) {
  return <>
    {separated ? <div role="separator" className="jini-dock-settings-menu-separator" /> : null}
    <div role="group" aria-labelledby={section.label ? `dock-settings-${section.key}` : undefined}
      aria-describedby={section.tooltip ? `${helpId}-section-${section.key}` : undefined}>
      {/* The section's one ⓘ sits beside the heading, not in it, so the group's name stays the heading alone. */}
      {section.label ? <div className="jini-dock-settings-menu-heading-row">
        <div id={`dock-settings-${section.key}`} className="jini-dock-settings-menu-heading">{section.label}</div>
        {section.tooltip ? <InfoTip label={section.tooltip} descriptionId={`${helpId}-section-${section.key}`} /> : null}
      </div> : null}
      {isChoiceSection(section)
        ? <MenuChoice section={section} itemIndex={firstIndex} name={`${helpId}-${section.key}`} menu={menu} Segmented={Segmented} />
        : section.items.map((item, offset) => <MenuRow key={item.key} item={item} itemIndex={firstIndex + offset} helpId={helpId} menu={menu} />)}
    </div>
  </>;
}

/** A radio section as the dialog's segmented pill; a choice applies in place and leaves the menu open. */
function MenuChoice({ section, itemIndex, name, menu, Segmented }: {
  section: DockSettingsMenuSection; itemIndex: number; name: string; menu: DockMenu; Segmented: ComponentType<DockSettingsSegmentedProps>;
}) {
  return <div className="jini-dock-settings-menu-choice">
    <Segmented name={name} inputRole="menuitemradio"
      // The hook's roving focus only calls `focus()`, so the checked radio can fill a button's slot.
      checkedRef={(input) => { menu.itemRefs.current[itemIndex] = input as unknown as HTMLButtonElement | null; }}
      items={section.items.map((item) => ({ ...item, change: () => activateDockMenuItem({ item, selectItem: menu.selectItem }) }))} />
  </div>;
}

function MenuRow({ item, itemIndex, helpId, menu }: { item: DockSettingsMenuItem; itemIndex: number; helpId: string; menu: DockMenu }) {
  const checkable = item.role === "menuitemradio" || item.role === "menuitemcheckbox";
  const descriptionId = `${helpId}-${item.key}`;
  return <div className="jini-dock-settings-menu-row">
    <button
      ref={(element) => { menu.itemRefs.current[itemIndex] = element; }}
      type="button"
      role={item.role ?? "menuitem"}
      aria-checked={checkable ? Boolean(item.checked) : undefined}
      tabIndex={-1}
      className="row-menu-item"
      aria-describedby={item.tooltip ? descriptionId : undefined}
      aria-disabled={item.disabled ? true : undefined}
      onClick={() => activateDockMenuItem({ item, selectItem: menu.selectItem })}
    >
      {checkable ? <span className="jini-dock-settings-menu-check" aria-hidden="true"><RemixIcon name="check-line" size={14} /></span> : null}
      {item.label}
    </button>
    {item.tooltip ? <InfoTip label={item.tooltip} descriptionId={descriptionId} /> : null}
  </div>;
}
