import assert from "node:assert/strict";
import { test } from "vitest";

import { createPluginAgentToolCatalog, PLUGINS_SET_ENABLED_TOOL_ID } from "../agent-tools.js";
import { createCapabilityCard } from "../capability-card.js";
import { createInstallToolCatalog, PLUGINS_INSTALL_TOOL_ID } from "../install-tool-catalog.js";
import type { PluginHostCopy } from "../plugin-host-copy.js";
import { createPluginInstallMessages, createPluginToolMessages } from "../plugin-tool-messages.js";
import { createPluginSourceAgentToolCatalog } from "../source-tool-catalog.js";

/**
 * @file Model-facing plugin text names the HOST's product, package format and install switch, which
 * arrive through `copy` — never a product the engine hard-codes.
 */
const copy: PluginHostCopy = { productName: "Acme", sitePluginFormat: ".acme-plugin", localInstallEnv: "ACME_LOCAL_INSTALL", pluginListToolName: "acme_list_plugins" };
const installSourceSchema = { type: "object", title: "host-source" } as const;

function allText(value: unknown): string {
  return JSON.stringify(value);
}

test("the plugins catalog names the host's product and package format in every family description", () => {
  const catalog = createPluginAgentToolCatalog({ copy });
  assert.deepEqual(catalog.map((tool) => tool.name), ["plugins_list", PLUGINS_SET_ENABLED_TOOL_ID, "plugins_uninstall"]);
  const setEnabled = catalog[1]!;
  assert.match(setEnabled.description, /covers BOTH of Acme's plugin systems/);
  assert.match(setEnabled.description, /'site-runtime' for a \.acme-plugin site plugin/);
  const family = (setEnabled.inputSchema as { properties: { family: { description: string } } }).properties.family.description;
  assert.match(family, /Acme has two unrelated systems/);
  assert.match(family, /anything acme_list_plugins returned/);
  assert.match(allText(catalog[2]), /BUNDLED with Acme/);
  assert.doesNotMatch(allText(catalog), /tovu|content_read/i);
});

test("the source and install catalogs name the host's local-install switch and take its source schema", () => {
  const seal = createPluginSourceAgentToolCatalog({ copy }).find((tool) => tool.name === "plugin_source_seal")!;
  assert.match(seal.description, /hosted installs require ACME_LOCAL_INSTALL=1\./);
  const [install] = createInstallToolCatalog({ copy, installSourceSchema });
  assert.equal(install!.name, PLUGINS_INSTALL_TOOL_ID);
  assert.match(install!.description, /SITE plugin \(\.acme-plugin, .*on the machine Acme runs on/);
  assert.match(install!.description, /without ACME_LOCAL_INSTALL=1;/);
  assert.equal((install!.inputSchema as { properties: { source: unknown } }).properties.source, installSourceSchema);
});

test("messages carry the host's product name and keep their old call shapes", () => {
  const messages = createPluginToolMessages({ copy });
  assert.match(messages.familyRequired, /\(a \.acme-plugin site plugin, .* Acme has two /);
  assert.equal(messages.restartNote({ family: "site-runtime", pluginId: "p", enabled: true } as never),
    "Enabled and saved. The plugin's hooks are live now, but any tool it contributes is registered only when the agent " +
      "daemon starts — tell the user Acme has to be restarted before that tool can be called.");
  assert.equal(messages.updatePendingNextStep({ code: "PLUGIN_UPDATE_PENDING" }), "Tell the user to restart Acme (recovery runs at start) and then try again.");
  assert.match(messages.hostIncompatibleNote({ pluginId: "p" }), /not made for this Acme version.*supports this Acme\.$/);
  assert.match(messages.activationsBusyNote({ pluginId: "p", enabled: false }), /another Acme process .* was NOT disabled/);
  assert.equal(createPluginInstallMessages({ copy }).localInstallDisabledNote,
    "Nothing was installed: local plugin installs are off on this server. The owner has to start Acme with ACME_LOCAL_INSTALL=1 first.");
});

test("the capability card links to the host's plugins admin screen", () => {
  const card = createCapabilityCard({ pluginsAdminHref: "/host/plugins", pluginListToolName: "acme_list_plugins" });
  assert.equal(card.id, "plugins");
  assert.deepEqual(card.pointers.map((pointer) => ("href" in pointer ? pointer.href : pointer.tool)), ["acme_list_plugins", "/host/plugins"]);
});

test("enablement explains confirmation and live schema writes without a host document id", () => {
  const tool = createPluginAgentToolCatalog({ copy }).find(tool => tool.name === PLUGINS_SET_ENABLED_TOOL_ID)!;
  const enabled = (tool.inputSchema as { properties: { enabled: { description: string } } }).properties.enabled.description;
  assert.match(tool.description, /owner's approval card/);
  assert.match(tool.description, /live schema DDL/);
  assert.match(tool.description, /snapshot-protected, transactional schema changes/);
  assert.match(enabled, /ENABLING ALWAYS ASKS THE HUMAN FIRST/);
  assert.match(enabled, /schema DDL against the live database/);
  assert.match(enabled, /snapshot-protected, transactional schema changes/);
  assert.match(enabled, /discovery status is 'valid'/);
  assert.match(tool.description, /disabling flips the activation flag back/);
  assert.doesNotMatch(tool.description + enabled, /ADR-023/);
});
