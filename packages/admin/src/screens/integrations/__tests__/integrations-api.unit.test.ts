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
