import assert from "node:assert/strict";
import { test } from "vitest";

import { bridgePreflightEntry } from "../mcp-bridge-preflight-entry.js";

// 2026-10-22 (main-verify PART 2): since af84bc598 the bridge injection carries startupToolIds, so the
// jini-mcp child fetched startup tool schemas from the daemon during the preflight — an authenticated
// call the deliberately token-less preflight cannot make, so every boot logged
// "jini bridge preflight FAILED (exit=1) jini-mcp: HTTP 401".
test("the preflight launches the real bridge with no token and no startup tool fetch", () => {
  const entry = bridgePreflightEntry({
    injection: {
      command: "node",
      args: ["serve.js"],
      daemonUrl: "http://127.0.0.1:1",
      env: { KEEP: "1" },
      diagnosticToolIds: () => ["a"],
      startupToolIds: () => { throw new Error("the preflight has no run to scope startup tools to"); },
    },
  });
  assert.equal(entry.command, "node");
  assert.deepEqual(entry.args, ["serve.js"]);
  assert.equal(entry.env.JINI_RUN_ID, "bridge-preflight");
  assert.equal(entry.env.JINI_DAEMON_URL, "http://127.0.0.1:1");
  assert.equal(entry.env.KEEP, "1");
  assert.equal(entry.env.JINI_DIAGNOSTIC_TOOL_IDS, JSON.stringify(["a"]));
  assert.equal("JINI_STARTUP_TOOL_IDS" in entry.env, false);
  assert.equal("JINI_DAEMON_TOKEN" in entry.env, false);
});
