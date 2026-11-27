import { describe, expect, test } from "vitest";
import { McpAuthFailedError, McpProtocolError } from "../../mcp-protocol.js";
import { probeExternalMcpServer, type ExternalMcpProbePorts } from "../probe.js";

const WS = "acme-ws-1";
const record = (over: Record<string, unknown> = {}) => ({ serverId: "remote", workspaceId: WS, label: "Remote", transport: "streamable_http", enabled: true, authMode: "none", oauthStatus: null, ...over });
const config = { serverId: "remote", label: "Remote", transport: "streamable_http", authMode: "none", enabled: true, allowedToolNames: ["read_thing"], writeAllowedToolNames: [],
  target: { kind: "streamable_http", url: "https://mcp.acme.test/mcp", headers: {} }, admissionRevision: "r1" };
function ports(over: Partial<ExternalMcpProbePorts> & { row?: Record<string, unknown> | null; failures?: unknown[]; configs?: unknown[] } = {}): ExternalMcpProbePorts {
  const row = over.row === undefined ? record() : over.row;
  return {
    repo: { findByServerId: async () => row as never },
    readEnabledConfigs: async () => ({ configs: (over.configs ?? [config]) as never, failures: (over.failures ?? []) as never }),
    connect: over.connect ?? (async () => ({ listTools: async () => [], callTool: async () => { throw new Error("never"); }, close: async () => undefined }) as never),
  };
}
const probe = (p: ExternalMcpProbePorts) => probeExternalMcpServer({ ports: p, workspaceId: WS, serverId: "remote" });

describe("probeExternalMcpServer", () => {
  test("record-level refusals never resolve credentials or connect", async () => {
    let reads = 0; let connects = 0;
    const counting = (p: ExternalMcpProbePorts): ExternalMcpProbePorts => ({ ...p, readEnabledConfigs: async (r) => { reads += 1; return p.readEnabledConfigs(r); }, connect: async (r) => { connects += 1; return p.connect(r); } });
    expect(await probe(counting(ports({ row: null })))).toEqual({ ok: false, failure: { kind: "unknown_server" } });
    expect(await probe(counting(ports({ row: record({ transport: "stdio" }) })))).toEqual({ ok: false, failure: { kind: "local_command", stage: "record" } });
    expect(await probe(counting(ports({ row: record({ enabled: false }) })))).toEqual({ ok: false, failure: { kind: "disabled" } });
    expect(await probe(counting(ports({ row: record({ authMode: "oauth", oauthStatus: "needs_reauth" }) })))).toEqual({ ok: false, failure: { kind: "reauth_required", stage: "stored", label: "Remote" } });
    expect([reads, connects]).toEqual([0, 0]);
  });

  test("a store miss maps by the typed category, never by reason wording", async () => {
    expect(await probe(ports({ configs: [], failures: [{ serverId: "remote", reason: "reworded entirely", category: "reauth_required" }] })))
      .toEqual({ ok: false, failure: { kind: "reauth_required", stage: "resolve", reason: "reworded entirely" } });
    expect(await probe(ports({ configs: [], failures: [{ serverId: "remote", reason: "its authorization expired or was revoked — reconnect it in Console" }] })))
      .toEqual({ ok: false, failure: { kind: "unresolved", reason: "its authorization expired or was revoked — reconnect it in Console" } });
    expect(await probe(ports({ configs: [], failures: [] }))).toEqual({ ok: false, failure: { kind: "unresolved" } });
  });

  test("connects with the connect timeout, lists once and always closes", async () => {
    const seen: unknown[] = []; let closed = 0;
    const result = await probe(ports({ connect: async ({ spec, requestTimeoutMs }) => {
      seen.push(spec.url, requestTimeoutMs);
      return { listTools: async () => [{ name: "read_thing", description: "Reads.", inputSchema: { type: "object" } }], callTool: async () => { throw new Error("never"); }, close: async () => { closed += 1; } } as never;
    } }));
    expect(result.ok).toBe(true);
    expect(seen[0]).toBe("https://mcp.acme.test/mcp");
    expect(typeof seen[1]).toBe("number");
    expect(closed).toBe(1);
  });

  test("connection failures collapse to closed categories", async () => {
    const failing = (error: unknown) => ports({ connect: async () => { throw error; } });
    expect(await probe(failing(new McpAuthFailedError({ message: "x" } as never)))).toEqual({ ok: false, failure: { kind: "auth" } });
    expect(await probe(failing(Object.assign(new Error("upstream said sk_secret"), { status: 403 })))).toEqual({ ok: false, failure: { kind: "auth" } });
    expect(await probe(failing(Object.assign(new Error("slow"), { name: "TimeoutError" })))).toEqual({ ok: false, failure: { kind: "timeout" } });
    expect(await probe(failing(new McpProtocolError({ message: "request timed out" } as never)))).toEqual({ ok: false, failure: { kind: "timeout" } });
    expect(await probe(failing(new Error("ECONNREFUSED")))).toEqual({ ok: false, failure: { kind: "unreachable" } });
  });
});

test.each([
  [{ statusCode: 401 }, 'auth'],
  [{ statusCode: 503 }, 'unreachable'],
  ['timeout', 'unreachable'],
] as const)('maps a legacy statusCode or non-Error rejection without leaking the rejection: %j', async (error, kind) => {
  const p = ports({ connect: async () => { throw error; } });
  expect(await probe(p)).toStrictEqual({ ok: false, failure: { kind } });
});
