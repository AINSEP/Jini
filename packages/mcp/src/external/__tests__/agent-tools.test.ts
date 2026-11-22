import assert from "node:assert/strict";
import { test } from "vitest";

import { EXTERNAL_MCP_MANAGE_PERMISSION, externalMcpAgentToolCatalog } from "../agent-tools.js";

const byName = new Map(externalMcpAgentToolCatalog.map((tool) => [tool.name, tool]));

test("the catalog exposes exactly the five external MCP tools, each gated on the manage permission", () => {
  assert.deepEqual([...byName.keys()], ["external_mcp_list", "external_mcp_save", "external_mcp_test_connection", "external_mcp_oauth_connect", "external_mcp_oauth_poll_device"]);
  assert.equal(EXTERNAL_MCP_MANAGE_PERMISSION, "admin.integrations.manage");
  for (const tool of externalMcpAgentToolCatalog) assert.deepEqual(tool.authorization, { permission: "admin.integrations.manage" }, tool.name);
});

test("only the list tool is side-effect free", () => {
  assert.deepEqual(externalMcpAgentToolCatalog.map((tool) => [tool.name, tool.sideEffects]), [
    ["external_mcp_list", "none"],
    ["external_mcp_save", "mutates-durable-state"],
    ["external_mcp_test_connection", "mutates-durable-state"],
    ["external_mcp_oauth_connect", "mutates-durable-state"],
    ["external_mcp_oauth_poll_device", "mutates-durable-state"],
  ]);
});

test("no input schema accepts a secret, and every schema rejects unknown properties", () => {
  for (const tool of externalMcpAgentToolCatalog) {
    const schema = tool.inputSchema as { additionalProperties?: unknown; properties?: Record<string, unknown> };
    assert.equal(schema.additionalProperties, false, tool.name);
    for (const secret of ["env", "accessToken", "oauthClientSecret"]) assert.equal(Object.hasOwn(schema.properties ?? {}, secret), false, `${tool.name}.${secret}`);
  }
  const save = byName.get("external_mcp_save")?.inputSchema as { required?: unknown };
  assert.deepEqual(save.required, ["id"]);
});
