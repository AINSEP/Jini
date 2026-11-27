import { expect, it, vi } from "vitest";
import { externalMcpProbeRoute, registerExternalMcpProbeRoute } from "../probe.js";

it("direct grant precedes the one probe and only its projected result is returned", async () => {
  const probe = vi.fn(async () => ({ ok: false as const, status: 422, body: { safe: true } }));
  await expect(externalMcpProbeRoute.handle({ input: { serverId: "s" }, deps: { probe }, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
  expect(probe).not.toHaveBeenCalled();
  expect(await externalMcpProbeRoute.handle({ input: { serverId: "s" }, deps: { probe }, authorize: async () => {} })).toMatchObject({ value: { status: 422, body: { safe: true } } });
  expect(probe).toHaveBeenCalledTimes(1);
});

it("the mounted probe honors backoff, returns a healthy result, and reports unknown failures privately", async () => {
  type Registrar = Parameters<typeof registerExternalMcpProbeRoute>[0];
  const mount = vi.fn<Registrar["mount"]>();
  const probe = vi.fn<Registrar["probe"]>().mockResolvedValue({ ok: true, body: { connection: "healthy" } });
  registerExternalMcpProbeRoute({ mount, probe, operation: "check-external-mcp" });
  const [entry] = mount.mock.calls;
  if (!entry) throw new Error("probe route did not mount");
  const [binding] = entry;
  expect(binding.authorization).toBe("direct");
  expect(binding.spec.path).toBe("/api/admin/v1/workspaces/:workspaceId/mcp-servers/:serverId/probe");
  const retryAfter = vi.fn();
  const json = vi.fn();
  const rate: Parameters<typeof binding.before>[0]["rate"] = {
    check: vi.fn(async () => ({ allowed: false as const, retryAfterSeconds: 11 })), json, retryAfter, message: "Probe budget exhausted",
  };
  const next = vi.fn(async () => {});
  await binding.before({ rate }, next);
  expect(next).not.toHaveBeenCalled();
  expect(retryAfter.mock.calls).toEqual([["11"]]);
  expect(json.mock.calls).toEqual([[{
    error: "Probe budget exhausted", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: 11 },
  }, 429]]);
  const parsed = await binding.spec.parse({ params: { serverId: "calendar" }, body: { serverId: "forged" }, query: {} });
  if (!parsed.ok) throw new Error("probe parse failed");
  expect(await binding.spec.handle({ input: parsed.value, deps: binding.deps, authorize: async () => {} }))
    .toStrictEqual({ ok: true, value: { status: 200, body: { connection: "healthy" } } });
  expect(probe.mock.calls).toEqual([[{ serverId: "calendar" }]]);
  const error = new Error("private connection detail");
  const incident = vi.fn();
  binding.failure({ error, incident });
  expect(incident.mock.calls).toEqual([[error, { operation: "check-external-mcp", code: "INTERNAL_ERROR" }]]);
});
