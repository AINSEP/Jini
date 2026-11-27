import { expect, it, vi } from "vitest";
import { isRouteReply } from "@jini-ai/core/contracts/server";
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
    run = async () => input.spec.handle({ input: { body: { target: 'target', projectName: 'project' } }, deps: input.deps, context: { id: 'owner' }, authorize: async () => {} });
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

function triggerFixture() {
  const readConfig = vi.fn(async () => ({ ok: true as const, config: { region: "north" } }));
  const snapshot = vi.fn(() => ({ status: "running", id: "run-3" }));
  const start = vi.fn(() => ({ status: "running", id: "run-4" }));
  const onBlocked = vi.fn();
  const deps = {
    readConfig, snapshot, start, onBlocked, plan: () => ({ ok: true as const }),
    hasCustomDomain: () => false, domainConfirmationText: "confirm", deploymentCheck: async () => undefined,
  };
  const route = createPublishTriggerRoute({ deps });
  const post = async (body: unknown) => {
    const parsed = await route.parse({ body, params: { workspaceId: "ws-1" }, query: {} });
    if (!parsed.ok) throw new Error("the route parser does not validate the body");
    const result = await route.handle({ input: parsed.value, deps, context: { id: "editor-9" }, authorize: async () => {} });
    if (!result.ok || !isRouteReply(result.value)) throw new Error("expected a branded refusal");
    return result.value;
  };
  return { post, readConfig, snapshot, start, onBlocked };
}

it.each<[unknown, string]>([
  [null, "request body must be a JSON object"],
  [["site"], "request body must be a JSON object"],
  [{ projectName: " ", target: "preview" }, "'projectName' (non-empty string) is required"],
  [{ projectName: "release", target: "preview", credentialId: 42 }, "'credentialId' must be a non-empty string when present"],
  [{ projectName: "release", target: "preview", credentialId: " " }, "'credentialId' must be a non-empty string when present"],
  [{ projectName: "release", target: 42 }, "'target' (non-empty string) is required"],
  [{ projectName: "release", target: " " }, "'target' (non-empty string) is required"],
])("reports malformed publish input %j before preflight", async (body, error) => {
  const f = triggerFixture();
  expect(await f.post(body)).toEqual({ status: 400, body: { error } });
  expect(f.readConfig.mock.calls).toEqual([]);
  expect(f.snapshot.mock.calls).toEqual([]);
  expect(f.start.mock.calls).toEqual([]);
  expect(f.onBlocked.mock.calls).toEqual([[{ principalId: "editor-9", reasonClass: "config" }]]);
});

it("returns the still-running snapshot without starting a second publish", async () => {
  const f = triggerFixture();
  expect(await f.post({ projectName: "release", target: "preview" })).toEqual({
    status: 409, body: { error: "a publish is already running", run: { status: "running", id: "run-3" } },
  });
  expect(f.snapshot.mock.calls).toEqual([[{}]]);
  expect(f.start.mock.calls).toEqual([]);
  expect(f.onBlocked.mock.calls).toEqual([[{ principalId: "editor-9", reasonClass: "busy" }]]);
});

it.each(["read", "plan"] as const)("does not read the run slot on a failed publish %s preflight", async (failed) => {
  const readConfig = vi.fn<import("../trigger.js").PublishTriggerDeps<{ targetId: string }, { status: string }>["readConfig"]>(
    async ({ targetId }) => failed === "read" ? { ok: false, error: "Unknown target." } : { ok: true, config: { targetId } },
  );
  const plan = vi.fn(({ config }: { config: { targetId: string } }) => ({ ok: false as const, message: `No deployment directory for ${config.targetId}.` }));
  const snapshot = vi.fn(() => ({ status: "idle" }));
  const start = vi.fn(() => ({ status: "running" }));
  const onBlocked = vi.fn();
  const deps = { readConfig, plan, snapshot, start, onBlocked, hasCustomDomain: () => false, domainConfirmationText: "confirm", deploymentCheck: async () => undefined };
  const body = { target: "preview", projectName: "release" };
  const result = await createPublishTriggerRoute({ deps }).handle({ deps, input: { body }, context: { id: "release-owner" }, authorize: async () => {} });
  expect(result).toEqual({ ok: true, value: { status: 400, body: { error: failed === "read" ? "Unknown target." : "No deployment directory for preview." } } });
  expect(readConfig.mock.calls).toEqual([[{ targetId: "preview", raw: body }]]);
  expect(plan.mock.calls).toEqual(failed === "read" ? [] : [[{ config: { targetId: "preview" } }]]);
  expect(snapshot.mock.calls).toEqual([]);
  expect(start.mock.calls).toEqual([]);
  expect(onBlocked.mock.calls).toEqual([[{ principalId: "release-owner", reasonClass: "config" }]]);
});
