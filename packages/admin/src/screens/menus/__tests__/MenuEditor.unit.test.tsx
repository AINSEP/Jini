// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { resolveTabBarTabIndex, useTabBarKeyboard } from "@jini-ai/ui/tab-strip";
import { ItemRow } from "../MenuItemRow.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminMenuItem, AdminMenuMode } from "../api/menus-api.types.js";
import type { MenuEditorController } from "../hooks/use-menu-editor.hooks.js";
import { useMenuItemRemove } from "../MenuEditor.hooks.js";
import { MenuEditor } from "../MenuEditor.js";
import { MenuItemAttrsFields, MenuItemTargetFields } from "../MenuItemFields.js";
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

  it("forwards independent title and slug edits and routes nested row movement and removal", async () => {
    const user = userEvent.setup();
    const setTitle = vi.fn();
    const setSlug = vi.fn();
    const removeAt = vi.fn();
    const moveAt = vi.fn();
    const controller = fakeController({
      loading: false, title: "Navigation", slug: "nav", items: MENU_WITH_NESTED_CHILD.menu.items,
      setTitle, setSlug, removeAt, moveAt,
    });
    render(<MenuEditor {...host} menuId={null} useMenuEditorHook={() => controller} />);
    await user.type(screen.getByRole("textbox", { name: "Menu title" }), "!");
    await user.type(screen.getByRole("textbox", { name: "Menu slug" }), "2");
    expect(setTitle.mock.calls).toEqual([[{ next: "Navigation!" }]]);
    expect(setSlug.mock.calls).toEqual([[{ next: "nav2" }]]);
    const child = within(screen.getByDisplayValue("Child").closest<HTMLElement>(".jini-menu-item-fields")!);
    await user.click(child.getByRole("button", { name: "Move item down" }));
    await user.click(child.getByRole("button", { name: "Remove item" }));
    expect(moveAt.mock.calls).toEqual([[{ path: [0, 0], direction: 1 }]]);
    expect(removeAt.mock.calls).toEqual([[{ path: [0, 0] }]]);
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

it("changes editor mode through both keyboard navigation and click", async () => {
  const user = userEvent.setup();
  const changeMode = vi.fn<(mode: AdminMenuMode) => void>();
  function Editor() {
    const [mode, setMode] = useState<AdminMenuMode>("items");
    const controller: MenuEditorController = {
      copyHtmlEmbed: async () => {}, copyFeedback: null, isNew: true, menu: null,
      title: "Header", setTitle: () => {}, slug: "header", setSlug: () => {}, items: [],
      mode, changeMode: (next) => { changeMode(next); setMode(next); }, html: "<nav>Header</nav>", setHtml: () => {},
      message: null, error: null, loading: false, confirmLeave: () => true, changeAt: () => {}, removeAt: () => {},
      addChildAt: () => {}, moveAt: () => {}, addRootItem: () => {}, save: async () => {}, saving: false, t: (key) => key,
    };
    return <MenuEditor {...host} tabStrip={{ useTabBarKeyboard, resolveTabBarTabIndex }} menuId={null} useMenuEditorHook={() => controller} />;
  }
  render(<Editor />);
  const options = screen.getByRole("tab", { name: "Options" });
  const html = screen.getByRole("tab", { name: "HTML" });
  expect(options).toHaveAttribute("aria-selected", "true");
  options.focus();
  await user.keyboard("{ArrowRight}");
  expect(html).toHaveFocus();
  expect(html).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("textbox", { name: "Menu HTML" })).toHaveValue("<nav>Header</nav>");
  await user.click(options);
  expect(options).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("textbox", { name: "Menu HTML" })).toBeNull();
  expect(changeMode.mock.calls).toEqual([["html"], ["items"]]);
});

it("renders the page picker for a nested Page link and forwards edits and row actions to its nested path", async () => {
  const user = userEvent.setup();
  const child = { id: "child", label: "Child page", target: { kind: "entryRef" as const, entryId: "one", entryType: "page" } };
  const changes: Array<{ path: number[]; result: AdminMenuItem }> = [];
  const onChange = vi.fn((path: number[], update: (item: AdminMenuItem) => AdminMenuItem) => { changes.push({ path, result: update(child) }); });
  const onMove = vi.fn<(path: number[], direction: -1 | 1) => void>();
  const onRemove = vi.fn<(path: number[]) => void>();
  const pages = [
    { id: "one", title: "Docs", status: "published" as const, publicPath: "/docs" },
    { id: "two", title: "FAQ", status: "published" as const, publicPath: "/help" },
  ];
  render(<ItemRow item={{ id: "p", label: "Parent", target: { kind: "url", href: "/parent" }, children: [child] }}
    path={[2]} pages={pages} hooks={host.rowHooks} t={key => key}
    onChange={onChange} onRemove={onRemove} onMove={onMove} onAddChild={() => {}} />);
  const fields = within(screen.getByDisplayValue("Child page").closest<HTMLElement>(".jini-menu-item-fields")!);
  const page = fields.getByRole("combobox", { name: "Page" });
  expect(page).toHaveValue("one");
  expect(fields.queryByRole("textbox", { name: "Entry ID" })).toBeNull();
  await user.selectOptions(page, "two");
  expect(changes).toEqual([{ path: [2, 0], result: {
    ...child, target: { kind: "entryRef", entryId: "two", entryType: "page", lastKnownHref: "/help" },
  } }]);
  await user.click(fields.getByRole("button", { name: "Move item up" }));
  await user.click(fields.getByRole("button", { name: "Move item down" }));
  await user.click(fields.getByRole("button", { name: "Remove item" }));
  expect(onMove.mock.calls).toEqual([[[2, 0], -1], [[2, 0], 1]]);
  expect(onRemove.mock.calls).toEqual([[[2, 0]]]);
});

it("keeps a legacy unknown target's label editable without treating the target as a URL", async () => {
  const user = userEvent.setup();
  // An older admin can encounter a target from a newer deployment's wire response.
  const raw = { id: "external", label: "External link", target: { kind: "externalRef" } } as unknown as AdminMenuItem;
  const changed: AdminMenuItem[] = [];
  const onChange = vi.fn((_path: number[], update: (item: AdminMenuItem) => AdminMenuItem) => changed.push(update(raw)));
  render(<ItemRow item={raw} path={[0]} hooks={host.rowHooks} t={key => key}
    onChange={onChange} onRemove={() => {}} onMove={() => {}} onAddChild={() => {}} />);
  const label = screen.getByRole("textbox", { name: "Item label" });
  const fields = within(label.closest<HTMLElement>(".jini-menu-item-fields")!);
  expect(label).toHaveValue("External link");
  expect(fields.getAllByRole("textbox")).toEqual([label]);
  await user.type(label, "!");
  expect(changed).toEqual([{ ...raw, label: "External link!" }]);
});

it("keeps link targets intact when advanced presentation fields change", async () => {
  const user = userEvent.setup();
  const item: AdminMenuItem = { id: "docs", label: "Docs", target: { kind: "url", href: "/docs" }, attrs: { icon: "book", openInNewTab: true } };
  function Row() {
    const [current, setCurrent] = useState(item);
    return <><MenuItemAttrsFields item={current} t={key => key} path={[2, 0]}
      onChange={(path, updater) => {
        if (path[0] !== 2 || path[1] !== 0 || path.length !== 2) throw new Error(`Wrong row: ${path}`);
        setCurrent(updater);
      }} /><output aria-label="Saved draft">{JSON.stringify(current)}</output></>;
  }
  render(<Row />);
  await user.click(screen.getByText("Advanced"));
  const openInNewTab = screen.getByRole("checkbox", { name: "Open in new tab" });
  expect(openInNewTab).toBeChecked();
  expect(screen.getByRole("textbox", { name: "Icon" })).toHaveValue("book");
  expect(screen.getByRole("textbox", { name: "Link rel" })).toHaveValue("");
  await user.click(openInNewTab);
  await user.type(screen.getByRole("textbox", { name: "Link rel" }), "nofollow");
  const result = screen.getByLabelText("Saved draft").textContent!;
  expect(JSON.parse(result)).toEqual({ ...item, attrs: { icon: "book", openInNewTab: false, rel: "nofollow" } });
});
