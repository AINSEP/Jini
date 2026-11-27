// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { expect, it, vi } from "vitest";
import { createMemoryWidgetsApi } from "../../adapters/memory.js";
import { useWiredWidgetInstanceEditor } from "../hooks/use-widget-instance-editor.hooks.js";
import { WidgetsOptionsContext, WidgetsPortsContext, type WidgetsReactOptions } from "../hooks/WidgetsPorts.hooks.js";

it("creates through the host widget port and navigates through the configured admin base", async () => {
  const api = createMemoryWidgetsApi({}, { workspaceId: "widgets-workspace" });
  const navigate = vi.fn();
  const options: WidgetsReactOptions = {
    locale: "fr", t: (key) => `fr:${key}`, navigationBase: "/console",
    slots: { ConfigFields: () => null, AddControl: () => null }, widgetTypes: [],
    defaultConfig: () => ({ body: "Draft body" }),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WidgetsPortsContext.Provider value={{ widgetsApi: api, widgetsNavigation: { navigate } }}>
      <WidgetsOptionsContext.Provider value={options}>{children}</WidgetsOptionsContext.Provider>
    </WidgetsPortsContext.Provider>
  );
  const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: null, widgetType: "text" }), { wrapper });
  expect(result.current.config).toEqual({ body: "Draft body" });
  expect(result.current.locale).toBe("fr");
  expect(result.current.t("New widget")).toBe("fr:New widget");
  act(() => result.current.setTitle("Weekly links"));
  await waitFor(() => expect(result.current.title).toBe("Weekly links"));
  await act(async () => { await result.current.save(); });
  const { widgets } = await api.listWidgets({});
  expect(widgets).toHaveLength(1);
  expect(widgets[0]).toMatchObject({ title: "Weekly links", widgetType: "text", config: { body: "Draft body" }, workspaceId: "widgets-workspace" });
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ base: "/console", routePath: "/widgets/fake-slug-1" }, undefined);
});
