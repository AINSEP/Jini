// The install/update upload spec: permission, then the update target, then the digest, then the body
// (read only through `raw.readBody`), then replace. The host's wire is pinned by its own integration tests.
import { describe, expect, it, vi } from "vitest";
import type { RawRouteInputContext, RouteBodyRead } from "@jini-ai/core/contracts/server";
import { agentPluginInstallZipRoute, agentPluginUpdateZipRoute, type AgentPluginInstallRouteDeps } from "../install.js";

const DIGEST = "a".repeat(64);

function fixture({ query = { expectedSha256: DIGEST }, params = {}, read = { ok: true, value: new Uint8Array([1]) } }: { query?: Record<string, unknown>; params?: Record<string, string>; read?: RouteBodyRead<Uint8Array> } = {}) {
  const order: string[] = [];
  const readBody = vi.fn(async () => { order.push("read"); return read; });
  const raw = { body: undefined, query, params, readBody } as unknown as RawRouteInputContext;
  const deps: AgentPluginInstallRouteDeps = {
    maxArchiveBytes: 32,
    isPluginName: ({ value }) => /^[a-z-]+$/.test(value),
    installUpload: vi.fn(async () => { order.push("install"); return { pluginId: "p", alreadyInstalled: false, warnings: ["w"] }; }),
    installedRow: async ({ pluginId }) => ({ pluginId }),
    bodyRefusal: ({ refusal }) => ({ status: refusal.reason === "too-large" ? 413 : 400, body: { code: "BODY", error: refusal.reason } }),
    installRefusal: ({ error }) => (error instanceof RangeError ? { status: 409, body: { code: "KNOWN", error: "known" } } : undefined),
  };
  const authorize = vi.fn(async () => { order.push("authorize"); });
  return { raw, deps, authorize, order, readBody };
}

const run = async (route: typeof agentPluginInstallZipRoute, f: ReturnType<typeof fixture>) => {
  const response = await route.handle({ raw: f.raw, deps: f.deps, context: { id: "u1" }, authorize: f.authorize }, { signal: new AbortController().signal });
  return { status: response.status, type: response.headers.get("content-type"), body: await response.json() };
};

describe("agent plugin install/update upload spec", () => {
  it("installs after authorize, reading the body after the checks; 201 with warnings and the row", async () => {
    const f = fixture();
    expect(await run(agentPluginInstallZipRoute, f)).toEqual({ status: 201, type: "application/json; charset=utf-8", body: { alreadyInstalled: false, warnings: ["w"], agentPlugin: { pluginId: "p" } } });
    expect(f.order).toEqual(["authorize", "read", "install"]);
    expect(f.readBody).toHaveBeenCalledWith({ type: "raw", mediaType: "application/zip", limit: 32 });
    expect(f.deps.installUpload).toHaveBeenCalledWith({ archive: new Uint8Array([1]), expectedSha256: DIGEST, replace: false, actor: "u1" });
  });

  it("a denied permission never reaches the target, the digest or the body", async () => {
    const f = fixture({ query: { expectedSha256: "bad" }, params: { pluginId: "BAD" } });
    f.authorize.mockRejectedValueOnce(new Error("denied"));
    await expect(run(agentPluginUpdateZipRoute, f)).rejects.toThrow("denied");
    expect(f.readBody).not.toHaveBeenCalled();
  });

  it("refuses in order: plugin id, old digest, digest, media type, body, replace — none reads past its refusal", async () => {
    const cases: Array<[ReturnType<typeof fixture>, typeof agentPluginInstallZipRoute, number, string, boolean]> = [
      [fixture({ params: { pluginId: "BAD" }, query: { expectedSha256: "bad" } }), agentPluginUpdateZipRoute, 400, "pluginId is not a valid Agent Plugin id.", false],
      [fixture({ params: { pluginId: "p" }, query: { expectedSha256: DIGEST, expectedOldDigest: "A".repeat(64) } }), agentPluginUpdateZipRoute, 400, "expectedOldDigest must be the installed revision's lowercase hex SHA-256.", false],
      [fixture({ query: { expectedSha256: [DIGEST, DIGEST] } }), agentPluginInstallZipRoute, 400, "expectedSha256 must be the file's lowercase hex SHA-256.", false],
      [fixture({ read: { ok: false, refusal: { reason: "media-type" } } }), agentPluginInstallZipRoute, 400, "An application/zip upload is required.", true],
      [fixture({ read: { ok: false, refusal: { reason: "too-large", limit: 32 } } }), agentPluginInstallZipRoute, 413, "too-large", true],
      [fixture({ query: { expectedSha256: DIGEST, replace: "yes" } }), agentPluginInstallZipRoute, 400, "replace must be true or false.", true],
    ];
    for (const [f, route, status, error, read] of cases) {
      const answer = await run(route, f);
      expect([answer.status, (answer.body as { error: string }).error]).toEqual([status, error]);
      expect(f.readBody.mock.calls.length > 0).toBe(read);
      expect(f.deps.installUpload).not.toHaveBeenCalled();
    }
  });

  it("an update answers 200 with the target; a known installer error is its refusal; anything else is thrown", async () => {
    const f = fixture({ params: { pluginId: "p" }, query: { expectedSha256: DIGEST, expectedOldDigest: DIGEST, replace: "true" } });
    expect((await run(agentPluginUpdateZipRoute, f)).status).toBe(200);
    expect(f.deps.installUpload).toHaveBeenCalledWith(expect.objectContaining({ replace: true, update: { pluginId: "p", expectedOldDigest: DIGEST } }));
    const known = fixture();
    vi.mocked(known.deps.installUpload).mockRejectedValueOnce(new RangeError("x"));
    expect(await run(agentPluginInstallZipRoute, known)).toMatchObject({ status: 409, body: { code: "KNOWN", error: "known" } });
    const unknown = fixture();
    vi.mocked(unknown.deps.installUpload).mockRejectedValueOnce(new Error("private /path"));
    await expect(run(agentPluginInstallZipRoute, unknown)).rejects.toThrow("private /path");
  });
});
