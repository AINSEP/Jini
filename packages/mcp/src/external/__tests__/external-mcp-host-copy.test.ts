import assert from "node:assert/strict";
import { test } from "vitest";

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

function fixture({ allowed = true }: { allowed?: boolean } = {}) {
  const calls: unknown[] = [];
  const deps = { workspaceId: "ws-1", clock: { nowMs: () => 0 }, authorize: async () => ({ allowed: true, reason: "matched" }) } as never;
  const limiterClocks: unknown[] = [];
  const operations: ExternalMcpOperations = {
    copy,
    createProbeLimiter: ({ clock }) => { limiterClocks.push(clock); return { check: async ({ key }) => { calls.push(`budget:${key}`); return allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 7 }; } }; },
    probe: async ({ serverId }) => { calls.push(serverId); return { ok: false, status: 400, body: { error: "this server is disabled" } }; },
    admissions: async () => ({ ok: true, connections: [] }),
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

test("a failed admissions read is logged through the host's formatter only", async () => {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const readServerAdmissions = createServerAdmissionsReader({ describeErrorForLog: ({ err }) => `formatted:${(err as Error).name}` });
    const result = await readServerAdmissions({ awaitFederation: async () => ({ settled: true }), readAdmissions: async () => { throw new Error("secret-detail"); } });
    assert.equal(result.ok, false);
    assert.deepEqual(logged, [["external-mcp server admissions read failed", "formatted:Error"]]);
    assert.deepEqual(await readServerAdmissions({ awaitFederation: async () => ({ settled: true }), readAdmissions: async () => ({ connections: [], configFailures: [] }) }), { ok: true, connections: [], configFailures: [] });
    assert.deepEqual(await readServerAdmissions({ awaitFederation: async () => ({ settled: true }), readAdmissions: async () => ({ connections: [] }) }), { ok: true, connections: [] });
  } finally {
    console.error = original;
  }
});
