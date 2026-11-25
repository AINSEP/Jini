// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminMenu } from "../api/menus-api.types.js";
import type { MenuEditorController } from "../hooks/use-menu-editor.hooks.js";
import { useMenuItemRemove } from "../MenuEditor.hooks.js";
import { MenuEditor } from "../MenuEditor.js";
import type { MenuTabStrip } from "../MenuModeTabs.js";
import { useMenuPageLinkFields, useMenuTargetEditor } from "../MenuPageLinkFields.hooks.js";
import { createDomPageDriver } from "@jini-ai/agentic/dom";

afterEach(cleanup);

const tabStrip: MenuTabStrip = {
  useTabBarKeyboard: () => ({ onKeyDown: () => {} }),
  resolveTabBarTabIndex: ({ activeId, tab }) => (tab.id === activeId ? 0 : -1),
};
const host = { tabStrip, rowHooks: { useMenuItemRemove, useMenuTargetEditor, useMenuPageLinkFields }, menusHref: "/admin/menus" };

const MENU: AdminMenu = {
  id: "m1", workspaceId: "ws", title: "Docs", slug: "docs", status: "published",
  items: [], locations: [], version: 1, updatedAt: "2026-10-20",
};

function controller({ overrides = {} }: { overrides?: Partial<MenuEditorController> }, _options = {}): MenuEditorController {
  return {
    copyHtmlEmbed: vi.fn(async () => {}), copyFeedback: null, isNew: false, menu: MENU,
    title: "Docs", setTitle: vi.fn(), slug: "docs", setSlug: vi.fn(), items: [],
    mode: "items", changeMode: vi.fn(), html: "", setHtml: vi.fn(), message: null,
    error: null, loading: false, confirmLeave: vi.fn(() => true), changeAt: vi.fn(),
    removeAt: vi.fn(), addChildAt: vi.fn(), moveAt: vi.fn(), addRootItem: vi.fn(),
    save: vi.fn(async () => {}), saving: false, t: (key) => key, ...overrides,
  };
}

// These tests target the original full editor's public hook seam, before header extraction.
describe("MenuEditor header characterization", () => {
  it("drives Copy HTML embed through its own handle", async () => {
    const editor = controller({});
    const { container } = render(<MenuEditor {...host} menuId="m1" useMenuEditorHook={() => editor} />);
    const driver = createDomPageDriver({ root: container, pages: {} });
    await driver.click({ handle: "menu-editor-copy-html-embed" });
    expect(editor.copyHtmlEmbed).toHaveBeenCalledTimes(1);
    expect(editor.save).not.toHaveBeenCalled();
  });

  it.each([true, false])("uses the create/edit title when isNew=%s", (isNew) => {
    const editor = controller({ overrides: { isNew } });
    render(<MenuEditor {...host} menuId="m1" useMenuEditorHook={() => editor} />);
    const header = screen.getByRole("heading", { name: isNew ? "New menu" : "Edit menu" }).closest(".jini-page-header");
    expect(header).toHaveClass("jini-page-header-split");
    expect(header).toContainElement(screen.getByRole("link", { name: "Back: Menus" }));
    expect(header).toContainElement(screen.getByRole("button", { name: "Save" }));
  });

  it.each([true, false])("shows the copy action only for a saved menu: %s", (saved) => {
    const editor = controller({ overrides: { menu: saved ? MENU : null, isNew: !saved } });
    render(<MenuEditor {...host} menuId={saved ? "m1" : null} useMenuEditorHook={() => editor} />);
    if (!saved) {
      expect(screen.queryByRole("button", { name: "Copy HTML embed" })).not.toBeInTheDocument();
      return;
    }
    fireEvent.click(screen.getByRole("button", { name: "Copy HTML embed" }));
    expect(editor.copyHtmlEmbed).toHaveBeenCalledTimes(1);
  });

  it.each([
    { copyFeedback: null, message: null },
    { copyFeedback: "", message: "" },
    { copyFeedback: "Copied!", message: null },
    { copyFeedback: null, message: "Saved · version 2" },
    { copyFeedback: "Could not copy embed", message: "Saved · version 2" },
  ])("renders independent feedback and save status: %j", (overrides) => {
    const editor = controller({ overrides });
    const { container } = render(<MenuEditor {...host} menuId="m1" useMenuEditorHook={() => editor} />);
    const status = screen.queryByRole("status");
    if (overrides.copyFeedback) expect(status).toHaveTextContent(overrides.copyFeedback);
    else expect(status).toBeNull();
    const saved = container.querySelector(".jini-save-ok");
    if (overrides.message) expect(saved).toHaveTextContent(overrides.message);
    else expect(saved).toBeNull();
    expect(container.querySelector(".jini-page-header-actions")).toContainElement(screen.getByRole("button", { name: "Save" }));
  });

  it.each([true, false])("honors the saving state: %s", (saving) => {
    const editor = controller({ overrides: { saving } });
    render(<MenuEditor {...host} menuId="m1" useMenuEditorHook={() => editor} />);
    const save = screen.getByRole("button", { name: "Save" });
    if (saving) expect(save).toBeDisabled();
    else expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(editor.save).toHaveBeenCalledTimes(saving ? 0 : 1);
  });

  it("a router-owned Back link does not ask the header to confirm", () => {
    const editor = controller({ overrides: { confirmLeave: vi.fn(() => false), leaveGuardOwner: "router" } });
    render(<MenuEditor {...host} menuId="m1" useMenuEditorHook={() => editor} />);
    const link = screen.getByRole("link", { name: "Back: Menus" });
    let prevented: boolean | undefined;
    const observe = (event: MouseEvent) => {
      prevented = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", observe, { once: true });
    try {
      fireEvent.click(link);
      expect(editor.confirmLeave).not.toHaveBeenCalled();
      expect(prevented).toBe(false);
    } finally {
      document.removeEventListener("click", observe);
    }
  });

  it.each([true, false])("honors the leave guard result: %s", (allowed) => {
    const editor = controller({ overrides: { confirmLeave: vi.fn(() => allowed) } });
    render(<MenuEditor {...host} menuId="m1" useMenuEditorHook={() => editor} />);
    const link = screen.getByRole("link", { name: "Back: Menus" });
    expect(link).toHaveAttribute("href", "/admin/menus");
    expect(link).toHaveTextContent("← Back");
    let prevented: boolean | undefined;
    const observe = (event: MouseEvent) => {
      prevented = event.defaultPrevented;
      event.preventDefault(); // jsdom cannot perform the browser's default navigation.
    };
    document.addEventListener("click", observe, { once: true });
    try {
      fireEvent.click(link);
      expect(editor.confirmLeave).toHaveBeenCalledTimes(1);
      expect(prevented).toBe(!allowed);
    } finally {
      document.removeEventListener("click", observe);
    }
  });
});
