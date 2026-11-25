import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { createExternalMcpAgentToolCatalog, EXTERNAL_MCP_MANAGE_PERMISSION } from "../agent-tools.js";

/**
 * @file Characterization pin for the External MCP setup catalog: tool names, order, side effects,
 * the gating permission and every input schema are deep-compared against a snapshot recorded from the
 * unsplit implementation, and no secret-bearing input may ever appear in a schema or description.
 */
const recorded = JSON.parse(readFileSync(new URL("./fixtures/external-mcp-catalog.json", import.meta.url), "utf8")) as unknown;
const FIXTURE_SECRET = "sk-fixture-secret-0001";
const copy = { settingsLocation: "Acme Settings → Servers", listToolName: "acme_list_servers" };
const catalog = createExternalMcpAgentToolCatalog({ copy });

test("the catalog, schemas included, equals the snapshot recorded from the unsplit code", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(catalog)), recorded);
});

test("every tool stays behind the owner-level manage permission, and only the read tool is side-effect free", () => {
  assert.deepEqual(catalog.map((tool) => [tool.name, tool.sideEffects, tool.authorization?.permission]), [
    ["external_mcp_list", "none", EXTERNAL_MCP_MANAGE_PERMISSION],
    ["external_mcp_save", "mutates-durable-state", EXTERNAL_MCP_MANAGE_PERMISSION],
    ["external_mcp_test_connection", "mutates-durable-state", EXTERNAL_MCP_MANAGE_PERMISSION],
    ["external_mcp_oauth_connect", "mutates-durable-state", EXTERNAL_MCP_MANAGE_PERMISSION],
    ["external_mcp_oauth_poll_device", "mutates-durable-state", EXTERNAL_MCP_MANAGE_PERMISSION],
  ]);
});

test("the save schema is closed and carries no secret-bearing property, only name hints for the human-entered form", () => {
  const save = catalog.find((tool) => tool.name === "external_mcp_save")!.inputSchema as { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> };
  assert.equal(save.additionalProperties, false);
  assert.deepEqual(save.required, ["id"]);
  for (const forbidden of ["env", "accessToken", "oauthClientSecret", "clientSecret", "password", "secret", "apiKey"]) {
    assert.equal(forbidden in save.properties, false, `${forbidden} must never be a save property`);
  }
  assert.ok("accessTokenEnvName" in save.properties && "oauthTokenEnvName" in save.properties);
});

test("no fixture secret reaches the serialized catalog or any schema", () => {
  assert.equal(JSON.stringify(catalog).includes(FIXTURE_SECRET), false);
  for (const tool of catalog) assert.equal(JSON.stringify(tool.inputSchema).includes(FIXTURE_SECRET), false);
});
