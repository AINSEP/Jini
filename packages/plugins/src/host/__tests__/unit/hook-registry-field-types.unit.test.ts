import { describe, expect, it } from "vitest";
import type { ContentEntryDraft } from "../support/fixture-sdk.js";
import { createHookRegistry, type PluginQuarantineEvent } from "../support/hook-registry.js";

/** L2 §4 hook-registry: each declared field type refuses every wrong-typed value (AP3), the
 *  threshold validation is exact, and failure counts are scoped per workspace. */
const entry = (workspaceId = "ws"): ContentEntryDraft => ({ id: "e1", workspaceId, title: "Hello", slug: "hello", status: "draft", bodyJson: {}, ext: {} });

describe("declared field types", () => {
  const cases: Array<["integer" | "number" | "string" | "boolean", unknown[], unknown[]]> = [
    ["integer", [0, -3, 2 ** 40], [1.5, "1", true, null, Number.NaN, [1], { n: 1 }]],
    ["number", [0, 1.5, -2], ["1", true, null, [1], {}]],
    ["string", ["", "x"], [1, true, null, ["x"], {}]],
    ["boolean", [true, false], [0, 1, "true", null, []]],
  ];
  for (const [type, good, bad] of cases) {
    it.each(good.map(value => [value]))(`${type} accepts %j`, async (value) => {
      const registry = createHookRegistry();
      registry.attach("p", "built-in", () => ({ f: value }), [{ path: "ext.p.f", type }]);
      await expect(registry.previewBeforeSave("p", entry())).resolves.toEqual({ f: value });
    });
    it.each(bad.map(value => [value]))(`${type} refuses %j with FIELD_TYPE_MISMATCH`, async (value) => {
      const registry = createHookRegistry();
      registry.attach("p", "built-in", () => ({ f: value }), [{ path: "ext.p.f", type }]);
      await expect(registry.previewBeforeSave("p", entry())).rejects.toMatchObject({
        name: "PluginHookFailedError",
        message: `plugin 'p' returned ext field 'f' with a value not matching its declared type '${type}' (FIELD_TYPE_MISMATCH)`,
      });
    });
  }
});

describe("failure threshold", () => {
  it.each([0, -1, 1.5, Number.NaN])("refuses %s", (failureThreshold) => {
    expect(() => createHookRegistry({ failureThreshold })).toThrow(new RangeError("plugin failure threshold must be a positive integer"));
  });
  it("threshold 1 quarantines on the first failure; counts are per workspace", async () => {
    const events: PluginQuarantineEvent[] = [];
    const registry = createHookRegistry({ failureThreshold: 2, onQuarantine: async (event) => { events.push(event); } });
    registry.attach("p", "built-in", () => { throw new Error("boom"); }, []);
    await expect(registry.runBeforeSave(entry("w1"))).rejects.toThrow();
    await expect(registry.runBeforeSave(entry("w2"))).rejects.toThrow();
    expect(events).toEqual([]);
    await expect(registry.runBeforeSave(entry("w1"))).rejects.toThrow();
    expect(events.map(e => [e.pluginId, e.workspaceId])).toEqual([["p", "w1"]]);
    const single = createHookRegistry({ failureThreshold: 1, onQuarantine: async (event) => { events.push(event); } });
    single.attach("q", "built-in", () => { throw new Error("x"); }, []);
    await expect(single.runBeforeSave(entry("w3"))).rejects.toThrow();
    expect(events.at(-1)).toMatchObject({ pluginId: "q", workspaceId: "w3" });
  });
});
