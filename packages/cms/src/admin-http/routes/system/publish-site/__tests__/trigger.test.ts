import { expect, it, vi } from "vitest";
import { createPublishTriggerRoute } from "../trigger.js";

it("permission, config, domain and consent block before the one synchronous start and preserve the chosen credential", async () => {
  const start = vi.fn(() => ({ status: "running" }));
  const onBlocked = vi.fn((_input: { principalId: string; reasonClass: string }) => {}); const snapshot = vi.fn(() => ({ status: "idle" }));
  const deps = { readConfig: vi.fn(async () => ({ ok: true as const, config: { domain: false } })), plan: () => ({ ok: true as const }), hasCustomDomain: ({ config }: { config: { domain: boolean } }) => config.domain, domainConfirmationText: "confirm", deploymentCheck: vi.fn(async (): Promise<Record<string, unknown> | undefined> => undefined), snapshot, start, onBlocked };
  const route = createPublishTriggerRoute({ deps }); const context = { id: "owner" };
  const input = { body: { projectName: " project ", target: " target ", credentialId: " chosen " } };
  await expect(route.handle({ input, deps, context, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
  expect(deps.readConfig).not.toHaveBeenCalled();
  await route.handle({ input: { body: {} }, deps, context, authorize: async () => {} });
  expect(start).not.toHaveBeenCalled();
  await route.handle({ input, deps: { ...deps, hasCustomDomain: () => true }, context, authorize: async () => {} });
  expect(deps.deploymentCheck).not.toHaveBeenCalled();
  deps.deploymentCheck.mockResolvedValueOnce({ code: "CONSENT_UNAVAILABLE" });
  await route.handle({ input, deps, context, authorize: async () => {} });
  expect(snapshot).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  expect(await route.handle({ input, deps, context, authorize: async () => {} })).toEqual({ ok: true, value: { status: "running" } });
  expect(start).toHaveBeenCalledTimes(1); expect(snapshot).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledWith({ config: { domain: false }, projectName: " project ", principalId: "owner", credentialId: " chosen " });
  expect(onBlocked.mock.calls.map(([call]) => call.reasonClass)).toEqual(["config", "config", "consent"]);
});
