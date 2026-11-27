import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { FetchQueryProvider, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { Dialog } from "@jini-ai/ui-kit/react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { useWidgetAddControl, useWidgetPickerDialog } from "../WidgetPickerDialog.hooks.js";
import { WidgetAddControl, WidgetPickerDialog, WidgetSelectionDialog, type WidgetPickerDialogProps } from "../WidgetPickerDialog.js";

type Deps = Parameters<typeof useWidgetPickerDialog>[0]["deps"];
type Port = Deps["port"];
type Widget = Awaited<ReturnType<Port["listWidgets"]>>["widgets"][number];

const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;
const kit: WidgetPickerDialogProps["kit"] = {
  Dialog,
  Select: ({ id, value, onChange, options, placeholder, "aria-label": label, agentHandle }) => (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} data-agent-element={agentHandle}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
    </select>
  ),
  WidgetConfigFields: ({ config, onChange, agentHandle }) => (
    <label>Widget message<input value={String(config.message)} data-agent-element={agentHandle}
      onChange={(event) => onChange({ ...config, message: event.target.value })} /></label>
  ),
};

function widget(id: string, type: Widget["widgetType"], title: string): Widget {
  return { id, widgetType: type, title, workspaceId: "editors", slug: id, status: "active", config: {}, updatedAt: "2026-11-25", version: 1 };
}

function picker(initial: Widget[] = []) {
  const widgets = [...initial];
  const port = {
    listWidgets: vi.fn<Port["listWidgets"]>(async ({ widgetType }) => ({ widgets: widgets.filter((widget) => widget.widgetType === widgetType) })),
    createWidget: vi.fn<Port["createWidget"]>(async ({ widgetType, title, config }) => {
      const created = { ...widget(`new-${widgets.length + 1}`, widgetType, title), config };
      widgets.push(created);
      return { widget: created };
    }),
  };
  const deps: Deps = {
    useQueryFetchCallback: useCallback, useEffect, useId, useRef, useState, port,
    useAdminLocaleHook: () => "fr", useFetchQuery,
    defaultWidgetConfig: ({ widgetType }) => ({ message: `Default ${widgetType}` }),
    WIDGET_TYPE_OPTIONS: [{ value: "text", label: "Text" }, { value: "menu", label: "Menu" }],
    widgetTypeLabel: ({ widgetType, types }, { t }) => t(types.find(({ value }) => value === widgetType)?.label ?? widgetType),
    translateWidgets: ({ locale, key }) => `${locale}/${key}`,
    sharedComponentsT: ({ key }) => key,
    describeApiError: ({ e, fallback }) => e instanceof Error ? e.message : fallback,
  };
  return {
    port,
    props: {
      kit, deps,
      useDialog: (props: Parameters<WidgetPickerDialogProps["useDialog"]>[0]) => useWidgetPickerDialog({ props, deps }),
      useAddControl: (props: Parameters<typeof useWidgetAddControl>[0]["props"]) => useWidgetAddControl({ props, deps }),
    },
  };
}

it("requires an explicit choice before reusing a loaded widget and offers creation alongside it", async () => {
  const { port, props } = picker([widget("footer", "text", "Footer note"), widget("nav", "menu", "Nav")]);
  const onUseExisting = vi.fn();
  const onCreateNew = vi.fn();
  render(<WidgetPickerDialog {...props} widgetType="text" onUseExisting={onUseExisting} onCreateNew={onCreateNew} onCancel={vi.fn()} agentHandle="place-widget" />, { wrapper });
  const dialog = screen.getByRole("dialog", { name: "Place a fr/Text widget" });
  const select = await within(dialog).findByRole("combobox", { name: "Existing fr/Text widgets" });
  expect(select).toHaveValue("");
  expect(select).toHaveAttribute("data-agent-element", "place-widget-existing-select");
  expect(within(select).getByRole("option", { name: "Footer note" })).toHaveValue("footer");
  expect(within(select).queryByRole("option", { name: "Nav" })).not.toBeInTheDocument();
  expect(within(dialog).getByRole("heading", { name: "Create new" })).toBeVisible();
  expect(within(dialog).getByRole("textbox", { name: "Title" })).not.toHaveFocus();

  const submit = within(dialog).getByRole("button", { name: "Use this widget" });
  fireEvent.click(submit);
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose an existing widget to use.");
  expect(onUseExisting).not.toHaveBeenCalled();
  fireEvent.change(select, { target: { value: "footer" } });
  fireEvent.click(submit);

  expect(onUseExisting.mock.calls).toEqual([["footer"]]);
  expect(onCreateNew).not.toHaveBeenCalled();
  expect(port.createWidget).not.toHaveBeenCalled();
});

it("focuses the title only after an empty result, rejects whitespace, and submits a trimmed title with edited config", async () => {
  const { port, props } = picker();
  let resolveList!: (value: { widgets: Widget[] }) => void;
  port.listWidgets.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
  const onCreateNew = vi.fn();
  render(<WidgetPickerDialog {...props} widgetType="text" onUseExisting={vi.fn()} onCreateNew={onCreateNew} onCancel={vi.fn()} agentHandle="place-widget" />, { wrapper });
  const title = screen.getByRole("textbox", { name: "Title" });
  expect(title).not.toHaveFocus();
  await waitFor(() => expect(port.listWidgets).toHaveBeenCalledWith({ widgetType: "text" }));
  await act(async () => resolveList({ widgets: [] }));
  await waitFor(() => expect(title).toHaveFocus());
  expect(screen.queryByRole("heading", { name: "Use existing" })).not.toBeInTheDocument();

  const submit = screen.getByRole("button", { name: "Create and place" });
  expect(submit).toHaveAttribute("data-agent-element", "place-widget-new-submit");
  fireEvent.change(title, { target: { value: "   " } });
  fireEvent.click(submit);
  expect(screen.getByRole("alert")).toHaveTextContent("Title is required.");
  expect(onCreateNew).not.toHaveBeenCalled();
  const config = screen.getByRole("textbox", { name: "Widget message" });
  expect(config).toHaveAttribute("data-agent-element", "place-widget-new-config");
  fireEvent.change(config, { target: { value: "Updated message" } });
  fireEvent.change(title, { target: { value: "  Home notice  " } });
  fireEvent.click(submit);

  expect(onCreateNew.mock.calls).toEqual([["Home notice", { message: "Updated message" }]]);
});

it("shows an existing-widget fetch refusal without removing the create and cancel controls", async () => {
  const { port, props } = picker();
  port.listWidgets.mockRejectedValueOnce("upstream refused");
  const onCancel = vi.fn();
  render(<WidgetPickerDialog {...props} widgetType="text" onUseExisting={vi.fn()} onCreateNew={vi.fn()} onCancel={onCancel} />, { wrapper });
  expect(await screen.findByText("failed to load existing widgets")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Use existing" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create and place" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: "Title" })).not.toHaveAttribute("data-agent-element");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onCancel.mock.calls).toEqual([[]]);
});

it("opens the selected type from the inline add control, clears a placement error on reopen, and retries reuse", async () => {
  const { port, props } = picker([widget("main-nav", "menu", "Main nav")]);
  const onResolved = vi.fn().mockRejectedValueOnce(new Error("Region is locked")).mockResolvedValueOnce(undefined);
  render(<WidgetAddControl {...props} triggerLabel="Add region widget" onResolved={onResolved} agentHandle="add-widget" />, { wrapper });
  const types = screen.getByRole("combobox", { name: "Widget type" });
  expect(within(types).getByRole("option", { name: "fr/Menu" })).toHaveValue("menu");
  expect(types).toHaveAttribute("data-agent-element", "add-widget-type");
  fireEvent.change(types, { target: { value: "menu" } });
  const open = screen.getByRole("button", { name: "Add region widget" });
  fireEvent.click(open);
  let select = await screen.findByRole("combobox", { name: "Existing fr/Menu widgets" });
  expect(select).toHaveAttribute("data-agent-element", "add-widget-picker-existing-select");
  fireEvent.change(select, { target: { value: "main-nav" } });
  fireEvent.click(screen.getByRole("button", { name: "Use this widget" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Region is locked");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  fireEvent.click(open);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  select = await screen.findByRole("combobox", { name: "Existing fr/Menu widgets" });
  fireEvent.change(select, { target: { value: "main-nav" } });
  fireEvent.click(screen.getByRole("button", { name: "Use this widget" }));
  await waitFor(() => expect(onResolved.mock.calls).toEqual([["main-nav"], ["main-nav"]]));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(port.createWidget).not.toHaveBeenCalled();
});

it("keeps a single dialog during type changes and recovers a created widget after failed placement", async () => {
  const { port, props } = picker();
  const onResolved = vi.fn().mockRejectedValueOnce(new Error("Placement blocked")).mockResolvedValueOnce(undefined);
  const onCancel = vi.fn();
  render(<WidgetSelectionDialog {...props} onResolved={onResolved} onCancel={onCancel} agentHandle="insert-widget" />, { wrapper });
  const dialog = screen.getByRole("dialog", { name: "Insert widget" });
  expect(screen.getAllByRole("dialog")).toEqual([dialog]);
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Title" }), { target: { value: "Old draft" } });
  const types = within(dialog).getByRole("combobox", { name: "Widget type" });
  expect(types).toHaveAttribute("data-agent-element", "insert-widget-type");
  fireEvent.change(types, { target: { value: "menu" } });
  const title = within(dialog).getByRole("textbox", { name: "Title" });
  expect(title).toHaveValue("");
  expect(within(dialog).getByRole("textbox", { name: "Widget message" })).toHaveValue("Default menu");
  expect(screen.getAllByRole("dialog")).toEqual([dialog]);
  await waitFor(() => expect(port.listWidgets).toHaveBeenCalledWith({ widgetType: "menu" }));
  fireEvent.change(title, { target: { value: "Footer navigation" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create and place" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent('Widget "Footer navigation" was created but not placed (Placement blocked). Choose it under Use existing to try again.');
  const select = await within(dialog).findByRole("combobox", { name: "Existing fr/Menu widgets" });
  expect(within(select).getByRole("option", { name: "Footer navigation" })).toHaveValue("new-1");
  expect(port.createWidget.mock.calls).toEqual([[{ widgetType: "menu", title: "Footer navigation", config: { message: "Default menu" } }]]);
  fireEvent.change(select, { target: { value: "new-1" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Use this widget" }));
  await waitFor(() => expect(onResolved.mock.calls).toEqual([["new-1"], ["new-1"]]));
  expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledOnce();
});

it("keeps a creation refusal in the dialog and retries the same unsaved draft through the create port", async () => {
  const { port, props } = picker();
  port.createWidget.mockRejectedValueOnce(new Error("Name is reserved"));
  const onResolved = vi.fn();
  render(<WidgetSelectionDialog {...props} onResolved={onResolved} onCancel={vi.fn()} />, { wrapper });
  const dialog = screen.getByRole("dialog", { name: "Insert widget" });
  const title = within(dialog).getByRole("textbox", { name: "Title" });
  fireEvent.change(title, { target: { value: "Resume me" } });
  const submit = within(dialog).getByRole("button", { name: "Create and place" });
  fireEvent.click(submit);
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Name is reserved");
  expect(title).toHaveValue("Resume me");
  expect(onResolved).not.toHaveBeenCalled();
  fireEvent.click(submit);
  await waitFor(() => expect(onResolved.mock.calls).toEqual([["new-1"]]));
  expect(port.createWidget.mock.calls).toEqual([
    [{ widgetType: "text", title: "Resume me", config: { message: "Default text" } }],
    [{ widgetType: "text", title: "Resume me", config: { message: "Default text" } }],
  ]);
  expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
});

it("does not create a widget when a stale submit reaches a closed unpinned add control", async () => {
  const { port, props } = picker();
  const onResolved = vi.fn();
  const { result } = renderHook(() => props.useAddControl({ triggerLabel: "Add", onResolved }));
  expect(result.current.pickerType).toBeNull();
  expect(result.current.selectedType).toBe("text");
  await act(async () => result.current.handleCreateNew({ title: "Stale draft", config: {} }));
  expect(port.createWidget).not.toHaveBeenCalled();
  expect(onResolved).not.toHaveBeenCalled();
});

it("closing the inline add dialog discards an unsent draft and reopening creates for the selected type", async () => {
  const { port, props } = picker();
  const onResolved = vi.fn();
  render(<WidgetAddControl {...props} triggerLabel="Add widget" onResolved={onResolved} />, { wrapper });
  fireEvent.change(screen.getByRole("combobox", { name: "Widget type" }), { target: { value: "menu" } });
  const open = screen.getByRole("button", { name: "Add widget" });
  fireEvent.click(open);
  let dialog = screen.getByRole("dialog", { name: "Place a fr/Menu widget" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Title" }), { target: { value: "Discard me" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(port.createWidget).not.toHaveBeenCalled();
  expect(onResolved).not.toHaveBeenCalled();
  fireEvent.click(open);
  dialog = screen.getByRole("dialog", { name: "Place a fr/Menu widget" });
  const title = within(dialog).getByRole("textbox", { name: "Title" });
  expect(title).toHaveValue("");
  fireEvent.change(title, { target: { value: "Secondary nav" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create and place" }));
  await waitFor(() => expect(onResolved).toHaveBeenCalledExactlyOnceWith("new-1"));
  expect(port.createWidget).toHaveBeenCalledExactlyOnceWith({ widgetType: "menu", title: "Secondary nav", config: { message: "Default menu" } });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("the pinned picker can create again after a placement refusal and its outer close invokes cancel", async () => {
  const { port, props } = picker();
  const onResolved = vi.fn().mockRejectedValueOnce(new Error("Pane unavailable")).mockResolvedValueOnce(undefined);
  const onCancel = vi.fn();
  render(<WidgetSelectionDialog {...props} {...{ onResolved, onCancel }} />, { wrapper });
  const dialog = screen.getByRole("dialog", { name: "Insert widget" });
  const submit = (label: string) => {
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Title" }), { target: { value: label } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and place" }));
  };
  submit("First text");
  expect((await within(dialog).findByRole("alert")).textContent).toContain('Widget "First text" was created but not placed');
  expect(within(dialog).getByRole("textbox", { name: "Title" })).toHaveValue("");
  submit("Replacement text");
  await waitFor(() => expect(onResolved.mock.calls).toEqual([["new-1"], ["new-2"]]));
  expect(port.createWidget.mock.calls).toEqual([
    [{ widgetType: "text", title: "First text", config: { message: "Default text" } }],
    [{ widgetType: "text", title: "Replacement text", config: { message: "Default text" } }],
  ]);
  expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(onCancel).toHaveBeenCalledExactlyOnceWith();
});
