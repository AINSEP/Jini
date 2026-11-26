// @vitest-environment jsdom
import { expect, it } from "vitest";
import { replaceBrowserQuery } from "../use-conversation-deep-link.js";

it("replaces only the query, keeps path, hash and history state, and adds no history entry", () => {
  window.history.pushState({ keep: 1 }, "", "/ai-assistant?conversation=c1&tab=x#top");
  const length = window.history.length;
  replaceBrowserQuery({ query: new URLSearchParams("tab=x") });
  expect(window.location.pathname + window.location.search + window.location.hash).toBe("/ai-assistant?tab=x#top");
  expect(window.history.state).toEqual({ keep: 1 });
  expect(window.history.length).toBe(length);
});
