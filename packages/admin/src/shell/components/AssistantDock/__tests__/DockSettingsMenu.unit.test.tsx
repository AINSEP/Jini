// @vitest-environment jsdom
import { cleanup, fireEvent, render as renderBare, screen } from "@testing-library/react";
import { createRef, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import type { useTaxonomyRowMenu } from "../../../../screens/taxonomy/TaxonomyRowMenu.hooks.js";
import { DockSettingsMenu, type DockSettingsSegmentedProps } from "../DockSettingsMenu.js";
import type { DockSettingsMenuSection } from "../dock-header-rules.js";

/**
 * @file `DockSettingsMenu` popup markup for every popup position, against a typed fake of its menu
 * hook (the `useTaxonomyRowMenuHook` seam), rendered under the fake admin kit. Section and row markup with the
 * host's real info tip and segmented control, and open/close and focus behaviour with the real
 * hook, stay in the host's own tests.
 */

const kit = fakeAdminKit();
const render = (ui: ReactElement) => renderBare(<AdminKitProvider kit={kit}>{ui}</AdminKitProvider>);

afterEach(cleanup);

type Menu = ReturnType<typeof useTaxonomyRowMenu>;

/** A stand-in for the host's segmented pill: one radio per option, enough to lay a choice section out. */
function Segmented({ name, items, inputRole, checkedRef }: DockSettingsSegmentedProps) {
  return <div>{items.map((item) => <input key={item.key} ref={item.checked ? checkedRef : undefined} type="radio" name={name} role={inputRole} aria-label={item.label}
    checked={Boolean(item.checked)} onChange={item.change} />)}</div>;
}

/** An always-open (or closed) menu at a fixed position that records its close-then-run calls. */
function fakeMenu(state: { open: boolean; position: Menu["position"] }) {
  const selected: Array<() => void> = [];
  const itemRefs: Menu["itemRefs"] = { current: [] };
  const menu: Menu = {
    ...state, triggerRef: createRef(), menuRef: createRef(), itemRefs,
    onTriggerClick: () => {}, onTriggerKeyDown: () => {}, onMenuKeyDown: () => {},
    selectItem: ({ onSelect }) => { selected.push(onSelect); },
  };
  const useMenu: typeof useTaxonomyRowMenu = () => menu;
  return { menu, useMenu, selected };
}

const SECTIONS: DockSettingsMenuSection[] = [
  { key: "show", label: "Show", tooltip: "• Shown: visible", items: [
    { key: "shown", label: "Shown", role: "menuitemradio", checked: true },
    { key: "hidden", label: "Hidden", role: "menuitemradio" },
  ] },
  { key: "toggles", label: "Toggles", items: [
    { key: "wrap", label: "Wrap", role: "menuitemcheckbox", checked: false, tooltip: "Wrap long lines" },
  ] },
  { key: "actions", items: [
    { key: "open", label: "Open settings", onSelect: () => {} },
    { key: "soon", label: "Coming soon", disabled: true },
  ] },
];

function renderMenu(state: { open: boolean; position: Menu["position"] }, notice?: string) {
  const fake = fakeMenu(state);
  render(<DockSettingsMenu label="Chat settings" sections={SECTIONS} notice={notice} useTaxonomyRowMenuHook={fake.useMenu} ChatSettingsSegmented={Segmented} />);
  return fake;
}

/** A measured popup, so role queries can see it (an unmeasured one is `visibility: hidden`). */
const PLACED = { open: true, position: { top: 0, left: 0, placement: "below" } } as const;

const popup = () => document.querySelector<HTMLElement>("[role=menu]")!;

describe("popup", () => {
  it("renders only the gear while closed", () => {
    renderMenu({ open: false, position: null });
    expect(screen.getByRole("button", { name: "Chat settings" }).getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[role=menu]")).toBeNull();
  });

  it("keeps an unmeasured popup hidden off-screen", () => {
    renderMenu({ open: true, position: null });
    expect(popup().className).toBe("jini-row-menu-popup jini-dock-settings-menu");
    expect(popup().style.cssText).toBe("position: fixed; top: -9999px; left: -9999px; visibility: hidden;");
  });

  it("places a measured popup below the gear", () => {
    renderMenu({ open: true, position: { top: 10, left: 20, placement: "below" } });
    expect(popup().className).toBe("jini-row-menu-popup jini-dock-settings-menu");
    // Capped to the room below the gear (top + 8px margin) so a short viewport scrolls the menu.
    expect(popup().style.cssText).toBe("position: fixed; top: 10px; left: 20px; visibility: visible; max-height: calc(100dvh - 18px);");
  });

  it("lifts a popup that opens above the gear", () => {
    renderMenu({ open: true, position: { top: 10, left: 20, placement: "above" } });
    expect(popup().className).toBe("jini-row-menu-popup jini-dock-settings-menu jini-row-menu-popup-above");
    expect(popup().style.transform).toBe("translateY(-100%)");
  });

  it("shows a notice under the rows only when one is given", () => {
    renderMenu(PLACED, "Could not save.");
    expect(screen.getByRole("status").textContent).toBe("Could not save.");
    cleanup();
    renderMenu(PLACED);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("activating rows", () => {
  function renderActions() {
    const pick = vi.fn();
    const wrap = vi.fn();
    const open = vi.fn();
    const soon = vi.fn();
    const sections: DockSettingsMenuSection[] = [
      { key: "show", label: "Show", items: [{ key: "shown", label: "Shown", role: "menuitemradio", checked: true, onSelect: vi.fn() }, { key: "hidden", label: "Hidden", role: "menuitemradio", onSelect: pick }] },
      { key: "toggles", label: "Toggles", items: [{ key: "wrap", label: "Wrap", role: "menuitemcheckbox", checked: false, onSelect: wrap }] },
      { key: "actions", items: [{ key: "open", label: "Open settings", onSelect: open }, { key: "soon", label: "Coming soon", disabled: true, onSelect: soon }] },
    ];
    const fake = fakeMenu(PLACED);
    render(<DockSettingsMenu label="Chat settings" sections={sections} useTaxonomyRowMenuHook={fake.useMenu} ChatSettingsSegmented={Segmented} />);
    return { ...fake, pick, wrap, open, soon };
  }

  it("applies a segmented choice and a checkbox row in place, without closing the menu", () => {
    const { pick, wrap, selected } = renderActions();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Hidden" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Wrap" }));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(wrap).toHaveBeenCalledTimes(1);
    expect(selected).toEqual([]);
  });

  it("runs a plain row through the menu's close-then-run and ignores a disabled row", () => {
    const { open, soon, selected } = renderActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Coming soon" }));
    expect(selected).toEqual([open]);
    expect(open).not.toHaveBeenCalled();
    expect(soon).not.toHaveBeenCalled();
  });

  it("registers the checked choice (one slot per choice section) and every row in the roving-focus list, in menu order", () => {
    const { menu } = renderActions();
    expect(menu.itemRefs.current).toEqual([
      screen.getByRole("menuitemradio", { name: "Shown" }),
      screen.getByRole("menuitemcheckbox", { name: "Wrap" }),
      screen.getByRole("menuitem", { name: "Open settings" }),
      screen.getByRole("menuitem", { name: "Coming soon" }),
    ]);
  });
});

