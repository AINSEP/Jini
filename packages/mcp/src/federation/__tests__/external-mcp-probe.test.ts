import { describe, expect, test } from "vitest";
import { createExternalMcpProbe, type ExternalMcpProbeBaseDeps, type ExternalMcpProbeHost } from "../external-mcp-probe.js";

/**
 * @file The bound probe keeps the admin response contract (statuses, legacy codes) while every piece of host
 * copy, the reauthorization error, the settings link, the store read and the HTTP session arrive from the host.
 */
const WS = "acme-ws-1";
const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);
const record = (over: Record<string, unknown> = {}) => ({ serverId: "remote", workspaceId: WS, label: "Remote", transport: "streamable_http", enabled: true, authMode: "none", oauthStatus: null, ...over });
const config = { serverId: "remote", label: "Remote", transport: "streamable_http", authMode: "none", enabled: true, allowedToolNames: ["read_thing"], writeAllowedToolNames: [],
  target: { kind: "streamable_http", url: "https://mcp.acme.test/mcp", headers: { authorization: "Bearer sk_resolved" } }, admissionRevision: "r1" };
const session = (log: string[]) => ({ listTools: async () => [{ name: "read_thing", description: "Reads.", inputSchema: { type: "object" } }], callTool: async () => { throw new Error("never"); }, close: async () => { log.push("close"); } });

type Deps = ExternalMcpProbeBaseDeps & { readonly marker: string };

function setup({ row = record(), configs = [config], failures = [] as unknown[], connect }: { row?: Record<string, unknown> | null; configs?: unknown[]; failures?: unknown[]; connect?: Deps["connect"] } = {}) {
  const log: string[] = [];
  const host: ExternalMcpProbeHost<Deps> = {
    readEnabledConfigs: async ({ deps, workspaceId }) => { log.push(`read:${deps.marker}:${workspaceId}`); return { configs: configs as never, failures: failures as never }; },
    connectHttpSession: async ({ spec, requestTimeoutMs }) => { log.push(`http:${spec.url}:${typeof requestTimeoutMs}`); return session(log) as never; },
    // The host's error object may carry its own stored message; the probe must answer with the host's response copy instead.
    reauthRequired: ({ serverId }) => { const error = { message: "stored error text", code: "ACME_REAUTH", settingsLink: `acme://settings/${serverId}` }; return error; },
    reauthResponseText: ({ label }) => `Reconnect ${label} at Acme`,
    settingsDeepLink: ({ serverId }) => `acme://link/${serverId}`,
    reauthCode: "ACME_REAUTH_LIVE",
    connectFailureText: ({ id }) => `acme-copy:${id}`,
  };
  const deps: Deps = { workspaceId: WS as never, clock: { nowMs: () => NOW }, externalMcpServerRepo: { findByServerId: async () => row as never }, marker: "bag", ...(connect ? { connect } : {}) };
  return { probe: createExternalMcpProbe({ host }), deps, log };
}

describe("createExternalMcpProbe", () => {
  test("the default connect is the host's HTTP session; the store read receives the host's own deps bag", async () => {
    const { probe, deps, log } = setup();
    const result = await probe({ deps, serverId: "remote" });
    expect(result).toEqual({ ok: true, body: { tools: expect.any(Array), probedAt: new Date(NOW).toISOString() } });
    expect(log).toEqual([`read:bag:${WS}`, "http:https://mcp.acme.test/mcp:number", "close"]);
  });

  test("an injected deps.connect replaces the default session", async () => {
    const used: string[] = [];
    const { probe, deps, log } = setup({ connect: async () => { used.push("deps"); return session([]) as never; } });
    expect((await probe({ deps, serverId: "remote" })).ok).toBe(true);
    expect(used).toEqual(["deps"]);
    expect(log.some((line) => line.startsWith("http:"))).toBe(false);
  });

  test("record-level refusals keep their statuses and legacy codes", async () => {
    const run = async (row: Record<string, unknown> | null) => { const { probe, deps } = setup({ row }); return probe({ deps, serverId: "remote" }); };
    expect(await run(null)).toEqual({ ok: false, status: 400, body: { error: "no external MCP server is configured as 'remote'", code: "INVALID_MCP_SERVER", details: { field: "id" } } });
    expect(await run(record({ transport: "stdio" }))).toEqual({ ok: false, status: 400, body: { error: "probe is not available for local-command servers yet — type tool names directly instead", code: "PROBE_UNSUPPORTED_TRANSPORT", details: { field: "transport" } } });
    expect(await run(record({ enabled: false }))).toEqual({ ok: false, status: 400, body: { error: "this server is disabled — enable it before probing", code: "MCP_SERVER_DISABLED", details: { field: "enabled" } } });
  });

  test("both reauthorization paths answer 409 with the host's error and link", async () => {
    const stored = setup({ row: record({ authMode: "oauth", oauthStatus: "needs_reauth" }) });
    expect(await stored.probe({ deps: stored.deps, serverId: "remote" })).toEqual({ ok: false, status: 409, body: { error: "Reconnect Remote at Acme", code: "ACME_REAUTH", details: { retryable: false, settingsLink: "acme://settings/remote" } } });
    const live = setup({ configs: [], failures: [{ serverId: "remote", reason: "grant revoked", category: "reauth_required" }] });
    expect(await live.probe({ deps: live.deps, serverId: "remote" })).toEqual({ ok: false, status: 409, body: { error: "grant revoked", code: "ACME_REAUTH_LIVE", details: { retryable: false, settingsLink: "acme://link/remote" } } });
  });

  test("an unresolved row is 502 with the store's reason or the fixed fallback", async () => {
    const reasoned = setup({ configs: [], failures: [{ serverId: "remote", reason: "vault unavailable" }] });
    expect(await reasoned.probe({ deps: reasoned.deps, serverId: "remote" })).toEqual({ ok: false, status: 502, body: { error: "vault unavailable", code: "MCP_SERVER_UNREACHABLE" } });
    const bare = setup({ configs: [], failures: [] });
    expect(await bare.probe({ deps: bare.deps, serverId: "remote" })).toEqual({ ok: false, status: 502, body: { error: "this server's connection could not be resolved", code: "MCP_SERVER_UNREACHABLE" } });
  });

  test("connect failures use the host's credential-free copy, never the upstream text", async () => {
    const failing = (error: unknown) => setup({ connect: async () => { throw error; } });
    const cases: ReadonlyArray<[unknown, number, string, string]> = [
      [Object.assign(new Error("upstream said sk_secret"), { status: 401 }), 401, "MCP_AUTH_REJECTED", "acme-copy:auth"],
      [Object.assign(new Error("slow sk_secret"), { name: "TimeoutError" }), 504, "MCP_TIMEOUT", "acme-copy:timeout"],
      [new Error("ECONNREFUSED sk_secret"), 502, "MCP_SERVER_UNREACHABLE", "acme-copy:unreachable"],
    ];
    for (const [error, status, code, copy] of cases) {
      const { probe, deps } = failing(error);
      const result = await probe({ deps, serverId: "remote" });
      expect(result).toEqual({ ok: false, status, body: { error: copy, code } });
      expect(JSON.stringify(result)).not.toContain("sk_secret");
    }
  });
});
