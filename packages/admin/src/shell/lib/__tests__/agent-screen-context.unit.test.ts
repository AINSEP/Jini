// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { publishAgentScreenEntry, publishAgentScreenRoute, readAgentScreenContext, resetAgentScreenContext } from "../agent-screen-context.js";
import { resetPlaygroundRenderTargetBus, setPlaygroundRenderTarget } from "../playground-render-target-bus.js";

afterEach(() => {
  resetAgentScreenContext();
  resetPlaygroundRenderTargetBus();
});

it("does not send an entry without a route and adds drawing availability to the published route", () => {
  const entry = { kind: "page", id: "page-home", title: "Home" };
  publishAgentScreenEntry(entry);
  expect(readAgentScreenContext()).toBeUndefined();
  publishAgentScreenRoute({ path: "/pages/home", section: "pages", view: "page-editor" });
  const expected = { path: "/pages/home", section: "pages", view: "page-editor", entry };
  expect(readAgentScreenContext()).toEqual({ ...expected, drawingSurface: "chat" });
  setPlaygroundRenderTarget({ node: document.createElement("div") });
  expect(readAgentScreenContext()).toEqual({ ...expected, drawingSurface: "canvas" });
  expect(readAgentScreenContext({ hasCanvas: () => false })).toEqual({ ...expected, drawingSurface: "chat" });
});

it("keeps the newer route and entry when stale owners release, then clears each active owner", () => {
  const oldRoute = publishAgentScreenRoute({ path: "/posts/a", section: "posts", view: "post-editor" });
  const oldEntry = publishAgentScreenEntry({ kind: "post", id: "a", title: "Old" });
  const route = publishAgentScreenRoute({ path: "/pages", section: "pages", view: null });
  const entry = publishAgentScreenEntry({ kind: "page", id: "b", title: "New" });
  oldRoute();
  oldEntry();
  expect(readAgentScreenContext()).toEqual({
    path: "/pages", section: "pages", drawingSurface: "chat", entry: { kind: "page", id: "b", title: "New" },
  });
  entry();
  expect(readAgentScreenContext()).toEqual({ path: "/pages", section: "pages", drawingSurface: "chat" });
  route();
  expect(readAgentScreenContext()).toBeUndefined();
});

it("resets both halves before a new screen publishes", () => {
  publishAgentScreenRoute({ path: "/posts/a", section: "posts", view: "post-editor" });
  publishAgentScreenEntry({ kind: "post", id: "a", title: "Old" });
  resetAgentScreenContext();
  expect(readAgentScreenContext()).toBeUndefined();
  publishAgentScreenRoute({ path: "/pages", section: "pages", view: null });
  expect(readAgentScreenContext()).toEqual({ path: "/pages", section: "pages", drawingSurface: "chat" });
});
