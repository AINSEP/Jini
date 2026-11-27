import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { ToolInputError } from "@jini-ai/core";

import { createExternalMcpAgentToolCatalog, EXTERNAL_MCP_MANAGE_PERMISSION } from "../agent-tools.js";
import { createServerAdmissionsReader } from "../../federation/external-mcp-admissions.js";
import type { ExternalMcpHostCopy } from "../external-mcp-host-copy.js";
import { buildExternalMcpOperationsRegistrations, contributeExternalMcpOperationsTools, createExternalMcpOperationsToolCatalog, externalMcpOperationsDerivedRisk, type ExternalMcpOperations } from "../operations-tools.js";

/**
 * @file Model-facing external MCP text names the HOST's settings screen and read tool, which arrive
 * through `copy`; the probe budget and the failure log formatter are the host's too.
 */
const copy: ExternalMcpHostCopy = { settingsLocation: "Acme Settings → Servers", listToolName: "acme_list_servers" };
const allText = (value: unknown): string => JSON.stringify(value);

test("the setup catalog names the host's settings screen and read tool and never a hard-coded host", () => {
  const catalog = createExternalMcpAgentToolCatalog({ copy });
  assert.deepEqual(catalog.map((tool) => tool.name), ["external_mcp_list", "external_mcp_save", "external_mcp_test_connection", "external_mcp_oauth_connect", "external_mcp_oauth_poll_device"]);
  assert.ok(catalog.every((tool) => tool.authorization?.permission === EXTERNAL_MCP_MANAGE_PERMISSION));
  const save = catalog[1]!;
  assert.match(save.description, /Call acme_list_servers first if you are updating an existing id/);
  const props = (save.inputSchema as { properties: Record<string, { description: string }> }).properties;
  assert.match(props.id!.description, /the same PUT semantics Acme Settings → Servers itself uses/);
  assert.match(props.writeAllowedToolNames!.description, /For an UPDATE, call acme_list_servers first/);
  assert.match(catalog[3]!.description, /detect completion by calling acme_list_servers again/);
  assert.doesNotMatch(allText(catalog), /content_read|Settings → External MCP|tovu/i);
});

function fixture({ allowed = true, overrides }: { allowed?: boolean; overrides?: Partial<ExternalMcpOperations> } = {}) {
  const calls: unknown[] = [];
  const deps = { workspaceId: "ws-1", clock: { nowMs: () => 0 }, authorize: async () => ({ allowed: true, reason: "matched" }) } as never;
  const limiterClocks: unknown[] = [];
  const operations: ExternalMcpOperations = {
    copy,
    createProbeLimiter: ({ clock }) => { limiterClocks.push(clock); return { check: async ({ key }) => { calls.push(`budget:${key}`); return allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 7 }; } }; },
    probe: async ({ serverId }) => { calls.push(serverId); return { ok: false, status: 400, body: { error: "this server is disabled" } }; },
    admissions: async () => ({ ok: true, connections: [] }),
    ...overrides,
  };
  const registrations = buildExternalMcpOperationsRegistrations({ deps, operations });
  const call = (id: string, input: unknown) => registrations.find((r) => r.descriptor.id === id)!.handler({ executionId: "e", principal: { id: "owner" }, input, signal: new AbortController().signal } as never);
  return { calls, deps, operations, limiterClocks, call };
}

test("the operations catalog and refusals point the model at the host's read tool and settings screen", async () => {
  assert.match(allText(createExternalMcpOperationsToolCatalog({ copy })), /from acme_list_servers\..*Use acme_list_servers for saved server configuration/);
  assert.doesNotMatch(allText(createExternalMcpOperationsToolCatalog({ copy })), /content_read|tovu/i);
  const f = fixture();
  await assert.rejects(f.call("external_mcp_probe_connection", { id: " " }), { message: "external_mcp_probe_connection: pass a non-empty saved server id. Use acme_list_servers to find it." });
  await assert.rejects(f.call("external_mcp_probe_connection", { id: "hosted" }), { message: "external_mcp_probe_connection: this server is disabled. Review the server in Acme Settings → Servers; use external_mcp_test_connection for a configuration-only check." });
  assert.deepEqual(f.calls, ["budget:ws-1", "hosted"]);
});

test("the probe budget comes from the host's limiter, built once per deps with the deps clock", async () => {
  const f = fixture({ allowed: false });
  assert.equal(f.limiterClocks.length, 1);
  assert.equal(f.limiterClocks[0], (f.deps as { clock: unknown }).clock);
  await assert.rejects(f.call("external_mcp_probe_connection", { id: "hosted" }), { message: "external_mcp_probe_connection: too many probe attempts. Try again in 7 seconds." });
  assert.deepEqual(f.calls, ["budget:ws-1"]);
  const contributor = contributeExternalMcpOperationsTools(f.operations);
  assert.equal(contributor.risk, externalMcpOperationsDerivedRisk);
  assert.equal(contributor.build(f.deps, {} as never).length, 2);
  assert.equal(f.limiterClocks.length, 2);
});

test("a failed admissions read is reported through the host's reporter only, never the console", async () => {
  const logged: unknown[][] = [];
  const reported: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const failure = new Error("secret-detail");
    const readServerAdmissions = createServerAdmissionsReader({ reportReadFailure: ({ error }) => { reported.push(error); } });
    const result = await readServerAdmissions({ awaitFederation: async () => ({ settled: true }), readAdmissions: async () => { throw failure; } });
    assert.equal(result.ok, false);
    assert.deepEqual(reported, [failure]);
    assert.deepEqual(logged, []);
    assert.deepEqual(await readServerAdmissions({ awaitFederation: async () => ({ settled: true }), readAdmissions: async () => ({ connections: [], configFailures: [] }) }), { ok: true, connections: [], configFailures: [] });
    assert.deepEqual(await readServerAdmissions({ awaitFederation: async () => ({ settled: true }), readAdmissions: async () => ({ connections: [] }) }), { ok: true, connections: [] });
  } finally {
    console.error = original;
  }
});

test("returns the hosted probe report and calls the port with the trimmed id", async () => {
  const body = { tools: [{ name: "read_page" }], probedAt: "2026-01-02T03:04:05.000Z" };
  const probe = vi.fn<ExternalMcpOperations["probe"]>().mockResolvedValue({ ok: true, body });
  const f = fixture({ overrides: { probe } });
  assert.deepEqual(await f.call("external_mcp_probe_connection", { id: "  acme-docs " }), body);
  assert.deepEqual(probe.mock.calls, [[{ deps: f.deps, serverId: "acme-docs" }]]);
  assert.deepEqual(f.calls, ["budget:ws-1"]);
});

test("admissions returns the live connections, preserving optional configuration failures", async () => {
  const connections = [{ id: "docs", admitted: ["read_page"] }];
  const configFailures = [{ serverId: "old", reason: "disabled" }];
  const admissions = vi.fn<ExternalMcpOperations["admissions"]>()
    .mockResolvedValueOnce({ ok: true, connections, configFailures })
    .mockResolvedValueOnce({ ok: true, connections });
  const f = fixture({ overrides: { admissions } });
  assert.deepEqual(await f.call("external_mcp_get_admissions", undefined), { connections, configFailures });
  assert.deepEqual(await f.call("external_mcp_get_admissions", {}), { connections });
  assert.deepEqual(admissions.mock.calls, [[], []]);
});

test("an unavailable admissions report is actionable and invalid arguments never read it", async () => {
  const admissions = vi.fn<ExternalMcpOperations["admissions"]>()
    .mockResolvedValue({ ok: false, body: { error: "Server is starting", code: "AGENT_DAEMON_UNAVAILABLE" } });
  const f = fixture({ overrides: { admissions } });
  await assert.rejects(f.call("external_mcp_get_admissions", { id: "docs" }), {
    name: new ToolInputError({ message: "" }).name,
    message: "external_mcp_get_admissions: unsupported input fields. Never pass credentials through tool arguments.",
  });
  assert.deepEqual(admissions.mock.calls, []);
  await assert.rejects(f.call("external_mcp_get_admissions", {}), {
    name: new ToolInputError({ message: "" }).name,
    message: "external_mcp_get_admissions: Server is starting. Try again shortly; no live admissions report is available.",
  });
  assert.deepEqual(admissions.mock.calls, [[]]);
});
