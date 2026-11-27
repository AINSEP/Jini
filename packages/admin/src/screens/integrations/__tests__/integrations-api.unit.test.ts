import { describe, expect, it, vi } from "vitest";
import { createIntegrationsApi, type IntegrationsRequestFn } from "../api/integrations-api.js";

/** Request-shape suite for the integrations client: paths, methods and bodies, plus the admissions flattening. */

function apiAnswering(body: unknown) {
  const request = vi.fn(async () => body) as unknown as IntegrationsRequestFn & ReturnType<typeof vi.fn>;
  return { api: createIntegrationsApi({ request, workspaceId: "w1" }), request };
}

describe("createIntegrationsApi request shapes", () => {
  it("scopes webhook subscription calls under the injected workspace", async () => {
    const { api, request } = apiAnswering({});
    await api.listIntegrationSubscriptions();
    await api.createIntegrationSubscription({ label: "L", targetUrl: "https://x.test", topics: ["a"] });
    await api.pauseIntegrationSubscription({ id: "s/1", paused: true });
    await api.deleteIntegrationSubscription({ id: "s1" });
    await api.listIntegrationDeliveries({ subscriptionId: "s1" });
    expect(request.mock.calls).toEqual([
      [{ path: "/workspaces/w1/integrations/subscriptions" }],
      [{ path: "/workspaces/w1/integrations/subscriptions" }, { init: { method: "POST", body: JSON.stringify({ label: "L", targetUrl: "https://x.test", topics: ["a"] }) } }],
      [{ path: "/workspaces/w1/integrations/subscriptions/s%2F1/pause" }, { init: { method: "POST", body: JSON.stringify({ paused: true }) } }],
      [{ path: "/workspaces/w1/integrations/subscriptions/s1" }, { init: { method: "DELETE" } }],
      [{ path: "/workspaces/w1/integrations/subscriptions/s1/deliveries" }],
    ]);
  });

  it("encodes server ids and sends the optional OAuth destination only when given", async () => {
    const { api, request } = apiAnswering({});
    await api.connectExternalMcpOAuth({ serverId: "a b" });
    await api.connectExternalMcpOAuth({ serverId: "a b" }, { destination: "shared" });
    await api.revokeExternalMcpToolApproval({ serverId: "s", toolName: "t/x" });
    expect(request.mock.calls).toEqual([
      [{ path: "/workspaces/w1/mcp-servers/a%20b/oauth/connect" }, { init: { method: "POST" } }],
      [{ path: "/workspaces/w1/mcp-servers/a%20b/oauth/connect" }, { init: { method: "POST", body: JSON.stringify({ destination: "shared" }) } }],
      [{ path: "/workspaces/w1/mcp-servers/s/tool-approvals/t%2Fx" }, { init: { method: "DELETE" } }],
    ]);
  });

  it("PATCHes an Agent Plugin's enabled flag", async () => {
    const { api, request } = apiAnswering({});
    await api.setAgentPluginEnabled({ pluginId: "p", enabled: false });
    expect(request).toHaveBeenCalledWith({ path: "/workspaces/w1/agent-plugins/p" }, { init: { method: "PATCH", body: JSON.stringify({ enabled: false }) } });
  });
});

describe("createIntegrationsApi.getExternalMcpAdmissions", () => {
  const report = { admitted: [{ remoteName: "a", writeAuthorized: true }], refused: [], allowlistedButAbsent: ["b"], writeAllowedButNotAllowlisted: [] };

  it("flattens the daemon's report-nested wire shape and copies isPreset only when sent", async () => {
    const { api } = apiAnswering({ connections: [{ connectionId: "c1", isPreset: false, report }, { connectionId: "c2", report }] });
    const snapshot = await api.getExternalMcpAdmissions();
    expect(snapshot.connections).toEqual([{ connectionId: "c1", ...report, isPreset: false }, { connectionId: "c2", ...report }]);
    expect("configFailures" in snapshot).toBe(false);
  });

  it("keeps absent configFailures distinguishable from an empty list and tolerates a missing connections key", async () => {
    expect((await apiAnswering({ connections: [], configFailures: [] }).api.getExternalMcpAdmissions()).configFailures).toEqual([]);
    expect((await apiAnswering({}).api.getExternalMcpAdmissions()).connections).toEqual([]);
  });
});

const serverId = "team/calendar ?";
const serverPath = "/workspaces/ops/mcp-servers/team%2Fcalendar%20%3F";

function requestReply(expected: Parameters<IntegrationsRequestFn>, response: unknown) {
  const transport = vi.fn(async (...args: Parameters<IntegrationsRequestFn>) => {
    expect(args).toEqual(expected);
    return response;
  });
  // The host's request contract owns JSON decoding; this fixture represents the response body.
  const request: IntegrationsRequestFn = async <T>(...args: Parameters<IntegrationsRequestFn>) => (await transport(...args)) as T;
  return { api: createIntegrationsApi({ request, workspaceId: "ops" }), request: transport };
}

const server = {
  serverId, label: "Team Calendar", version: 7, authMode: "none", enabled: false, transport: "stdio",
  command: "calendar-mcp", url: null, args: ["--read-only"], allowedToolNames: ["list_events"], writeAllowedToolNames: [],
  writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: ["CALENDAR_KEY"],
  oauth: { providerId: null, grant: null, clientId: null, scopes: [], status: "disconnected", expiresAt: null, tokenEnvName: null, hasStoredToken: false },
};

it("reads the configured server roster in the selected workspace", async () => {
  const { api, request } = requestReply([{ path: "/workspaces/ops/mcp-servers" }], { servers: [server] });
  expect(await api.listExternalMcpServers()).toEqual({ servers: [server] });
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  { change: "preserving", credentials: {} },
  { change: "clearing", credentials: { env: "" } },
])("saves an encoded server ID while $change existing credentials", async ({ credentials }) => {
  const body = { expectedVersion: 6, transport: "stdio", enabled: false, command: "calendar-mcp", args: "--read-only", allowedToolNames: "list_events", writeAllowedToolNames: "", ...credentials };
  const answer = { server, restartRequired: true };
  const { api, request } = requestReply([{ path: serverPath }, { init: { method: "PUT", body: JSON.stringify(body) } }], answer);
  expect(await api.saveExternalMcpServer({ serverId, body })).toEqual(answer);
  expect(request).toHaveBeenCalledTimes(1);
});

it("deletes the selected server and relays the restart requirement", async () => {
  const answer = { removed: true, restartRequired: true };
  const { api, request } = requestReply([{ path: serverPath }, { init: { method: "DELETE" } }], answer);
  expect(await api.deleteExternalMcpServer({ serverId })).toEqual(answer);
  expect(request).toHaveBeenCalledTimes(1);
});

it("probes the selected server and returns the live tool report", async () => {
  const answer = {
    probedAt: "2026-11-23T09:01:00Z", tools: [{ remoteName: "list_events", description: "Browse the calendar",
      writeDeclared: false, destructiveDeclared: false, hintsAbsent: false, allowlisted: true, writeAllowed: false, admitted: true, refusalReason: null }],
  };
  const { api, request } = requestReply([{ path: `${serverPath}/probe` }, { init: { method: "POST" } }], answer);
  expect(await api.probeExternalMcpServer({ serverId })).toEqual(answer);
  expect(request).toHaveBeenCalledTimes(1);
});

it("lists and selects a shared connection by credential ID without sending the server ID in the body", async () => {
  const list = {
    available: true, connections: [{ credentialId: "cal-dept", label: "Department" }, { credentialId: "cal-site", label: "Site" }],
    current: { credentialId: "cal-dept", status: "connected", granted: true },
  };
  const listRequest = requestReply([{ path: `${serverPath}/oauth/shared` }], list);
  expect(await listRequest.api.listSharedMcpConnections({ serverId })).toEqual(list);
  expect(listRequest.request).toHaveBeenCalledTimes(1);
  const select = requestReply([{ path: `${serverPath}/oauth/shared` }, { init: { method: "POST", body: '{"credentialId":"cal-site"}' } }], { connected: true });
  expect(await select.api.useSharedMcpConnection({ serverId, credentialId: "cal-site" })).toEqual({ connected: true });
  expect(select.request).toHaveBeenCalledTimes(1);
});

it("preserves a device sign-in's retry delay when polling the selected server", async () => {
  const answer = { status: "pending", retryAfterSeconds: 7 };
  const { api, request } = requestReply([{ path: `${serverPath}/oauth/device/poll` }, { init: { method: "POST" } }], answer);
  expect(await api.pollExternalMcpOAuthDevice({ serverId })).toEqual(answer);
  expect(request).toHaveBeenCalledTimes(1);
});

it("lists approvals in the current workspace", async () => {
  const answer = { approvals: [{ serverId, toolName: "update_event", grantedByPrincipalId: "owner-42", grantedAt: "2026-11-21T10:00:00Z" }] };
  const { api, request } = requestReply([{ path: "/workspaces/ops/mcp-servers/tool-approvals" }], answer);
  expect(await api.listExternalMcpToolApprovals()).toEqual(answer);
  expect(request).toHaveBeenCalledTimes(1);
});

it("reads files from the named agent plugin rather than the server roster", async () => {
  const answer = {
    pluginId: "team/readme", files: [{ relativePath: "README.md", sizeBytes: 8, content: "# Plugin", omitted: null }],
    truncated: false, limits: { maxFiles: 20, maxEntries: 40, maxFileBytes: 8192, maxTotalBytes: 16384 },
  };
  const { api, request } = requestReply([{ path: "/workspaces/ops/agent-plugins/team%2Freadme/files" }], answer);
  expect(await api.getAgentPluginFiles({ pluginId: "team/readme" })).toEqual(answer);
  expect(request).toHaveBeenCalledTimes(1);
});

it("clears the shared selection when returning to local and disconnects OAuth through the distinct route", async () => {
  const local = requestReply([{ path: `${serverPath}/oauth/shared` }, { init: { method: "DELETE" } }], undefined);
  expect(await local.api.useLocalMcpConnection({ serverId })).toBeUndefined();
  expect(local.request).toHaveBeenCalledTimes(1);
  const disconnected = requestReply([{ path: `${serverPath}/oauth` }, { init: { method: "DELETE" } }], undefined);
  expect(await disconnected.api.stopSharedMcpConnection({ serverId })).toBeUndefined();
  expect(disconnected.request).toHaveBeenCalledTimes(1);
});

it("lists installed Agent Plugins independently of regular plugins or external servers", async () => {
  const answer = { agentPlugins: [{
    pluginId: "cal-tools", version: "1.2.0", description: null, keywords: ["calendar"],
    skills: [{ name: "agenda", summary: "Prepare the agenda" }], mcpServerIds: [], enabled: true,
  }] };
  const { api, request } = requestReply([{ path: "/workspaces/ops/agent-plugins" }], answer);
  expect(await api.listAgentPlugins()).toEqual(answer);
  expect(request).toHaveBeenCalledTimes(1);
});
