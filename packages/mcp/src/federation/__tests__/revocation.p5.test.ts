import assert from "node:assert/strict";
import { test } from "vitest";
import { createFederatedConnectionRevocationGate, rosterRefusalFor } from "../approvals/index.js";
import type { ConnectionRosterSnapshot, ExternalMcpRevocationReason } from "../approvals/index.js";
import type { FederatedCallTarget } from "../ports.js";

// Generalized from the connection-revocation suite: DB projection and OAuth wiring stay in the host.
const call: FederatedCallTarget = { remoteName: "write_thing", declaredAnnotations: { readOnlyHint: false }, origin: { kind: "roster", admissionRevision: "revision-1" } };
const row: ConnectionRosterSnapshot = { label: "Service", enabled: true, admissionRevision: "revision-1", disconnected: false, grants: { allowedToolNames: ["read_thing", "write_thing"], writeAllowedToolNames: [] } };
for (const [record, target, expected] of [
  [row, call, null], [null, call, "removed"], [{ ...row, enabled: false }, call, "turned-off"],
  [{ ...row, admissionRevision: "revision-2", enabled: false }, call, "changed"],
  [{ ...row, disconnected: true }, call, "disconnected"],
  [{ ...row, grants: { allowedToolNames: [], writeAllowedToolNames: ["write_thing"] } }, call, "tool-not-allowed"],
  [row, { ...call, origin: undefined }, "unverifiable"], [row, { ...call, origin: { kind: "preset" } }, "unverifiable"],
] as const) test(`roster outcome ${expected} respects revision before current state`, () => {
  assert.equal(rosterRefusalFor({ record, call: target }), expected);
});

test("gate reads the current roster each call, so disable, reenable and deletion apply immediately", async () => {
  let current: ConnectionRosterSnapshot | null = row;
  let reads = 0;
  const events: ExternalMcpRevocationReason[] = [];
  const gate = createFederatedConnectionRevocationGate({ roster: { findByServerId: async (input, optional) => {
    assert.deepEqual(input, { serverId: "service" }); assert.deepEqual(optional, { scope: "workspace" }); reads++; return current;
  } }, errorFactory: { create: ({ reason }) => Object.assign(new Error(reason), { code: "EXTERNAL_MCP_CONNECTION_REVOKED", retryable: false, reason }) } }, {
    scope: "workspace", webhooks: { connectionRefused: async ({ reason }) => { events.push(reason); } },
  });
  await gate({ connectionId: "service", call });
  current = { ...row, enabled: false }; await assert.rejects(() => gate({ connectionId: "service", call }), /turned-off/);
  current = row; await gate({ connectionId: "service", call });
  current = null; await assert.rejects(() => gate({ connectionId: "service", call }), /removed/);
  assert.equal(reads, 4); assert.deepEqual(events, ["turned-off", "removed"]);
});

test("store failure fails closed without disclosing driver errors, even when notification fails", async () => {
  const diagnostics: unknown[] = [];
  const gate = createFederatedConnectionRevocationGate({ roster: { findByServerId: async () => { throw new Error("private/db/path"); } },
    errorFactory: { create: ({ reason }) => new Error(reason) } }, {
    scope: "workspace", webhooks: { connectionRefused: async () => { throw new Error("delivery failed"); } }, onDiagnostic: event => { diagnostics.push(event); },
  });
  await assert.rejects(() => gate({ connectionId: "service", call }), { message: "unverifiable" });
  assert.equal(diagnostics.length, 2);
});

test("presets bypass the roster gate; the app composes its independent credential check", async () => {
  let reads = 0;
  const gate = createFederatedConnectionRevocationGate({ roster: { findByServerId: async () => { reads++; return null; } }, errorFactory: { create: ({ reason }) => new Error(reason) } });
  await gate({ connectionId: "preset", call: { ...call, origin: { kind: "preset" } } });
  assert.equal(reads, 0);
});
