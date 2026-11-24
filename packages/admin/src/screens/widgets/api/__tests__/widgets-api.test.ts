import { describe, expect, it } from "vitest";
import { createWidgetsApi } from "../widgets-api.js";

function recorder() {
  const calls: unknown[] = [];
  const request = async <T>(required: { method: string; path: string; body?: unknown }): Promise<T> => { calls.push(required); return {} as T; };
  return { calls, api: createWidgetsApi({ request, workspaceId: "ws 1" }) };
}

describe("createWidgetsApi", () => {
  it("sends each call through the injected request, scoped to the injected workspace", async () => {
    const { calls, api } = recorder();
    await api.listWidgets();
    await api.listWidgets({ widgetType: "menu", includeInactive: true });
    await api.getWidget({ id: "a/b" });
    await api.createWidget({ widgetType: "text" as never, title: "T", config: {} }, { slug: "t" });
    expect(calls).toEqual([
      { method: "GET", path: "/workspaces/ws 1/widgets" },
      { method: "GET", path: "/workspaces/ws 1/widgets?widgetType=menu&includeInactive=true" },
      { method: "GET", path: "/workspaces/ws 1/widgets/a%2Fb" },
      { method: "POST", path: "/workspaces/ws 1/widgets", body: { widgetType: "text", title: "T", config: {}, slug: "t" } },
    ]);
  });
});
