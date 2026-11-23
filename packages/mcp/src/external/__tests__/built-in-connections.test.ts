import assert from "node:assert/strict";
import { test } from "vitest";

import { describeExternalMcpOwnership, isBuiltInExternalMcpServer, readBuiltInExternalMcpServerIds } from "../built-in-connections.js";

test("the managed roster defaults to empty when desktop did not supply it", () => {
  assert.deepEqual(readBuiltInExternalMcpServerIds({ env: {} }), []);
});

test("the managed roster preserves server ids from a valid string array", () => {
  assert.deepEqual(readBuiltInExternalMcpServerIds({ env: { JINI_BUILT_IN_MCP_SERVER_IDS: '["desktop-a","desktop-b"]' } }, {}), ["desktop-a", "desktop-b"]);
});

for (const value of ["{", "null", "{}", '"desktop-a"', '["desktop-a",42]', "[]"]) {
  test(`an invalid or empty managed roster ${value} grants no ownership`, () => {
    assert.deepEqual(readBuiltInExternalMcpServerIds({ env: { JINI_BUILT_IN_MCP_SERVER_IDS: value } }), []);
  });
}

test("ownership matches ids exactly and never infers it from a server label", () => {
  const server = { serverId: "custom", label: "Desktop", enabled: true };
  assert.equal(isBuiltInExternalMcpServer({ serverId: "desktop-a", ids: ["desktop-a"] }, {}), true);
  assert.equal(isBuiltInExternalMcpServer({ serverId: "Desktop-A", ids: ["desktop-a"] }), false);
  assert.equal(isBuiltInExternalMcpServer({ serverId: "desktop-a", ids: [] }), false);
  assert.equal(isBuiltInExternalMcpServer({ serverId: "desktop-a" }), false);
  assert.deepEqual(describeExternalMcpOwnership({ server, ids: ["custom"] }, {}), { ...server, builtIn: true });
  assert.deepEqual(describeExternalMcpOwnership({ server, ids: ["desktop-a"] }), { ...server, builtIn: false });
  assert.deepEqual(describeExternalMcpOwnership({ server }), { ...server, builtIn: false });
  assert.deepEqual(server, { serverId: "custom", label: "Desktop", enabled: true });
});
