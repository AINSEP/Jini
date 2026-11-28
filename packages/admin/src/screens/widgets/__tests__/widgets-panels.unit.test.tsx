// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  WidgetInstanceEditor, WidgetRegionEditor, WidgetRegions, WidgetsLibrary,
  type WidgetsModulePanelHook, type WidgetsPanelPageId,
} from "../index.js";

type PanelCall = { props: Parameters<WidgetsModulePanelHook>[0]; loadingContent: ReactNode };

/** A strict fake of the host hook: records every mount request and returns a marker that names the page. */
function moduleHost() {
  const calls: PanelCall[] = [];
  const useModulePanel: WidgetsModulePanelHook = (props, { loadingContent }) => {
    calls.push({ props, loadingContent });
    return { content: <p>mounted {props.pageId}</p> };
  };
  const ModuleLoading = ({ pageId }: { pageId: WidgetsPanelPageId }) => <p>loading {pageId}</p>;
  return { calls, useModulePanel, ModuleLoading };
}

/** The route is a plain object apart from the URLSearchParams; compare the query by its serialized form. */
function routeOf(call: PanelCall) {
  const { route } = call.props;
  return { view: route.view, params: route.params, query: route.query.toString() };
}

function loadingText(call: PanelCall): string {
  const { container } = render(<>{call.loadingContent}</>);
  return container.textContent ?? "";
}

describe("widgets host panels", () => {
  it("mounts the library page with an empty route and the library loading view", () => {
    const host = moduleHost();
    render(<WidgetsLibrary useModulePanel={host.useModulePanel} ModuleLoading={host.ModuleLoading} />);
    expect(screen.getByText("mounted library")).toBeInTheDocument();
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0]!.props).toMatchObject({ moduleId: "widgets", pageId: "library" });
    expect(host.calls[0]!.props).not.toHaveProperty("params");
    expect(routeOf(host.calls[0]!)).toEqual({ view: null, params: {}, query: "" });
    expect(loadingText(host.calls[0]!)).toBe("loading library");
  });

  it("mounts the regions page with its own loading view", () => {
    const host = moduleHost();
    render(<WidgetRegions useModulePanel={host.useModulePanel} ModuleLoading={host.ModuleLoading} />);
    expect(screen.getByText("mounted regions")).toBeInTheDocument();
    expect(host.calls[0]!.props).toMatchObject({ moduleId: "widgets", pageId: "regions" });
    expect(host.calls[0]!.props).not.toHaveProperty("params");
    expect(routeOf(host.calls[0]!)).toEqual({ view: null, params: {}, query: "" });
    expect(loadingText(host.calls[0]!)).toBe("loading regions");
  });

  it("forwards the matched region key unchanged as both page param and route param", () => {
    const host = moduleHost();
    render(<WidgetRegionEditor regionKey="footer/left col" useModulePanel={host.useModulePanel} ModuleLoading={host.ModuleLoading} />);
    expect(screen.getByText("mounted region")).toBeInTheDocument();
    expect(host.calls[0]!.props).toMatchObject({ moduleId: "widgets", pageId: "region", params: { regionKey: "footer/left col" } });
    expect(routeOf(host.calls[0]!)).toEqual({ view: null, params: { regionKey: "footer/left col" }, query: "" });
    expect(loadingText(host.calls[0]!)).toBe("loading region");
  });

  it("opens an existing instance by id with no type query", () => {
    const host = moduleHost();
    render(<WidgetInstanceEditor widgetId="w-7" widgetType={null} useModulePanel={host.useModulePanel} ModuleLoading={host.ModuleLoading} />);
    expect(screen.getByText("mounted editor")).toBeInTheDocument();
    expect(host.calls[0]!.props).toMatchObject({ moduleId: "widgets", pageId: "editor", params: { widgetId: "w-7", widgetType: null } });
    expect(routeOf(host.calls[0]!)).toEqual({ view: null, params: { widgetId: "w-7" }, query: "" });
    expect(loadingText(host.calls[0]!)).toBe("loading editor");
  });

  it("preserves a null id for a new instance and carries the requested type in the query", () => {
    const host = moduleHost();
    render(<WidgetInstanceEditor widgetId={null} widgetType="menu" useModulePanel={host.useModulePanel} ModuleLoading={host.ModuleLoading} />);
    expect(host.calls[0]!.props).toMatchObject({ pageId: "editor", params: { widgetId: null, widgetType: "menu" } });
    expect(routeOf(host.calls[0]!)).toEqual({ view: null, params: {}, query: "type=menu" });
  });
});
