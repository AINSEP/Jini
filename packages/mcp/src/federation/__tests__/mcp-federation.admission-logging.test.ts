/**
 * Operator-facing warnings and connect-failure accounting of `attachFederatedMcpTools`, and the
 * reload coordinator's default wiring onto it. Every remote is a hand-written `connect` fake.
 */
import { messages as federationMessages, testPermissionGate } from "./fixtures.js";
import { describe, expect, it } from "vitest";

import type { ToolDescriptor, ToolRegistration, ToolRegistry } from "@jini-ai/core";

import { attachFederatedMcpTools } from "../bootstrap.js";
import { FEDERATED_CONNECTION_DEFAULTS, type ResolvedFederatedConnection } from "../config.js";
import type { FederatedMcpConnectionConfig, McpSessionPort } from "../ports.js";
import { createFederationReloadCoordinator } from "../reload.js";

const SCOPE = "ws-logging";
const DEPS = { errorCode: "EXTERNAL_MCP", messages: federationMessages, permissionGate: testPermissionGate({ authorize: async () => ({ allowed: true, reason: "matched" }), scope: SCOPE }), scope: SCOPE };

function connection(connectionId: string, allowedToolNames: string[] = []): ResolvedFederatedConnection {
  const config: FederatedMcpConnectionConfig = {
    connectionId, label: connectionId, allowedToolNames, writeAllowedToolNames: [],
    connectTimeoutMs: FEDERATED_CONNECTION_DEFAULTS.connectTimeoutMs, callTimeoutMs: FEDERATED_CONNECTION_DEFAULTS.callTimeoutMs,
    maxResultBytes: FEDERATED_CONNECTION_DEFAULTS.maxResultBytes, maxTools: FEDERATED_CONNECTION_DEFAULTS.maxTools,
  };
  return { config, launch: { url: `https://example.invalid/${connectionId}`, headers: {} } };
}

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

function collectingLogger() {
  const messages: string[] = [];
  return { messages, logger: { error: () => undefined, info: ({ message }: { message: string }) => { messages.push(`info:${message}`); }, warn: ({ message }: { message: string }) => { messages.push(`warn:${message}`); } } };
}

const pingSession = (): McpSessionPort => ({
  listTools: async () => [{ name: "ping", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }],
  callTool: async () => ({ content: [] }),
  close: async () => undefined,
});

describe("attachFederatedMcpTools — operator warnings", () => {
  it("warns about an allowlisted tool the server never advertised, and still admits the advertised one", async () => {
    const { messages, logger } = collectingLogger();
    const registry = fakeRegistry();
    const result = await attachFederatedMcpTools({ registry, deps: DEPS, connect: async () => pingSession() }, { connections: [connection("vendor", ["ping", "pnig"])], logger });

    expect(result.reports[0]?.report.allowlistedButAbsent).toEqual(["pnig"]);
    expect(registry.registered).toHaveLength(1);
    expect(messages).toContain("warn:mcp-federation: 'vendor' allowlists 'pnig' but the server never advertised it — check the allowlist for a typo, or the server's --features");
  });

  it("records a connect failure that throws a non-Error value with its string form, and continues", async () => {
    const { messages, logger } = collectingLogger();
    const result = await attachFederatedMcpTools({ registry: fakeRegistry(), deps: DEPS, connect: async () => { throw "ECONNREFUSED"; } }, { connections: [connection("down")], logger });

    expect(result.connectFailures).toEqual([{ connectionId: "down", reason: "ECONNREFUSED" }]);
    expect(result.reports).toEqual([]);
    expect(messages).toContain("warn:mcp-federation: 'down' failed, continuing without its tools — ECONNREFUSED");
  });
});

describe("createFederationReloadCoordinator — default attach", () => {
  it("admits through the real attachFederatedMcpTools when no attach seam is given, logging to the supplied logger", async () => {
    const { messages, logger } = collectingLogger();
    const registry = fakeRegistry();
    const coordinator = createFederationReloadCoordinator({ coordDeps: {
      registry, deps: DEPS, logger,
      connect: async ({ connection: { config } }) => { if (config.connectionId === "down") throw new Error("handshake refused"); return pingSession(); },
      resolveConnections: async () => [connection("vendor", ["ping"]), connection("down")],
    }, initiallyAdmitted: [] });

    const result = await coordinator.reload({});

    expect(result.newlyAdmittedConnectionIds).toEqual(["vendor"]);
    expect(result.connectFailures).toEqual([{ connectionId: "down", reason: "handshake refused" }]);
    expect(registry.registered.map((registration) => registration.descriptor.id)).toHaveLength(1);
    expect(messages).toContain("warn:mcp-federation: 'down' failed, continuing without its tools — handshake refused");
    expect([...coordinator.admittedConnectionIds()]).toEqual(["vendor"]);
  });
});
