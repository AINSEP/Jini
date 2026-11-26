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

it('preserves typed snapshots, distinguishes missing consent and writes refusal before telemetry', async () => {
  const { registerPublishTriggerRoute } = await import('../trigger.js');
  const order: string[] = [];
  const snapshot = { status: 'idle', runId: 'run', revision: 7 };
  const registry = { targetIds: ['target'] };
  const start = vi.fn(() => ({ ...snapshot, status: 'running' }));
  let run!: () => Promise<unknown>;
  let refuse!: () => void;
  const mount: Parameters<typeof registerPublishTriggerRoute<{ target: string; customDomain?: string; region: string }, typeof registry, typeof snapshot>>[0]['mount'] = input => {
    run = () => input.spec.handle({ input: { body: { target: 'target', projectName: 'project' } }, deps: input.deps, context: { id: 'owner' }, authorize: async () => {} });
    refuse = () => input.refusal({ response: { status: 403, body: { error: 'denied' } }, json: () => { order.push('write'); }, principalId: () => 'owner' });
  };
  const required = { mount, readConfig: async () => ({ ok: true as const, config: { target: 'target', region: 'region' }, registry }),
    plan: ({ registry: actual }: { registry: typeof registry }) => { expect(actual).toBe(registry); return { ok: true as const }; }, start,
    snapshot: () => snapshot, consentUnavailable: () => ({ code: 'CONSENT_UNAVAILABLE' }), domainConfirmationText: 'confirm',
    onBlocked: () => { order.push('blocked'); }, operation: 'publish',
  };
  registerPublishTriggerRoute({ ...required, siteConsent: undefined });
  expect(await run()).toMatchObject({ ok: true, value: { status: 409, body: { code: 'CONSENT_UNAVAILABLE' } } });
  expect(start).not.toHaveBeenCalled();
  registerPublishTriggerRoute({ ...required, siteConsent: { deploymentCheck: async () => null } });
  expect(await run()).toEqual({ ok: true, value: { ...snapshot, status: 'running' } });
  expect(start).toHaveBeenCalledWith({ principal: { id: 'owner' }, parsed: { projectName: 'project' }, config: { target: 'target', region: 'region' } });
  order.length = 0; refuse(); expect(order).toEqual(['write', 'blocked']);
});
