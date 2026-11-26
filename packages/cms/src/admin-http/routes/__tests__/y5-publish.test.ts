import { describe, expect, it, vi } from "vitest";
import { registerPublishTriggerRoute } from "../system/publish-site/trigger.js";
import { registerPublishCredentialsListRoute } from "../system/publish-credentials/list.js";

describe("publish credential list mount", () => {
  it("authorizes before reading and writes JSON before starting the nonawaited heal", async () => {
    const events: string[] = [];
    let handler!: Parameters<Parameters<typeof registerPublishCredentialsListRoute>[0]["mount"]>[0]["handle"];
    registerPublishCredentialsListRoute({ mount: input => { handler = input.handle; }, workspaceId: "ws", list: async () => { events.push("read"); return []; }, executionMode: () => "local", triggerAccountLabelHeal: async () => { events.push("heal"); await new Promise(() => {}); }, storeErrors: { validation: Error, duplicateLabel: Error, notFound: Error, secretStoreUnconfigured: Error }, operation: "host/publish-credentials" });
    await handler({ foreignWorkspace: () => false, principalId: () => "owner", authorize: async () => { events.push("authorize"); return true; }, json: () => { events.push("json"); }, failure: vi.fn() });
    expect(events).toEqual(["authorize", "read", "json", "heal"]);
  });
});

it("refuses a publish before starting when consent is unavailable", async () => {
  let mounted!: Parameters<Parameters<typeof registerPublishTriggerRoute<{ target: string }, Record<string, never>, { status: string }>>[0]["mount"]>[0];
  const start = vi.fn(() => ({ status: "running" }));
  registerPublishTriggerRoute<{ target: string }, Record<string, never>, { status: string }>({ mount: entry => { mounted = entry; }, readConfig: async () => ({ ok: true, config: { target: "target" }, registry: {} }), plan: () => ({ ok: true }), start, snapshot: () => ({ status: "idle" }), siteConsent: undefined, consentUnavailable: () => ({ code: "CONSENT_UNAVAILABLE" }), domainConfirmationText: "confirm in chat", onBlocked: vi.fn(), operation: "host/publish" });
  const result = await mounted.spec.handle({ input: { body: { target: "target", projectName: "project" } }, deps: mounted.deps, context: { id: "owner" }, authorize: async () => {} });
  expect(result).toMatchObject({ ok: true, value: { status: 409, body: { code: "CONSENT_UNAVAILABLE" } } });
  expect(start).not.toHaveBeenCalled();
});
