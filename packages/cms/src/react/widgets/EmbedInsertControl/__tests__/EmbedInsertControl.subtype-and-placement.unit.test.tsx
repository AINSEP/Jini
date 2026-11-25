import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { EmbedInsertControl, type EmbedInsertControlState } from "../EmbedInsertControl.js";
import { useEmbedInsertControl, type EmbedEditor, type WidgetAddControlState, type WidgetShortcutType } from "../EmbedInsertControl.hooks.js";

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
