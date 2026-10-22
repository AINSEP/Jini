/**
 * Registration through the REAL plugin host: agent-plugins' `createPluginContributionLoader` and
 * `defineExecutablePluginContribution`, fed commerce's `paymentProviderContributionSpec`. Only the
 * I/O ports are fakes: `readFile` returns THIS package's real `plugin.json` and `importModule`
 * returns this package's real module, so the manifest path and the default export are what ship.
 * The kernel registry then binds the `stripe` id to the contributing plugin.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createPluginContributionLoader,
  defineExecutablePluginContribution,
  type PluginContributionPorts,
} from "@jini-ai/agent-plugins/lifecycle";
import { createKernelProviderRegistry, paymentProviderContributionSpec } from "@jini-ai/commerce/payments/kernel";
import * as stripeModule from "../index.js";

const PLUGIN_JSON = new URL("../../plugin.json", import.meta.url);
const plugin = { pluginId: "payments-stripe", packageRoot: "/plugins/payments-stripe" };

function load() {
  const reads: string[] = [];
  const imports: string[] = [];
  const ports: PluginContributionPorts = {
    findPackages: async () => [{ trusted: plugin }],
    readFile: async ({ plugin: p, filename }) => {
      reads.push(`${p.pluginId}/${filename}`);
      return readFileSync(PLUGIN_JSON, "utf8");
    },
    importModule: async ({ plugin: p, modulePath }) => {
      imports.push(`${p.pluginId}/${modulePath}`);
      return { exported: stripeModule.default };
    },
  };
  const definition = defineExecutablePluginContribution(paymentProviderContributionSpec({}));
  const loader = createPluginContributionLoader(ports);
  return { reads, imports, result: loader.loadPluginContributions({ workspaceId: "ws_1", definition }) };
}

describe("payments-stripe registers through the trusted contribution loader", () => {
  it("plugin.json declares the built module, and the loader validates the default export", async () => {
    const h = load();
    const result = await h.result;
    expect(result.refusals).toEqual([]);
    expect(result.items).toEqual([{ descriptor: { module: "./dist/index.js" }, pluginId: "payments-stripe", module: stripeModule.default }]);
    expect(h.reads).toEqual(["payments-stripe/plugin.json"]);
    expect(h.imports).toEqual(["payments-stripe/./dist/index.js"]);
  });

  it("the kernel registry binds stripe → the contributing plugin, and refuses a pin to another plugin", async () => {
    const { items } = await load().result;
    const registry = createKernelProviderRegistry({ items }, { bindings: { stripe: "payments-stripe" } });
    expect(registry.get({ id: "stripe" })).toEqual({ provider: stripeModule.default, pluginId: "payments-stripe" });
    expect(registry.list()).toHaveLength(1);
    expect(() => createKernelProviderRegistry({ items }, { bindings: { stripe: "someone-else" } })).toThrow(/bound to plugin 'someone-else'/);
  });

  it("the plugin manifest is an Agent Plugins 1.1.0 manifest named after the package", () => {
    const manifest = JSON.parse(readFileSync(PLUGIN_JSON, "utf8")) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      $schema: "https://agent-plugins.org/schemas/1.1.0/plugin.schema.json",
      name: "payments-stripe",
      extensions: { "ai.jini.commerce": { provider: "./dist/index.js" } },
    });
  });
});
