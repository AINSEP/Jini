// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminMenuItem } from "../api/menus-api.types.js";
import type { MenuEditorController } from "../hooks/use-menu-editor.hooks.js";
import { useMenuItemRemove } from "../MenuEditor.hooks.js";
import { MenuEditor } from "../MenuEditor.js";
import { MenuItemTargetFields } from "../MenuItemFields.js";
import { useMenuPageLinkFields, useMenuTargetEditor } from "../MenuPageLinkFields.hooks.js";
import type { MenuTabStrip } from "../MenuModeTabs.js";
import { targetForKind } from "../page-link-rules.js";

/**
 * @file `MenuEditor` against a controller double and double host collaborators (tab strip, row hooks,
 * list route): the component renders and wires from its required props alone — no fetch, no router,
 * no host module. The fetch-driven flows through the host's wired hook stay in the host's own tests.
 */

afterEach(cleanup);

const tabStrip: MenuTabStrip = {
  useTabBarKeyboard: () => ({ onKeyDown: () => {} }),
  resolveTabBarTabIndex: ({ activeId, tab }) => (tab.id === activeId ? 0 : -1),
};
const host = { tabStrip, rowHooks: { useMenuItemRemove, useMenuTargetEditor, useMenuPageLinkFields }, menusHref: "/admin/menus" };

const MENU_WITH_NESTED_CHILD: { menu: { id: string; title: string; slug: string; version: number; items: AdminMenuItem[] } } = {
  menu: {
    id: "m1", title: "Main Menu", slug: "main-menu", version: 1,
    items: [
      {
        id: "parent", label: "Parent", target: { kind: "url", href: "/parent" },
        children: [{ id: "child", label: "Child", target: { kind: "url", href: "/child" } }],
      },
      { id: "leaf", label: "Leaf", target: { kind: "url", href: "/leaf" } },
    ],
  },
};

/**
 * `targetForKind` — pulled apart from the four `?? ""` fallbacks that used to be inline
 * (2026-08-06, complexity pass, fourth pass; see `orEmpty`'s own doc in the source file). The
 * `item-row fields` describe block above only ever renders a "url" target through the full
 * `MenuEditor`; these tests exercise all four kinds directly, no fetch/render involved.
 */
describe("targetForKind", () => {
  it("switches to url, carrying over an existing href", () => {
    expect(targetForKind({ kind: "url", prev: { kind: "route", route: "unused" } })).toEqual({
      kind: "url",
      href: "",
    });
    expect(targetForKind({ kind: "url", prev: { kind: "url", href: "/old" } })).toEqual({
      kind: "url",
      href: "/old",
    });
  });

  it("switches to route, defaulting to an empty string when the previous target had none", () => {
    expect(targetForKind({ kind: "route", prev: { kind: "url", href: "/x" } })).toEqual({ kind: "route", route: "" });
  });

  it("switches to entryRef, defaulting to an empty string when the previous target had none", () => {
    expect(targetForKind({ kind: "entryRef", prev: { kind: "url", href: "/x" } })).toEqual({
      kind: "entryRef",
      entryId: "",
    });
  });

  it("switches to termRef, defaulting BOTH termId and taxonomy independently", () => {
    expect(targetForKind({ kind: "termRef", prev: { kind: "termRef", termId: "t1", taxonomy: "" } })).toEqual({
      kind: "termRef",
      termId: "t1",
      taxonomy: "",
    });
    expect(targetForKind({ kind: "termRef", prev: { kind: "url", href: "/x" } })).toEqual({
      kind: "termRef",
      termId: "",
      taxonomy: "",
    });
  });
});


/**
 * `MenuItemTargetFields` — same extraction, the rendered half. Direct render tests for the three
 * kinds ("route"/"entryRef"/"termRef") the full-`MenuEditor` fixture above never exercises (it only
 * ever seeds "url" targets).
 */
describe("MenuItemTargetFields", () => {
  const noop = () => {};
  const t = (key: string) => key;

  it("renders a Route name field for a route target, pre-filled from the item", () => {
    render(
      <MenuItemTargetFields item={{ id: "i1", target: { kind: "route", route: "/dashboard" } }} path={[0]} onChange={noop} t={t} />,
    );
    expect(screen.getByPlaceholderText("route name")).toHaveValue("/dashboard");
  });

  it("renders an Entry ID field for an entryRef target, defaulting to empty when absent", () => {
    render(<MenuItemTargetFields item={{ id: "i1", target: { kind: "entryRef" } }} path={[0]} onChange={noop} t={t} />);
    expect(screen.getByPlaceholderText("entry id")).toHaveValue("");
  });

  it("renders BOTH Term ID and Taxonomy fields for a termRef target", () => {
    render(
      <MenuItemTargetFields
        item={{ id: "i1", target: { kind: "termRef", termId: "t1", taxonomy: "category" } }}
        path={[0]}
        onChange={noop}
        t={t}
      />,
    );
    expect(screen.getByPlaceholderText("term id")).toHaveValue("t1");
    expect(screen.getByPlaceholderText("taxonomy")).toHaveValue("category");
  });

  it.each([
    { target: { kind: "url", href: "/old" }, field: "URL", value: "/new", expected: { kind: "url", href: "/new" } },
    { target: { kind: "route", route: "old" }, field: "Route name", value: "dashboard", expected: { kind: "route", route: "dashboard" } },
    { target: { kind: "entryRef", entryId: "e1" }, field: "Entry ID", value: "e2", expected: { kind: "entryRef", entryId: "e2" } },
    { target: { kind: "termRef", termId: "t1", taxonomy: "category" }, field: "Term ID", value: "t2", expected: { kind: "termRef", termId: "t2", taxonomy: "category" } },
    { target: { kind: "termRef", termId: "t1", taxonomy: "category" }, field: "Taxonomy", value: "tag", expected: { kind: "termRef", termId: "t1", taxonomy: "tag" } },
  ] as const)("writes $field to its own target field, retaining the rest of the item", ({ target, field, value, expected }) => {
    const item: AdminMenuItem = { id: "i1", label: "Link", target, attrs: { cssClass: "featured" }, children: [] };
    let changed: AdminMenuItem | undefined;
    const onChange = vi.fn((_path: number[], update: (item: AdminMenuItem) => AdminMenuItem) => { changed = update(item); });
    render(<MenuItemTargetFields item={item} path={[1, 0]} onChange={onChange} t={t} />);
    fireEvent.change(screen.getByLabelText(field), { target: { value } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([1, 0], expect.any(Function));
    expect(changed).toEqual({ ...item, target: expected });
  });
});

describe("injected hook seam (useMenuEditorHook)", () => {
  function fakeController(overrides: Partial<MenuEditorController> = {}): MenuEditorController {
    return {
      copyHtmlEmbed: vi.fn(),
      copyFeedback: null,
      isNew: true,
      menu: null,
      title: "",
      setTitle: vi.fn(),
      slug: "",
      setSlug: vi.fn(),
      items: [],
      mode: "items",
      changeMode: vi.fn(),
      html: "",
      setHtml: vi.fn(),
      message: null,
      error: null,
      loading: true,
      confirmLeave: vi.fn(() => true),
      changeAt: vi.fn(),
      removeAt: vi.fn(),
      addChildAt: vi.fn(),
      moveAt: vi.fn(),
      addRootItem: vi.fn(),
      save: vi.fn(async () => {}),
      saving: false,
      t: (key) => key,
      ...overrides,
    };
  }

  it("renders from a fake controller, proving the real hook is not hardcoded — no host wiring involved", () => {
    const controller = fakeController();
    const useMenuEditorHook = vi.fn(() => controller);

    render(<MenuEditor {...host} menuId="m1" useMenuEditorHook={useMenuEditorHook} />);

    // `loading: true` renders the loading notice regardless of `isNew`/`menuId` — reaching it
    // synchronously, with no host wiring queued, is only possible via the injected fake.
    expect(screen.getByText("Loading menu…")).toBeInTheDocument();
    expect(useMenuEditorHook).toHaveBeenCalledWith({ menuId: "m1" });
  });

  it("shows save status and disables Save while saving", async () => {
    const user = userEvent.setup();
    const controller = fakeController({ loading: false, saving: true, message: "Saved · version 2", error: "Save failed" });
    render(<MenuEditor {...host} menuId="m1" useMenuEditorHook={() => controller} />);
    expect(screen.getByText("Saved · version 2")).toHaveClass("jini-save-ok");
    expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByRole("alert")).toHaveClass("jini-notice", "jini-notice-error");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(controller.save).not.toHaveBeenCalled();
  });

  it("wires create-mode Save, Add item, and a nested Add child to the controller", async () => {
    const user = userEvent.setup();
    const controller = fakeController({ loading: false, items: MENU_WITH_NESTED_CHILD.menu.items as AdminMenuItem[] });
    render(<MenuEditor {...host} menuId={null} useMenuEditorHook={() => controller} />);
    expect(screen.getByRole("heading", { name: "New menu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(controller.save).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "+ Add item" }));
    expect(controller.addRootItem).toHaveBeenCalledTimes(1);
    const childFields = screen.getByDisplayValue("Child").closest(".jini-menu-item-row")!.querySelector(".jini-menu-item-fields") as HTMLElement;
    await user.click(within(childFields).getByRole("button", { name: "+ child" }));
    expect(controller.addChildAt).toHaveBeenCalledTimes(1);
    expect(controller.addChildAt).toHaveBeenCalledWith({ path: [0, 0] });
  });

  it("shows only the error when an existing menu failed to load", () => {
    const controller = fakeController({ loading: false, isNew: false, menu: null, error: "menu not found" });
    const { container } = render(<MenuEditor {...host} menuId="m1" useMenuEditorHook={() => controller} />);
    expect(container.textContent).toBe("menu not found");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("sends HTML-mode edits to the controller", () => {
    const controller = fakeController({ loading: false, mode: "html", html: "<nav></nav>" });
    render(<MenuEditor {...host} menuId={null} useMenuEditorHook={() => controller} />);
    fireEvent.change(screen.getByLabelText("Menu HTML"), { target: { value: "<nav>x</nav>" } });
    expect(controller.setHtml).toHaveBeenCalledWith("<nav>x</nav>");
  });

  it("shows an unlabelled item's label field empty and types the label through changeAt", () => {
    const unlabelled = { id: "bare", target: { kind: "url", href: "/" } } as unknown as AdminMenuItem;
    // The updater reads the input's value when applied, so apply it inside the change event.
    const applied: Array<{ path: number[]; next: AdminMenuItem }> = [];
    const changeAt = vi.fn(({ path, fn }: { path: number[]; fn: (item: AdminMenuItem) => AdminMenuItem }) => {
      applied.push({ path, next: fn(unlabelled) });
    });
    const controller = fakeController({ loading: false, items: [unlabelled], changeAt });
    render(<MenuEditor {...host} menuId={null} useMenuEditorHook={() => controller} />);
    const label = screen.getByLabelText("Item label");
    expect(label).toHaveValue("");
    fireEvent.change(label, { target: { value: "Docs" } });
    expect(applied).toEqual([{ path: [0], next: { ...unlabelled, label: "Docs" } }]);
  });
});
