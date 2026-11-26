import { describe, expect, it, vi } from "vitest";
import { runWithExternalMcpRateLimit } from "../external-mcp/route-helpers.js";
import { registerExternalMcpProbeRoute } from "../external-mcp/probe.js";

describe("external MCP early admission", () => {
  it("refuses rate before the handler can authorize or call outbound", async () => {
    const events: string[] = [];
    const run = vi.fn(async () => { events.push("authorize"); events.push("outbound"); });
    await runWithExternalMcpRateLimit({ deps: { check: async () => { events.push("rate"); return { allowed: false, retryAfterSeconds: 12 }; }, retryAfter: value => { events.push(`retry ${value}`); }, json: (_body, status) => { events.push(`json ${status}`); }, message: "rate refused" }, run });
    expect(events).toEqual(["rate", "retry 12", "json 429"]);
    expect(run).not.toHaveBeenCalled();
  });

  it("mounts probe with the rate gate in front of the neutral route handler", async () => {
    let mounted!: Parameters<Parameters<typeof registerExternalMcpProbeRoute>[0]["mount"]>[0];
    registerExternalMcpProbeRoute({ mount: input => { mounted = input; }, probe: vi.fn(), operation: "host/probe" });
    const next = vi.fn(async () => {});
    const facts = { check: async () => ({ allowed: false as const, retryAfterSeconds: 1 }), retryAfter: vi.fn(), json: vi.fn(), message: "rate refused" };
    await mounted.before({ rate: facts }, next);
    expect(next).not.toHaveBeenCalled();
    expect(mounted.spec.path).toContain("/:serverId/probe");
  });
});
