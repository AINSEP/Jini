/** @file Unit tests for `retired-plugin-tool-aliases.ts` over a host-shaped catalog (two retired bundled plugins). */
import assert from "node:assert/strict";
import { test } from "vitest";

import type { ToolRegistration } from "@jini-ai/core";
import { createRetiredPluginToolAliases } from "../retired-plugin-tool-aliases.js";

const replacements: ReadonlyMap<string, string> = new Map([["deploy", "fly"], ["cloudflare-pages", "cloudflare"]]);
const toToolId = ({ pluginId }: { readonly pluginId: string }): string => `agent_plugin_${pluginId.replace(/-/g, "_")}`;

function registration(id: string): ToolRegistration {
  return {
    descriptor: { id, description: `${id} guidance` },
    handler: async () => ({ id }),
    policy: { authorize: async () => "allow" },
  } as unknown as ToolRegistration;
}

function recordingRegistry() {
  const byId = new Map<string, ToolRegistration>();
  return { byId, register(r: ToolRegistration) {
    if (byId.has(r.descriptor.id)) throw new Error(`'${r.descriptor.id}' is already registered`);
    byId.set(r.descriptor.id, r);
  } };
}

test("agent_plugin_deploy is Fly's own registration under the old name: same handler, same gate", () => {
  const registry = recordingRegistry();
  const aliases = createRetiredPluginToolAliases({ registry, replacements, toToolId });
  const fly = registration("agent_plugin_fly");

  aliases.registry.register(fly);
  aliases.registry.register(registration("agent_plugin_render"));
  assert.equal(registry.byId.has("agent_plugin_deploy"), false, "aliases wait for the family's own pass");
  aliases.registerAliases();

  const alias = registry.byId.get("agent_plugin_deploy");
  assert.equal(alias?.handler, fly.handler);
  assert.equal(alias?.policy, fly.policy, "Fly's activation/digest/revocation gate decides every alias call");
  assert.match(alias?.descriptor.description ?? "", /^Former name of agent_plugin_fly; returns the same guidance\. agent_plugin_fly guidance$/);
  assert.deepEqual([...registry.byId.keys()], ["agent_plugin_fly", "agent_plugin_render", "agent_plugin_deploy"]);
});

test("a still-installed deploy package keeps its own agent_plugin_deploy, in either order, and nothing throws", () => {
  for (const order of [["agent_plugin_fly", "agent_plugin_deploy"], ["agent_plugin_deploy", "agent_plugin_fly"]]) {
    const registry = recordingRegistry();
    const aliases = createRetiredPluginToolAliases({ registry, replacements, toToolId });
    const own = registration("agent_plugin_deploy");
    for (const id of order) aliases.registry.register(id === "agent_plugin_deploy" ? own : registration(id));
    aliases.registerAliases();
    assert.equal(registry.byId.get("agent_plugin_deploy"), own);
  }
});

test("no Fly tool (Fly off or not installed): no alias", () => {
  const registry = recordingRegistry();
  const aliases = createRetiredPluginToolAliases({ registry, replacements, toToolId });
  aliases.registry.register(registration("agent_plugin_github"));
  aliases.registerAliases();
  assert.deepEqual([...registry.byId.keys()], ["agent_plugin_github"]);
});

test('Cloudflare Pages legacy tool aliases the successor handler and activation/digest gate', () => {
  const registry = recordingRegistry();
  const aliases = createRetiredPluginToolAliases({ registry, replacements, toToolId });
  const successor = registration('agent_plugin_cloudflare');
  aliases.registry.register(successor);
  aliases.registerAliases();
  const alias = registry.byId.get('agent_plugin_cloudflare_pages');
  assert.equal(alias?.handler, successor.handler);
  assert.equal(alias?.policy, successor.policy);
});

test('Cloudflare alias never overrides a retained old package; disabled successor has no alias', () => {
  for (const successorPresent of [true, false]) {
    const registry = recordingRegistry();
    const aliases = createRetiredPluginToolAliases({ registry, replacements, toToolId });
    const retained = registration('agent_plugin_cloudflare_pages');
    aliases.registry.register(retained);
    if (successorPresent) aliases.registry.register(registration('agent_plugin_cloudflare'));
    aliases.registerAliases();
    assert.equal(registry.byId.get('agent_plugin_cloudflare_pages'), retained);
  }
});

test("a successor registered without a description still yields a clean former-name description", () => {
  const registry = recordingRegistry();
  const aliases = createRetiredPluginToolAliases({ registry, replacements, toToolId });
  const fly = registration("agent_plugin_fly");
  aliases.registry.register({ ...fly, descriptor: { id: "agent_plugin_fly" } } as unknown as ToolRegistration);
  aliases.registerAliases();
  assert.equal(registry.byId.get("agent_plugin_deploy")?.descriptor.description, "Former name of agent_plugin_fly; returns the same guidance.");
});
