// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { readAgentScreenContext, resetAgentScreenContext, type AgentScreenEntry } from "../../lib/agent-screen-context.js";
import { useAgentScreenEntry, useAgentScreenRoute } from "../use-agent-screen-context.hooks.js";

afterEach(resetAgentScreenContext);

it("publishes the route and the resolved entry and removes the entry when the editor loses it", () => {
  type Route = { path: string; view: string | null };
  type Editor = { entry: AgentScreenEntry | null };
  const editorRoute: Route = { path: "/pages/7", view: "editor" };
  const noEntry: Editor = { entry: null };
  const route = renderHook(({ path, view }: Route) =>
    useAgentScreenRoute({ path, section: "pages", view }), { initialProps: editorRoute });
  const editor = renderHook(({ entry }: Editor) => useAgentScreenEntry({ entry }), { initialProps: noEntry });
  expect(readAgentScreenContext()).toEqual({ path: "/pages/7", section: "pages", view: "editor", drawingSurface: "chat" });
  editor.rerender({ entry: { kind: "page", id: "7", title: "Report", slug: "report", status: "draft" } });
  expect(readAgentScreenContext()?.entry).toStrictEqual({ kind: "page", id: "7", title: "Report", slug: "report", status: "draft" });
  editor.rerender({ entry: { kind: "page", id: "7", title: "Renamed report" } });
  expect(readAgentScreenContext()?.entry).toStrictEqual({ kind: "page", id: "7", title: "Renamed report" });
  editor.rerender({ entry: null });
  route.rerender({ path: "/pages", view: null });
  expect(readAgentScreenContext()).toStrictEqual({ path: "/pages", section: "pages", drawingSurface: "chat" });
  route.unmount();
  expect(readAgentScreenContext()).toBeUndefined();
});
