import { expect, it, vi } from "vitest";
import { externalMcpProbeRoute } from "../probe.js";

it("direct grant precedes the one probe and only its projected result is returned", async () => {
  const probe = vi.fn(async () => ({ ok: false as const, status: 422, body: { safe: true } }));
  await expect(externalMcpProbeRoute.handle({ input: { serverId: "s" }, deps: { probe }, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
  expect(probe).not.toHaveBeenCalled();
  expect(await externalMcpProbeRoute.handle({ input: { serverId: "s" }, deps: { probe }, authorize: async () => {} })).toMatchObject({ value: { status: 422, body: { safe: true } } });
  expect(probe).toHaveBeenCalledTimes(1);
});
