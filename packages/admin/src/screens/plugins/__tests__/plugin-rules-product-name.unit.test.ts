import { describe, expect, it } from "vitest";
import { FakeApiError, makeRules } from "./plugin-rules-fixture.js";

const plugin = { id: "p", name: "P", version: "1.0.0", enabled: true, builtIn: true, status: "enabled", conflicts: [{ kind: "route", key: "GET /x", heldBy: "core", heldByName: "Core", heldKey: "GET /x" }] } as never;

describe("createPluginRules injects the product name instead of hard-coding one", () => {
  it.each(["Acme", "Zeta Cloud"])("interpolates %s into every product-naming string", (productName) => {
    const rules = makeRules(productName);
    expect(rules.describeApiError({ e: new FakeApiError("x", "PLUGIN_NOT_UNINSTALLABLE"), fallback: "f" })).toBe(`This plugin ships with ${productName} and cannot be removed.`);
    expect(rules.pluginConflictLines({ plugin, translate: (key) => key })).toEqual([`Route "GET /x" is reserved by ${productName}.`]);
    expect(rules.agentPluginCompatibilityLines({ plugin: { hostOk: false, missingRequires: [] }, translate: (key) => key })).toContain(`Not for this ${productName} version`);
    expect(rules.buildAgentPluginDisableConfirmCopy({ name: "N", origin: "bundled", variant: "disable" } as never).body).toContain(`ships with ${productName}`);
  });

  it("never leaks a product identity of its own", () => {
    const rules = makeRules("Acme");
    const text = JSON.stringify([
      rules.describeApiError({ e: new FakeApiError("x", "PLUGIN_NOT_UNINSTALLABLE"), fallback: "f" }),
      rules.pluginConflictLines({ plugin, translate: (key) => key }),
    ]);
    expect(text).not.toMatch(/tovu/i);
  });
});
