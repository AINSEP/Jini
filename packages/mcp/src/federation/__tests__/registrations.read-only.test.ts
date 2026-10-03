import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, onTestFinished, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { InMemoryMcpSession } from "../testing/adapter.memory.js";
import { federateSession } from "../registrations.js";
import type { FederatedMcpConnectionConfig, RemoteToolDescriptor } from "../ports.js";

const config: FederatedMcpConnectionConfig = {
  connectionId: "higgsfield", label: "Higgsfield", allowedToolNames: ["models_explore", "job_status", "generate"],
  writeAllowedToolNames: [], readOnlyRemoteNames: new Set(["models_explore", "job_status"]),
  connectTimeoutMs: 1000, callTimeoutMs: 1000, maxResultBytes: 4096, maxTools: 8,
};
const ctx: ToolExecutionContext = { executionId: "exec", principal: { id: "owner" }, run: { id: "run" }, input: {}, signal: new AbortController().signal };
const schema = { type: "object", properties: {}, additionalProperties: false };
async function load(tools: RemoteToolDescriptor[]) {
  const session = new InMemoryMcpSession({ tools });
  const cards: string[] = [];
  const result = await federateSession({ session, config, nativeToolIds: new Set(), deps: { messages: federationMessages, errorCode: "EXTERNAL_MCP", permissionGate: testPermissionGate({ authorize: async () => ({ allowed: true, reason: "matched" }), scope: "workspace" }), scope: "workspace", confirmCall: async ({ context: _ctx, request }) => { cards.push(request.remoteName); return { confirmed: true }; } } });
  return { ...result, session, cards };
}

test("listed tools are read-only without hints; an unlisted remote read hint cannot grant descriptor readOnly", async () => {
  const loaded = await load([
    { name: "models_explore", inputSchema: schema },
    { name: "job_status", inputSchema: schema, annotations: { readOnlyHint: true } },
    { name: "generate", inputSchema: schema, annotations: { readOnlyHint: true } },
  ]);
  assert.deepEqual(loaded.registrations.map((r) => [r.descriptor.id, r.descriptor.readOnly]), [
    ["mcp__higgsfield__models_explore", true], ["mcp__higgsfield__job_status", true], ["mcp__higgsfield__generate", undefined],
  ]);
  await loaded.registrations[0]!.handler(ctx);
  assert.deepEqual(loaded.cards, [], "operator-listed read tools must not park waiting for a card");
  assert.deepEqual(loaded.session.calls, [{ name: "models_explore", arguments: {} }]);
});

test("a fresh roster admission drops readOnly when the remote contradicts the read list, and ordinary writes run without confirmation", async () => {
  const initial = await load([{ name: "models_explore", inputSchema: schema }]);
  assert.equal(initial.registrations[0]!.descriptor.readOnly, true);
  for (const annotations of [{ readOnlyHint: false }, { readOnlyHint: true, destructiveHint: true }]) {
    const reloaded = await load([{ name: "models_explore", inputSchema: schema, annotations }]);
    assert.equal(reloaded.registrations[0]!.descriptor.readOnly, undefined);
    assert.equal(reloaded.report.admitted[0]!.confirmation, annotations.destructiveHint ? "confirm-destructive" : "none");
    await reloaded.registrations[0]!.handler(ctx);
    assert.deepEqual(reloaded.cards, annotations.destructiveHint ? ["models_explore"] : []);
    assert.deepEqual(reloaded.session.calls, [{ name: "models_explore", arguments: {} }]);
  }
});

test("operator read metadata cannot bypass the separate admission allowlist", async () => {
  const loaded = await load([{ name: "never_allowed", inputSchema: schema }]);
  assert.deepEqual(loaded.registrations, []);
  assert.deepEqual(loaded.report.refused, [{ remoteName: "never_allowed", reason: "not-in-operator-allowlist" }]);
});


test("a reviewed read with a query input runs without a card, while a contradictory read hint removes descriptor readOnly", async () => {
  const inputSchema = { type: "object", properties: { query: { type: "string" } }, additionalProperties: false };
  const loaded = await load([{ name: "models_explore", inputSchema }]);
  assert.equal(loaded.registrations[0]!.descriptor.readOnly, true);
  assert.equal(loaded.report.admitted[0]!.confirmation, "none");
  await loaded.registrations[0]!.handler({ ...ctx, input: { query: "image models" } });
  assert.deepEqual(loaded.cards, []);
  assert.deepEqual(loaded.session.calls, [{ name: "models_explore", arguments: { query: "image models" } }]);
  const contradicted = await load([{ name: "models_explore", inputSchema, annotations: { readOnlyHint: false } }]);
  await contradicted.registrations[0]!.handler({ ...ctx, input: { query: "image models" } });
  assert.deepEqual(contradicted.cards, []);
  assert.equal(contradicted.registrations[0]!.descriptor.readOnly, undefined);
});
