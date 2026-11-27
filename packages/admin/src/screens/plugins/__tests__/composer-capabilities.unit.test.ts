import { describe, expect, it } from "vitest";

import {
  projectComposerCapabilities,
  type ComposerCapabilitySource,
  type ComposerHostBinding,
  type ComposerCapability,
} from "../composer-capabilities.js";

/**
 * @file Regression coverage for debate 2's host-side projection contract — the async
 * `ComposerCapabilitySource` composition and the `ComposerHostBinding` union
 * (the 2026-08-12 host six-debates record, §2). `AssistantDock`'s
 * own unit tests cover the end-to-end wiring; this file isolates the pure composition/typing
 * contract so a future source (a live tool-registry fetch, or the Agent Plugins adapter) can be
 * proven against it without a DOM.
 */

function fakeSource(id: string, capabilities: readonly ComposerCapability[]): ComposerCapabilitySource {
  return { id, list: async () => capabilities };
}

describe("projectComposerCapabilities", () => {
  it("composes multiple sources, preserving first-seen group order across source boundaries", async () => {
    const sourceA = fakeSource("a", [
      { groupId: "g1", groupLabel: "Group One", item: { id: "a1", label: "A1" } },
    ]);
    const sourceB = fakeSource("b", [
      { groupId: "g2", groupLabel: "Group Two", item: { id: "b1", label: "B1" } },
      { groupId: "g1", groupLabel: "Group One", item: { id: "a2", label: "A2" } },
    ]);

    const projection = await projectComposerCapabilities({ sources: [sourceA, sourceB] });

    expect(projection.groups.map((group) => group.id)).toEqual(["g1", "g2"]);
    expect(projection.groups.find((group) => group.id === "g1")?.items.map((item) => item.id)).toEqual([
      "a1",
      "a2",
    ]);
  });

  it("fails closed on a duplicate item id across two sources rather than silently letting one win", async () => {
    const sourceA = fakeSource("a", [
      { groupId: "g1", groupLabel: "Group One", item: { id: "dup", label: "First" } },
    ]);
    const sourceB = fakeSource("b", [
      { groupId: "g1", groupLabel: "Group One", item: { id: "dup", label: "Second" } },
    ]);

    await expect(projectComposerCapabilities({ sources: [sourceA, sourceB] })).rejects.toThrow(/duplicate discovery item id/i);
  });

  it("indexes every capability by item id for selection lookup, including its resolve function", async () => {
    const resolve = (): ComposerHostBinding => ({ kind: "compose-text", text: "resolved" });
    const source = fakeSource("a", [{ groupId: "g1", groupLabel: "Group One", item: { id: "a1", label: "A1" }, resolve }]);

    const projection = await projectComposerCapabilities({ sources: [source] });

    expect(projection.byItemId.get("a1")?.resolve).toBe(resolve);
  });

  it("returns an empty projection for zero sources", async () => {
    const projection = await projectComposerCapabilities({ sources: [] });
    expect(projection.groups).toEqual([]);
    expect(projection.byItemId.size).toBe(0);
  });
});

describe("byPluginRefId indexing", () => {
  it("is empty when no capability sets pluginRefId", async () => {
    const projection = await projectComposerCapabilities({ sources: [
      fakeSource("a", [{ groupId: "g1", groupLabel: "Group One", item: { id: "a1", label: "A1" } }]),
    ] });

    expect(projection.byPluginRefId.size).toBe(0);
  });

  it("fails closed on a duplicate pluginRefId across two capabilities, rather than letting one win silently", async () => {
    const sourceA = fakeSource("a", [
      { groupId: "g1", groupLabel: "Group One", item: { id: "first", label: "First" }, pluginRefId: "shared" },
    ]);
    const sourceB = fakeSource("b", [
      { groupId: "g1", groupLabel: "Group One", item: { id: "second", label: "Second" }, pluginRefId: "shared" },
    ]);

    await expect(projectComposerCapabilities({ sources: [sourceA, sourceB] })).rejects.toThrow(/duplicate pluginRefId/i);
  });
});

it("distinguishes a standalone skill and same-named agent plugin without removing either selection", async () => {
  const program = fakeSource("skills", [
    { groupId: "skills", groupLabel: "Skills", item: { id: "scan-skill", command: "scan", label: "Scan", kind: "skill" } },
  ]);
  const plugins = fakeSource("plugins", [
    { groupId: "plugins", groupLabel: "Plugins", pluginRefId: "scan-tool", item: { id: "scan-plugin", command: "SCAN", label: "Scan (Agent Plugin)" } },
    { groupId: "plugins", groupLabel: "Plugins", pluginRefId: "jobs-tool", item: { id: "jobs-plugin", command: "jobs", label: "Jobs (Agent Plugin)" } },
    { groupId: "plugins", groupLabel: "Plugins", item: { id: "item-only", command: "scan", label: "Scan command" } },
  ]);
  const projection = await projectComposerCapabilities({ sources: [program, plugins] });
  expect(projection.groups.flatMap(({ items }) => items.map(({ id, label }) => [id, label]))).toEqual([
    ["scan-skill", "Scan · Skill"], ["scan-plugin", "Scan · Agent plugin"], ["jobs-plugin", "Jobs (Agent Plugin)"], ["item-only", "Scan command"],
  ]);
  expect(projection.byPluginRefId.get("scan-tool")?.item.id).toBe("scan-plugin");
  expect(projection.byItemId.get("scan-skill")?.item.kind).toBe("skill");
});
