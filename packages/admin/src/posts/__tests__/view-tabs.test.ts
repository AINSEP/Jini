import { describe, expect, it } from "vitest";
import { VIEWS, VIEW_TABS } from "../view-tabs";

describe("post editor view tabs", () => {
  it("offers exactly the Editor and Preview views, in order, with distinct agent handles", () => {
    expect(VIEWS.map((view) => view.key)).toEqual(["edit", "preview"]);
    expect(VIEWS.map((view) => view.label)).toEqual(["Editor", "Preview"]);
    expect(new Set(VIEWS.map((view) => view.handle)).size).toBe(VIEWS.length);
  });

  it("keys each tab's id on its view key so the tablist keyboard helpers address the same view", () => {
    for (const tab of VIEW_TABS) expect(tab.id).toBe(tab.key);
    expect(VIEW_TABS.map((tab) => tab.handle)).toEqual(VIEWS.map((view) => view.handle));
  });
});
