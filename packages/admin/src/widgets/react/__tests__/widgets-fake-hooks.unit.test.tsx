import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "../../../__tests__/fetch-query-support.js";
import type { useWidgetsOptions } from "../hooks/WidgetsPorts.hooks.js";
import type { useWidgetInstanceEditorView, useWidgetRegionEditorView, useWidgetRegionsView, useWidgetsLibraryView } from "../hooks/page-views.hooks.js";
import { WidgetInstanceEditor } from "../pages/WidgetInstanceEditor.js";
import { WidgetRegionEditor } from "../pages/WidgetRegionEditor.js";
import { WidgetRegions } from "../pages/WidgetRegions.js";
import { WidgetsLibrary } from "../pages/WidgetsLibrary.js";

/**
 * @file One fake-hook output test per widgets page (hook-injection rule). Every fake translator
 * prefixes `FAKE:`, which the real `t` can never produce, so a rendered `FAKE:` string proves the
 * injected view hook fed the markup; the fake options hook proves the ports hook was not read (a
 * `FAKE-HEADER-ACTIONS` node only it can supply). A fake returns only the fields its page reads,
 * hence the single `as` in `fake`. The `jini-` class-prefix loop applies when a component moves, so
 * it is not asserted here.
 */
afterEach(cleanup);

const fake = <H extends (...args: never[]) => unknown>(vm: Partial<ReturnType<H>>) => vi.fn((..._args: Parameters<H>) => vm as ReturnType<H>);
const t = (key: string) => `FAKE:${key}`;
const options = fake<typeof useWidgetsOptions>({
  widgetTypes: [{ value: "rich-text", label: "Rich text" }] as never,
  headerActions: <span>FAKE-HEADER-ACTIONS</span>,
  slots: { ConfigFields: () => <i>FAKE-CONFIG-FIELDS</i>, AddControl: () => <i>FAKE-ADD-CONTROL</i> } as never,
});

describe("widgets pages render from their injected hooks", () => {
  it("WidgetRegions shows the regions, header actions and bind handler of the fakes", () => {
    const bind = vi.fn();
    const view = fake<typeof useWidgetRegionsView>({
      regions: [{ workspaceId: "w", regionKey: "FAKE-REGION", areaEntryId: "a", updatedAt: "x", placementCount: 7 }],
      error: null, newRegionKey: "k", setNewRegionKey: vi.fn(), binding: false, bind, t, rowHandleByKey: new Map([["FAKE-REGION", "row-0"]]),
    });
    render(<WidgetRegions useWidgetRegionsViewHook={view} useWidgetsOptionsHook={options} />);
    expect(screen.getByText("FAKE:Widget Regions")).toBeTruthy();
    expect(screen.getByText("FAKE-HEADER-ACTIONS")).toBeTruthy();
    expect(screen.getAllByText("FAKE-REGION").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("FAKE:Bind region"));
    expect(bind).toHaveBeenCalledOnce();
  });

  it("WidgetsLibrary shows the widgets and routes Trash through the fake view", () => {
    const requestTrash = vi.fn();
    const widget = { id: "w1", title: "FAKE-WIDGET", slug: "fake-slug", widgetType: "rich-text", status: "draft" } as never;
    const view = fake<typeof useWidgetsLibraryView>({
      widgets: [widget], error: null, skippedCount: 0, skippedIds: [], createType: "rich-text", setCreateType: vi.fn(), pendingTrash: null, trashing: false,
      requestTrash, confirmTrash: vi.fn(), cancelTrash: vi.fn(), t, rowHandleById: new Map([["w1", "row-0"]]),
    });
    render(<WidgetsLibrary useWidgetsLibraryViewHook={view} useWidgetsOptionsHook={options} />);
    expect(screen.getByText("FAKE:Widgets")).toBeTruthy();
    expect(screen.getByText("FAKE-WIDGET")).toBeTruthy();
    fireEvent.click(screen.getByText("FAKE:Trash"));
    expect(requestTrash).toHaveBeenCalledWith(widget);
  });

  it("WidgetInstanceEditor shows the title, save state and config slot of the fakes", () => {
    const save = vi.fn();
    const view = fake<typeof useWidgetInstanceEditorView>({
      isNew: true, widget: null, whereUsed: { count: 0, references: [] }, title: "FAKE-TITLE", setTitle: vi.fn(), config: {}, setConfig: vi.fn(), message: "FAKE-MESSAGE", error: null,
      fieldErrors: [{ field: "f", reason: "FAKE-REASON" }], saving: false, save, t, gate: { guard: null, widgetType: "rich-text" }, onBackClick: vi.fn(),
    });
    render(<WidgetInstanceEditor widgetId={null} widgetType="rich-text" useWidgetInstanceEditorViewHook={view} useWidgetsOptionsHook={options} />);
    expect(screen.getByText("FAKE:New widget")).toBeTruthy();
    expect(screen.getByText("FAKE-MESSAGE")).toBeTruthy();
    expect(screen.getByText("FAKE-CONFIG-FIELDS")).toBeTruthy();
    expect(screen.getByText("f: FAKE-REASON")).toBeTruthy();
    expect((screen.getByPlaceholderText("FAKE:Widget title") as HTMLInputElement).value).toBe("FAKE-TITLE");
    fireEvent.click(screen.getByText("FAKE:Save"));
    expect(save).toHaveBeenCalledOnce();
  });

  it("WidgetRegionEditor shows the placements and routes move / remove through the fake view", () => {
    const moveAt = vi.fn(), removeAt = vi.fn();
    const view = fake<typeof useWidgetRegionEditorView>({
      area: { id: "area" } as never, loading: false, error: null, message: null, saving: false, save: vi.fn(), toggleEnabled: vi.fn(), addPlacement: vi.fn(),
      placements: [{ placementId: "p1", widgetTitle: "FAKE-PLACED", widgetType: null, enabled: true, broken: false } as never],
      removeAt, moveAt, t, placementHandles: ["place-0"],
    });
    render(<WidgetRegionEditor regionKey="footer" useWidgetRegionEditorViewHook={view} useWidgetsOptionsHook={options} />);
    expect(screen.getByText("FAKE-PLACED")).toBeTruthy();
    expect(screen.getByText("FAKE-ADD-CONTROL")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("FAKE:Move down"));
    expect(moveAt).toHaveBeenCalledWith(0, 1);
    fireEvent.click(screen.getByLabelText("FAKE:Remove"));
    expect(removeAt).toHaveBeenCalledWith("p1");
  });
});
