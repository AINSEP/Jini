import { messages as federationMessages, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import type { ToolDescriptor, ToolRegistration, ToolRegistry } from "@jini-ai/core";
import { createFederatedConnectionRevocationGate } from "../approvals/index.js";
import { attachFederatedMcpTools } from "../bootstrap.js";
import { FEDERATED_CONNECTION_DEFAULTS } from "../config.js";
import { createFederatedMcpPresetRegistry } from "../presets.js";
import type { RemoteToolDescriptor } from "../ports.js";

// Lot fed-security "Presets" (2026-10-27): a preset-admitted connection has no roster row, so the
// host's revocation gate skips it — and before this fix nothing else checked "may write" per call.
// The grant check now lives in the handler for every connection; a preset's default write grant is
// whatever it authors in `writeAllowedToolNames`, which the admission report shows per tool.

const CREATE: RemoteToolDescriptor = { name: "create_project", inputSchema: { type: "object" }, annotations: { readOnlyHint: false } };
const LIST: RemoteToolDescriptor = { name: "list_tables", inputSchema: { type: "object" } };

function fakeRegistry(): ToolRegistry & { registered: ToolRegistration[] } {
  const registered: ToolRegistration[] = [];
  const descriptors: ToolDescriptor[] = [];
  return {
    registered,
    register(registration) { registered.push(registration); descriptors.push(registration.descriptor); },
    has: ({ toolId }: { toolId: string }) => descriptors.some((descriptor) => descriptor.id === toolId),
    list: () => descriptors,
  };
}

/** Boots one connection through the REAL preset path (registry → resolve → `withPresetOrigin`),
 *  with the real revocation gate wired the way a host wires it. */
async function bootPreset({ writeAllowedToolNames }: { writeAllowedToolNames: string[] }) {
  const presetRegistry = createFederatedMcpPresetRegistry({});
  presetRegistry.register({ preset: { presetId: "vendor", resolve: () => ({
    config: { ...FEDERATED_CONNECTION_DEFAULTS, connectionId: "vendor", label: "Vendor",
      allowedToolNames: [CREATE.name, LIST.name], writeAllowedToolNames },
    launch: { url: "https://example.invalid/mcp", headers: {} },
  }) } });
  const sent: string[] = [];
  const registry = fakeRegistry();
  const assertConnectionUsable = createFederatedConnectionRevocationGate({
    roster: { findByServerId: async () => { throw new Error("a preset has no roster row to read"); } },
    errorFactory: { create: ({ reason }) => new Error(`refused:${reason}`) },
  });
  const result = await attachFederatedMcpTools({ registry, deps: {
    messages: federationMessages, errorCode: "EXTERNAL_MCP", scope: "workspace", assertConnectionUsable,
    permissionGate: testPermissionGate({ scope: "workspace", authorize: async () => ({ allowed: true, reason: "matched" }) }),
  }, connect: async () => ({
    listTools: async () => [CREATE, LIST],
    callTool: async ({ name }) => { sent.push(name); return { content: [] }; },
    close: async () => undefined,
  }) }, { presetRegistry, env: {} });
  const call = (remoteName: string) => registry.registered.find((r) => r.descriptor.id === `mcp__vendor__${remoteName}`)!.handler({
    executionId: "execution", run: { id: "run" }, principal: { id: "owner" }, input: {}, signal: new AbortController().signal,
  });
  return { result, sent, call };
}

test("fed-presets: a preset's write tool with no write grant is refused per call and never sent", async () => {
  const { result, sent, call } = await bootPreset({ writeAllowedToolNames: [] });
  assert.equal(result.reports[0]!.isPreset, true);
  await assert.rejects(call(CREATE.name), /EXTERNAL_MCP_WRITE_NOT_ALLOWED/);
  assert.deepEqual(sent, []);
});

test("fed-presets: a preset's explicit default write grant lets the write run, and the admission report shows it", async () => {
  const { result, sent, call } = await bootPreset({ writeAllowedToolNames: [CREATE.name] });
  assert.deepEqual(result.reports[0]!.report.admitted.map((tool) => [tool.remoteName, tool.writeAuthorized]), [[CREATE.name, true], [LIST.name, false]]);
  await call(CREATE.name);
  assert.deepEqual(sent, [CREATE.name]);
});

test("fed-presets: a preset's read tool needs no write grant", async () => {
  const { sent, call } = await bootPreset({ writeAllowedToolNames: [] });
  await call(LIST.name);
  assert.deepEqual(sent, [LIST.name]);
});
