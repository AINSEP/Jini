import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { EmbedInsertControl, type EmbedInsertControlState } from "../EmbedInsertControl.js";
import { useEmbedInsertControl, type EmbedEditor, type WidgetAddControlState, type WidgetShortcutType } from "../EmbedInsertControl.hooks.js";
import { useWidgetAddControl } from "../../WidgetPickerDialog/WidgetPickerDialog.hooks.js";

afterEach(cleanup);

function editor(placed = true) {
  const insertWidgetEmbed = vi.fn((_attrs: { placementId: string; widgetEntryId: string }) => placed);
  const insertMediaEmbed = vi.fn((_attrs: { assetId: string; transformName: string; alt?: string }) => true);
  return { commands: { insertWidgetEmbed, insertMediaEmbed } } satisfies EmbedEditor;
}

test("every widget placement mints a fresh placement id, and a refused placement throws (M-reuse-placement-id)", () => {
  const resolvers: Array<(id: string) => void> = [];
  const control = (): WidgetAddControlState => ({ pickerType: null, error: null, setPickerType: () => {}, handleUseExisting: () => {}, handleCreateNew: () => {} });
  let n = 0;
  const live = editor();
  const { result } = renderHook(() => useEmbedInsertControl({
    editor: live,
    useWidgetAddControlHook: ({ onResolved }) => { resolvers.push(onResolved); return control(); },
    mintPlacementId: () => `placement-${++n}`,
  }));
  act(() => { resolvers[0]?.("form-a"); resolvers[1]?.("menu-b"); });
  expect(live.commands.insertWidgetEmbed.mock.calls.map(([attrs]) => attrs)).toEqual([
    { placementId: "placement-1", widgetEntryId: "form-a" },
    { placementId: "placement-2", widgetEntryId: "menu-b" },
  ]);
  const refusing = editor(false);
  const refused = renderHook(() => useEmbedInsertControl({ editor: refusing, useWidgetAddControlHook: () => control(), mintPlacementId: () => "p" }));
  expect(() => refused.result.current.insertWidget({ widgetEntryId: "w" })).toThrow(/could not place/);
  expect(result.current.open).toBe(false);
});

test("each shortcut pins its own widget subtype and the media pick inserts the generic media node", () => {
  const setters = { form: vi.fn(), menu: vi.fn(), gallery: vi.fn() };
  const control = (set: (r: { next: WidgetShortcutType | null }) => void): WidgetAddControlState => ({ pickerType: null, error: null, setPickerType: set, handleUseExisting: () => {}, handleCreateNew: () => {} });
  const setOpen = vi.fn(); const setMediaPicking = vi.fn();
  const state: EmbedInsertControlState = {
    open: true, setOpen, widgetMode: false, setWidgetMode: vi.fn(), mediaPicking: true, setMediaPicking,
    formControl: control(setters.form), menuControl: control(setters.menu), galleryControl: control(setters.gallery), insertWidget: vi.fn(),
  };
  const live = editor();
  render(<EmbedInsertControl editor={live} useEmbed={() => state} useAdminLocaleHook={() => "en"} translate={({ key }) => key} agentHandleAttributes={agentHandle}
    MediaPickerDialog={({ onSelect }) => <button type="button" onClick={() => onSelect({ id: "asset-1", alt: "", title: "Title" })}>pick</button>}
    WidgetPickerDialog={() => null} WidgetSelectionDialog={() => null} agentHandle="post-embed" />);
  fireEvent.click(screen.getByRole("menuitem", { name: "Form" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Menu" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Gallery" }));
  expect(setters.form).toHaveBeenCalledWith({ next: "contact-form" });
  expect(setters.menu).toHaveBeenCalledWith({ next: "menu" });
  expect(setters.gallery).toHaveBeenCalledWith({ next: "gallery" });
  fireEvent.click(screen.getByRole("button", { name: "pick" }));
  expect(live.commands.insertMediaEmbed).toHaveBeenCalledWith({ assetId: "asset-1", transformName: "public", alt: "Title" });
  expect(setMediaPicking).toHaveBeenCalledWith(false);
});

function renderEmbed({ placed = true, tagged = true } = {}) {
  const live = editor(placed);
  const createWidget = vi.fn<Parameters<typeof useWidgetAddControl>[0]["deps"]["port"]["createWidget"]>(async ({ widgetType, title, config }) => ({
    widget: { id: "fresh-widget", workspaceId: "space", slug: "fresh-widget", title, status: "active", widgetType, config, updatedAt: "2026-11-25", version: 1 },
  }));
  let placement = 0;
  render(<EmbedInsertControl editor={live} useAdminLocaleHook={() => "en"} translate={({ key }) => key} agentHandleAttributes={agentHandle}
    {...(tagged ? { agentHandle: "post-embed" } : {})}
    useEmbed={({ editor }) => useEmbedInsertControl({ editor, mintPlacementId: () => `placement-${++placement}`,
      useWidgetAddControlHook: (props) => useWidgetAddControl({ props, deps: {
        useState, useAdminLocaleHook: () => "en", sharedComponentsT: ({ key }) => key,
        describeApiError: ({ e, fallback }) => e instanceof Error ? e.message : fallback,
        port: { listWidgets: async () => ({ widgets: [] }), createWidget },
      } }),
    })}
    MediaPickerDialog={({ onSelect, onCancel, agentHandle }) => <section role="dialog" aria-label="Choose media" data-agent-element={agentHandle}>
      <button type="button" onClick={() => onSelect({ id: "snowy-owl", alt: "Owl in snow", title: "Owl" })}>Select owl</button>
      <button type="button" onClick={onCancel}>Cancel media</button>
    </section>}
    WidgetPickerDialog={({ widgetType, onUseExisting, onCreateNew, onCancel, agentHandle }) => <section role="dialog" aria-label={`Choose ${widgetType}`} data-agent-element={agentHandle}>
      <button type="button" onClick={() => onUseExisting(`existing-${widgetType}`)}>Use existing</button>
      <button type="button" onClick={() => onCreateNew("Fresh widget", { titleVisible: true })}>Create widget</button>
      <button type="button" onClick={onCancel}>Cancel shortcut</button>
    </section>}
    WidgetSelectionDialog={({ onResolved, onCancel, agentHandle }) => <section role="dialog" aria-label="Choose any widget" data-agent-element={agentHandle}>
      <button type="button" onClick={() => onResolved("custom-widget")}>Select widget</button>
      <button type="button" onClick={onCancel}>Cancel widget</button>
    </section>} />);
  return { live, createWidget };
}

test("the Embed toggle owns menu visibility and choosing Media closes the menu", () => {
  const { live } = renderEmbed();
  const embed = screen.getByRole("button", { name: "Embed" });
  expect(embed).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(embed);
  expect(embed).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("menu", { name: "Insert" })).toBeVisible();
  fireEvent.click(embed);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();

  fireEvent.click(embed);
  fireEvent.click(screen.getByRole("menuitem", { name: "Media" }));
  const picker = screen.getByRole("dialog", { name: "Choose media" });
  expect(picker).toHaveAttribute("data-agent-element", "post-embed-media-dialog");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  fireEvent.click(within(picker).getByRole("button", { name: "Cancel media" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(live.commands.insertMediaEmbed.mock.calls).toEqual([]);

  fireEvent.click(embed);
  fireEvent.click(screen.getByRole("menuitem", { name: "Media" }));
  fireEvent.click(screen.getByRole("button", { name: "Select owl" }));
  expect(live.commands.insertMediaEmbed.mock.calls).toEqual([[{ assetId: "snowy-owl", transformName: "public", alt: "Owl in snow" }]]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("the generic widget picker focuses the persistent opener and closes on cancel or successful placement", () => {
  const { live } = renderEmbed();
  const embed = screen.getByRole("button", { name: "Embed" });
  fireEvent.click(embed);
  const widget = screen.getByRole("menuitem", { name: "Widget…" });
  widget.focus();
  expect(widget).toHaveFocus();
  fireEvent.click(widget);
  expect(embed).toHaveFocus();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  const picker = screen.getByRole("dialog", { name: "Choose any widget" });
  expect(picker).toHaveAttribute("data-agent-element", "post-embed-widget-control");
  fireEvent.click(within(picker).getByRole("button", { name: "Cancel widget" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(live.commands.insertWidgetEmbed.mock.calls).toEqual([]);

  fireEvent.click(embed);
  fireEvent.click(screen.getByRole("menuitem", { name: "Widget…" }));
  fireEvent.click(screen.getByRole("button", { name: "Select widget" }));
  expect(live.commands.insertWidgetEmbed.mock.calls).toEqual([[{ placementId: "placement-1", widgetEntryId: "custom-widget" }]]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a shortcut forwards its subtype and submission, and reports refused placement outside the closed picker", async () => {
  const { live, createWidget } = renderEmbed({ placed: false });
  const embed = screen.getByRole("button", { name: "Embed" });
  fireEvent.click(embed);
  fireEvent.click(screen.getByRole("menuitem", { name: "Gallery" }));
  const gallery = screen.getByRole("dialog", { name: "Choose gallery" });
  expect(gallery).toHaveAttribute("data-agent-element", "post-embed-gallery-dialog");
  fireEvent.click(within(gallery).getByRole("button", { name: "Create widget" }));
  expect(await screen.findByRole("alert")).toHaveTextContent('Widget "Fresh widget" was created but not placed (the editor could not place the widget at the cursor).');
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(createWidget.mock.calls).toEqual([[{ widgetType: "gallery", title: "Fresh widget", config: { titleVisible: true } }]]);
  expect(live.commands.insertWidgetEmbed.mock.calls).toEqual([[{ placementId: "placement-1", widgetEntryId: "fresh-widget" }]]);
});

test("the pinned Menu allows reuse and cancellation without adding agent markup when untagged", () => {
  const { live, createWidget } = renderEmbed({ tagged: false });
  const embed = screen.getByRole("button", { name: "Embed" });
  fireEvent.click(embed);
  fireEvent.click(screen.getByRole("menuitem", { name: "Menu" }));
  const picker = screen.getByRole("dialog", { name: "Choose menu" });
  expect(picker).not.toHaveAttribute("data-agent-element");
  fireEvent.click(within(picker).getByRole("button", { name: "Cancel shortcut" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(live.commands.insertWidgetEmbed.mock.calls).toEqual([]);

  fireEvent.click(embed);
  fireEvent.click(screen.getByRole("menuitem", { name: "Menu" }));
  fireEvent.click(screen.getByRole("button", { name: "Use existing" }));
  expect(live.commands.insertWidgetEmbed.mock.calls).toEqual([[{ placementId: "placement-1", widgetEntryId: "existing-menu" }]]);
  expect(createWidget).not.toHaveBeenCalled();
});

test("a placement request after the editor has detached does not mint a placement ID", () => {
  const live = editor();
  const mintPlacementId = vi.fn(() => "late-placement");
  const useWidgetAddControlHook = (): WidgetAddControlState => ({ pickerType: null, error: null, setPickerType: () => {}, handleUseExisting: () => {}, handleCreateNew: () => {} });
  const initialProps: { editor: EmbedEditor | null } = { editor: live };
  const { result, rerender } = renderHook(({ editor }) => useEmbedInsertControl({ editor, useWidgetAddControlHook, mintPlacementId }), { initialProps });
  rerender({ editor: null });
  result.current.insertWidget({ widgetEntryId: "late-choice" });

  expect(mintPlacementId.mock.calls).toEqual([]);
  expect(live.commands.insertWidgetEmbed.mock.calls).toEqual([]);
});
