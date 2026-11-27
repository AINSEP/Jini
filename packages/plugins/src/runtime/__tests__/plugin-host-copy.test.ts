import assert from "node:assert/strict";
import { test } from "vitest";

import { createPluginAgentToolCatalog, PLUGINS_SET_ENABLED_TOOL_ID } from "../agent-tools.js";
import { createCapabilityCard } from "../capability-card.js";
import { createInstallToolCatalog, PLUGINS_INSTALL_TOOL_ID } from "../install-tool-catalog.js";
import type { PluginHostCopy } from "../plugin-host-copy.js";
import { createPluginInstallMessages, createPluginToolMessages } from "../plugin-tool-messages.js";
import { createPluginSourceAgentToolCatalog } from "../source-tool-catalog.js";
import { pluginManagementToolIds, pluginSourceToolIds } from "../plugin-tool-ids.js";

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

test("the restart note differs per family and direction, and agent-plugin notes name the host and the plugin", () => {
  const messages = createPluginToolMessages({ copy });
  assert.equal(messages.restartNote({ family: "site-runtime", pluginId: "p", enabled: false }),
    "Disabled and saved. This takes effect immediately, with no restart: any tool this plugin contributed stays listed " +
      "in the running daemon until Acme restarts, but every call to it is refused from now on.");
  assert.equal(messages.restartNote({ family: "agent-plugin", pluginId: "guide", enabled: true }),
    'Enabled and saved. Read its guidance now with load_agent_plugin({pluginId:"guide"}) and use ' +
      "agent_plugin_connect for account sign-in when needed. Tool discovery refreshes without restarting; " +
      "search for agent_plugin_guide to read its guidance. Do not ask the person to restart Acme.");
  assert.equal(messages.restartNote({ family: "agent-plugin", pluginId: "guide", enabled: false }),
    "Disabled and saved. Its guidance and provisioned external MCP tools stop immediately. " +
      "The connection rows and saved sign-in are retained. Ask to turn the plugin on through plugins_set_enabled before using it again.");
});

test("only a pending update recommends a restart; other journal refusals name their code and forbid the restart loop", () => {
  const messages = createPluginToolMessages({ copy });
  assert.equal(messages.updatePendingNextStep({ code: "PLUGIN_UPDATE_JOURNAL_UNSAFE" }),
    "Its update recovery record needs manual repair (PLUGIN_UPDATE_JOURNAL_UNSAFE); restarting Acme will not fix it. Tell the user an operator has to repair it first.");
});

test("the stale-uninstall and activation-record notes name the plugin, version and direction", () => {
  const messages = createPluginToolMessages({ copy });
  assert.equal(messages.changedSinceConfirmation({ pluginId: "p", name: "Pea", version: "2.0.0" }),
    "'p' changed after the user was asked: the confirmation showed Pea version 2.0.0, and that " +
      "is no longer what is installed. Nothing was removed. Call plugins_uninstall again so the user can review and confirm what is installed now.");
  assert.match(messages.activationsUnreadableNote({ pluginId: "p", enabled: true }), /^Nothing changed: this workspace's Agent Plugin activation record could not be read, so 'p' was NOT enabled\. /);
  assert.match(messages.activationsUnreadableNote({ pluginId: "p", enabled: false }), /so 'p' was NOT disabled\. Tell the user an operator has to repair activations\.json first/);
  assert.match(messages.activationsBusyNote({ pluginId: "p", enabled: true }), /so 'p' was NOT enabled\. Tell the user nothing was changed/);
});

test("the install messages keep the OFF wording and the retry hint", () => {
  const messages = createPluginInstallMessages({ copy });
  assert.equal(messages.installedNote({ name: "Pea", version: "1.2.3" }),
    "Installed Pea 1.2.3. It is OFF in every workspace; turn it on with plugins_set_enabled (family 'site-runtime') if the user wants it on.");
  assert.equal(messages.retryInstallHint, " Call plugins_install again to install what is there now.");
});

test("the shared tool-id tables name exactly the tools the management and source catalogs declare", () => {
  assert.deepEqual(createPluginAgentToolCatalog({ copy }).map((tool) => tool.name), Object.values(pluginManagementToolIds));
  assert.deepEqual(createPluginSourceAgentToolCatalog({ copy }).map((tool) => tool.name).sort(), Object.values(pluginSourceToolIds).sort());
});
