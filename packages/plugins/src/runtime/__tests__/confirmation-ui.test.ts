import assert from "node:assert/strict";
import { test } from "vitest";

import { PLUGINS_SET_ENABLED_TOOL_ID } from "../agent-tools.js";
import { describeEnableApproval } from "../enable-confirmation-ui.js";
import { describeUninstallApproval, PLUGINS_UNINSTALL_TOOL_ID } from "../uninstall-confirmation-ui.js";

/**
 * @file The plugin dialogs are plain approval specs; the host renders them (its renderer-level tests
 * keep asserting the HTML). These pin the spec facts that renderer output depends on.
 */
for (const family of ["agent-plugin", "site-runtime"] as const) {
  test(`${family} enable spec names the plugin, routes back to plugins_set_enabled and states its version`, () => {
    const spec = describeEnableApproval({ subject: { family, pluginId: "tools/x ?", label: "A <B>", version: "2.7.0" } });
    assert.equal(spec.toolId, PLUGINS_SET_ENABLED_TOOL_ID);
    assert.equal(spec.toolId, "plugins_set_enabled");
    assert.equal(spec.title, "Enable A <B>?");
    const sentence = family === "agent-plugin" ? spec.notice : spec.warning;
    assert.ok(sentence?.includes(family === "agent-plugin" ? "guidance and tools" : "change its database"));
    assert.match(sentence ?? "", /Only the listed access is turned on/);
    assert.deepEqual(spec.details.find(detail => detail.label === "Version")?.value, "2.7.0");
  });
}

test("id-only enable spec names the id and omits an absent Version detail", () => {
  const spec = describeEnableApproval({ subject: { family: "agent-plugin", pluginId: "bare-plugin" } });
  assert.equal(spec.title, "Enable bare-plugin?");
  assert.ok(!spec.details.some(detail => detail.label === "Version"));
});

test("an agent plugin explains in a neutral notice; a site plugin keeps its red warning", () => {
  const agent = describeEnableApproval({ subject: { family: "agent-plugin", pluginId: "composio", adds: ["mail.send"] }, scope: { personId: "owner", siteId: "site-1" } as never });
  assert.equal(agent.warning, undefined);
  assert.match(agent.notice ?? "", /guidance and tools/);
  assert.deepEqual(agent.accessRowsStatedInDetails, ["plugin:agent-plugin:composio"]);
  assert.match(String(agent.details.find(detail => detail.label === "Adds")?.value), /mail\.send/);
  const site = describeEnableApproval({ subject: { family: "site-runtime", pluginId: "shop" } });
  assert.match(site.warning ?? "", /change its database/);
});

test("site plugin uninstall spec routes back to plugins_uninstall and names what is removed", () => {
  const spec = describeUninstallApproval({ preview: { pluginId: "site/x", name: "Site Plugin", version: "3.2.1" } as never });
  assert.equal(spec.toolId, PLUGINS_UNINSTALL_TOOL_ID);
  assert.equal(spec.toolId, "plugins_uninstall");
  assert.equal(spec.title, "Move Site Plugin to trash?");
  assert.ok(spec.warning?.includes("all workspaces on this site"));
  assert.ok(spec.description?.includes("version 3.2.1"));
  assert.ok(spec.description?.includes("Trash for 60 days"));
  assert.equal(spec.danger, true);
});
