// @vitest-environment jsdom
import { fireEvent, render, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { WidgetConfigFields, type WidgetConfigFieldsProps } from "../WidgetConfigFields.js";

afterEach(cleanup);

it("forwards collection changes to the reset-owning hook with either test catalog", async () => {
  const setCollection = vi.fn();
  const props: WidgetConfigFieldsProps = {
    widgetType: "recent-entries", config: { collection: "first", sort: "-price" }, onChange: vi.fn(), t: key => key, MediaContentEditor: () => null,
    port: { listCollections: async () => [], listMenus: async () => [], listForms: async () => [] },
    useFetchedOptionsHook: () => ({ items: null, error: null }),
    useRecentEntriesConfigHook: () => ({ collection: "first", sort: "-price", layout: "", columns: "", fields: [], filterField: "", filterValue: "", setCollection, setSort: vi.fn(), setLayout: vi.fn(), setColumns: vi.fn(), toggleField: vi.fn(), setFilterField: vi.fn(), setFilterValue: vi.fn() }),
    useSocialLinksConfigHook: () => ({ links: [], updateLink: vi.fn(), removeLink: vi.fn(), addLink: vi.fn() }),
    rules: { COLLECTION_DISPLAYABLE_FIELD_KINDS: new Set(["text", "integer"]), humanizeFieldName: ({ name }) => name, asciiSlug: ({ text }) => text },
  };
  const first = [{ key: "first", label: "First", fields: [{ name: "price", kind: "integer" as const }] }, { key: "second", label: "Second", fields: [{ name: "title", kind: "text" as const }] }];
  const second = [{ key: "other", label: "Other", fields: [] }];
  const useFetchedOptionsHook: WidgetConfigFieldsProps["useFetchedOptionsHook"] = <T,>({ fetchList }: { fetchList: () => Promise<T[]> }) => {
    const [items, setItems] = useState<T[] | null>(null);
    useEffect(() => { void fetchList().then(setItems); }, []);
    return { items, error: null };
  };
  for (const catalog of [first, second]) {
    const view = render(<WidgetConfigFields {...props} port={{ ...props.port, listCollections: async () => catalog }} useFetchedOptionsHook={useFetchedOptionsHook} />);
    await waitFor(() => expect(view.getByLabelText("Collection").hasAttribute("disabled")).toBe(false));
    fireEvent.change(view.getByLabelText("Collection"), { target: { value: catalog.length > 1 ? "second" : "other" } });
    view.unmount();
  }
  expect(setCollection.mock.calls).toEqual([[{ value: "second" }], [{ value: "other" }]]);
});

function configFixture(): WidgetConfigFieldsProps {
  return {
    widgetType: "text", config: {}, onChange: vi.fn(), t: key => key, MediaContentEditor: () => null,
    port: {
      listCollections: async () => { throw new Error("unexpected collection read"); },
      listMenus: async () => { throw new Error("unexpected menu read"); },
      listForms: async () => { throw new Error("unexpected form read"); },
    },
    useFetchedOptionsHook: useOptions,
    useRecentEntriesConfigHook: () => { throw new Error("unexpected collection controls"); },
    useSocialLinksConfigHook: () => { throw new Error("unexpected social-link controls"); },
    rules: { COLLECTION_DISPLAYABLE_FIELD_KINDS: new Set(["text", "integer"]), humanizeFieldName: ({ name }) => `Field ${name}`,
      asciiSlug: ({ text }) => text.toLowerCase().replaceAll("_", "-") },
  };
}

// Drive the component's real fetch closures through the injected host binding.
function useOptions<T>({ fetchList }: { fetchList: () => Promise<T[]> },
  { errorFallback }: { errorFallback: string }) {
  const [state, setState] = useState<{ items: T[] | null; error: string | null }>({ items: null, error: null });
  useEffect(() => {
    let open = true;
    void fetchList().then(
      items => { if (open) setState({ items, error: null }); },
      () => { if (open) setState({ items: null, error: errorFallback }); },
    );
    return () => { open = false; };
  }, []);
  return state;
}

it("text edits retain sibling config and publish a handle only when requested", () => {
  const onChange = vi.fn();
  const props = configFixture();
  const view = render(<WidgetConfigFields {...props} onChange={onChange} agentHandle="widget-settings" config={{ body: "Old text", id: "preserved" }} />);
  const body = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Text" });
  expect(body.value).toBe("Old text");
  expect(body.getAttribute("data-agent-element")).toBe("widget-settings-body");
  fireEvent.change(body, { target: { value: "New text" } });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ body: "New text", id: "preserved" });
  view.rerender(<WidgetConfigFields {...props} onChange={onChange} config={{ body: 45 }} />);
  expect(body.value).toBe("");
  expect(body.hasAttribute("data-agent-element")).toBe(false);
});

it("social controls edit the addressed row, allow adding below twenty, and stop at the limit", () => {
  const props = configFixture();
  const updateLink = vi.fn(), removeLink = vi.fn(), addLink = vi.fn();
  const link = { platform: "Blog", url: "https://blog.example" };
  const controller = { links: [{ ...link, platform: "Home" }, link], updateLink, removeLink, addLink };
  const mounted = render(<WidgetConfigFields {...props} widgetType="social-links" agentHandle="social" useSocialLinksConfigHook={() => controller} />);
  const row = within(mounted.getByRole("group", { name: "Link 2" }));
  const platform = row.getByRole<HTMLInputElement>("textbox", { name: "Platform" });
  const url = row.getByRole<HTMLInputElement>("textbox", { name: "URL" });
  expect(platform.value).toBe("Blog");
  expect(platform.getAttribute("data-agent-element")).toBe("social-link-1-platform");
  expect(url.value).toBe("https://blog.example");
  fireEvent.change(platform, { target: { value: "Docs" } });
  fireEvent.change(url, { target: { value: "https://docs.example" } });
  fireEvent.click(row.getByRole("button", { name: "Remove" }));
  const add = mounted.getByRole("button", { name: "Add link" }) as HTMLButtonElement;
  fireEvent.click(add);
  expect(updateLink.mock.calls).toEqual([[{ index: 1, patch: { platform: "Docs" } }], [{ index: 1, patch: { url: "https://docs.example" } }]]);
  expect(removeLink).toHaveBeenCalledExactlyOnceWith({ index: 1 });
  expect(addLink).toHaveBeenCalledOnce();
  mounted.rerender(<WidgetConfigFields {...props} widgetType="social-links" useSocialLinksConfigHook={() => ({
    ...controller, links: Array.from({ length: 20 }, () => link),
  })} />);
  expect(add.disabled).toBe(true);
  expect(add.hasAttribute("data-agent-element")).toBe(false);
  fireEvent.click(add);
  expect(addLink).toHaveBeenCalledTimes(1);
});

it("menu selection is loaded asynchronously and edits the selected reference, not its label", async () => {
  const props = configFixture();
  const listMenus = vi.fn(async () => [{ id: "main", title: "Main nav", status: "active" }, { id: "old", title: "Old nav", status: "disabled" }]);
  const onChange = vi.fn();
  const mounted = render(<WidgetConfigFields {...props} widgetType="menu" agentHandle="settings"
    config={{ menuRef: "main", preserved: "yes" }} onChange={onChange} port={{ ...props.port, listMenus }} />);
  expect(mounted.getByText("Loading menus…").textContent).toBe("Loading menus…");
  const select = (await mounted.findByRole("combobox", { name: "Menu" })) as HTMLSelectElement;
  expect(listMenus).toHaveBeenCalledExactlyOnceWith();
  expect(select.value).toBe("main");
  expect(select.getAttribute("data-agent-element")).toBe("settings-menu-ref");
  expect((within(select).getByRole("option", { name: "Old nav (disabled)" }) as HTMLOptionElement).value).toBe("old");
  fireEvent.change(select, { target: { value: "old" } });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ menuRef: "old", preserved: "yes" });
});

it("contact-form pick reports form status and clearing its optional message does not clear the selected form", async () => {
  const props = configFixture();
  const listForms = vi.fn(async () => [{ id: "newsletter", name: "Newsletter", status: "active" }, { id: "sales", name: "Sales", status: "disabled" }]);
  const port = { ...props.port, listForms };
  const onChange = vi.fn();
  function Probe() {
    const [config, setConfig] = useState<Record<string, unknown>>({ formDefinitionId: "newsletter", successMessage: "Thank you" });
    return <WidgetConfigFields {...props} widgetType="contact-form" agentHandle="settings" {...{ port, config }}
      onChange={next => { setConfig(next); onChange(next); }} />;
  }
  const mounted = render(<Probe />);
  expect(mounted.getByText("Loading forms…").textContent).toBe("Loading forms…");
  const select = (await mounted.findByRole("combobox", { name: "Form" })) as HTMLSelectElement;
  expect(listForms).toHaveBeenCalledExactlyOnceWith();
  expect(select.value).toBe("newsletter");
  expect(select.getAttribute("data-agent-element")).toBe("settings-form-definition-id");
  expect((within(select).getByRole("option", { name: "Sales — disabled" }) as HTMLOptionElement).value).toBe("sales");
  fireEvent.change(select, { target: { value: "sales" } });
  const message = mounted.getByRole("textbox", { name: "Success message (optional)" }) as HTMLInputElement;
  expect(message.getAttribute("data-agent-element")).toBe("settings-success-message");
  fireEvent.change(message, { target: { value: "We will follow up" } });
  fireEvent.change(message, { target: { value: "" } });
  expect(onChange.mock.calls).toEqual([
    [{ formDefinitionId: "sales", successMessage: "Thank you" }],
    [{ formDefinitionId: "sales", successMessage: "We will follow up" }],
    [{ formDefinitionId: "sales", successMessage: undefined }],
  ]);
  expect(select.value).toBe("sales");
  expect(message.value).toBe("");
});

it("menu, form and collection fetch failures show their own error and remove the selector", async () => {
  const rejected = async () => { throw new Error("offline"); };
  const props = configFixture();
  const port = { listMenus: rejected, listForms: rejected, listCollections: rejected };
  const recent = {
    collection: "", sort: "", layout: "", columns: "" as const, fields: [], filterField: "", filterValue: "",
    setCollection: vi.fn(), setSort: vi.fn(), setLayout: vi.fn(), setColumns: vi.fn(), toggleField: vi.fn(), setFilterField: vi.fn(), setFilterValue: vi.fn(),
  };
  for (const [widgetType, selector, error] of [
    ["menu", "Menu", "failed to load menus"],
    ["contact-form", "Form", "failed to load forms"],
    ["recent-entries", "Collection", "failed to load collections"],
  ] as const) {
    const mounted = render(<WidgetConfigFields {...props} {...{ port, widgetType }} useRecentEntriesConfigHook={() => recent} />);
    expect((await mounted.findByText(error)).classList.contains("error")).toBe(true);
    expect(mounted.queryByRole("combobox", { name: selector })).toBeNull();
    mounted.unmount();
  }
});

it("collection list renders only displayable fields and forwards each change with the correct kind", async () => {
  const props = configFixture();
  const onChange = vi.fn(), setSort = vi.fn(), setLayout = vi.fn(), setColumns = vi.fn(), toggleField = vi.fn(),
    setFilterField = vi.fn(), setFilterValue = vi.fn();
  const listCollections = vi.fn(async () => [{ key: "catalog", label: "Catalog", fields: [
    { name: "unit_price", kind: "integer" as const }, { name: "details", kind: "json" as const },
  ] }]);
  const config = { categoryTermId: "gardening", maxItems: 8, preserve: true };
  const port = { ...props.port, listCollections };
  const controller = { collection: "catalog", sort: "", layout: "cards", columns: 3, fields: ["unit_price"],
    filterField: "unit_price", filterValue: "12", setCollection: vi.fn(), setSort, setLayout, setColumns,
    toggleField, setFilterField, setFilterValue };
  const mounted = render(<WidgetConfigFields {...props} widgetType="recent-entries" agentHandle="settings"
    {...{ config, port, onChange }} useRecentEntriesConfigHook={() => controller} />);
  const title = await mounted.findByRole("option", { name: "Field unit_price (descending)" });
  expect(title.getAttribute("value")).toBe("-unit_price");
  expect(listCollections).toHaveBeenCalledExactlyOnceWith();
  expect(mounted.queryByText(/Field details/)).toBeNull();
  const check = mounted.getByRole("checkbox", { name: "Field unit_price" }) as HTMLInputElement;
  expect(check.checked).toBe(true);
  expect(check.getAttribute("data-agent-element")).toBe("settings-field-unit-price");
  fireEvent.click(check);
  expect(toggleField).toHaveBeenCalledExactlyOnceWith({ name: "unit_price", checked: false });
  fireEvent.change(mounted.getByRole("combobox", { name: "Sort" }), { target: { value: "-unit_price" } });
  expect(setSort).toHaveBeenCalledExactlyOnceWith({ value: "-unit_price" });
  fireEvent.change(mounted.getByRole("combobox", { name: "Layout" }), { target: { value: "list" } });
  expect(setLayout).toHaveBeenCalledExactlyOnceWith({ value: "list" });
  fireEvent.change(mounted.getByRole("spinbutton", { name: "Columns" }), { target: { value: "4" } });
  expect(setColumns).toHaveBeenCalledExactlyOnceWith({ value: "4" });
  fireEvent.change(mounted.getByRole("combobox", { name: "Filter" }), { target: { value: "" } });
  expect(setFilterField).toHaveBeenCalledExactlyOnceWith({ name: "" });
  const value = mounted.getByRole("textbox", { name: "Filter value" }) as HTMLInputElement;
  expect(value.value).toBe("12");
  expect(value.getAttribute("data-agent-element")).toBe("settings-filter-value");
  fireEvent.change(value, { target: { value: "35" } });
  expect(setFilterValue).toHaveBeenCalledExactlyOnceWith({ raw: "35", kind: "integer" });
  const cat = mounted.getByRole("textbox", { name: "Category term id (optional)" });
  fireEvent.change(cat, { target: { value: "kitchen" } });
  fireEvent.change(cat, { target: { value: "" } });
  const max = mounted.getByRole("spinbutton", { name: "Max items" });
  fireEvent.change(max, { target: { value: "9" } });
  fireEvent.change(max, { target: { value: "" } });
  expect(onChange.mock.calls).toEqual([
    [{ ...config, categoryTermId: "kitchen" }], [{ ...config, categoryTermId: undefined }],
    [{ ...config, maxItems: 9 }], [{ ...config, maxItems: undefined }],
  ]);
  mounted.rerender(<WidgetConfigFields {...props} widgetType="recent-entries" {...{ config, port, onChange }}
    useRecentEntriesConfigHook={() => ({ ...controller, layout: "list", filterField: "" })} />);
  expect(mounted.queryByRole("spinbutton", { name: "Columns" })).toBeNull();
  expect(mounted.queryByRole("textbox", { name: "Filter value" })).toBeNull();
});

it("both media and legacy gallery use the bound media editor with the original config and change receiver", () => {
  const props = configFixture();
  const onChange = vi.fn();
  const MediaContentEditor: WidgetConfigFieldsProps["MediaContentEditor"] = ({ widgetType, config, onChange, agentHandle }) =>
    <button data-agent-element={agentHandle} onClick={() => onChange({ ...config, alt: "new" })}>{widgetType} editor</button>;
  const config = { images: ["/one.png"] };
  const mounted = render(<WidgetConfigFields {...props} widgetType="gallery" {...{ config, MediaContentEditor, onChange }} agentHandle="widget-settings" />);
  const gallery = mounted.getByRole("button", { name: "gallery editor" });
  expect(gallery.getAttribute("data-agent-element")).toBe("widget-settings");
  fireEvent.click(gallery);
  mounted.rerender(<WidgetConfigFields {...props} widgetType="media" {...{ config, MediaContentEditor, onChange }} />);
  fireEvent.click(mounted.getByRole("button", { name: "media editor" }));
  expect(onChange.mock.calls).toEqual([[{ images: ["/one.png"], alt: "new" }], [{ images: ["/one.png"], alt: "new" }]]);
});
