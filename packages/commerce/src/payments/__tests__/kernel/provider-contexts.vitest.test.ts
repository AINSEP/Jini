import { describe, expect, it, vi } from "vitest";
import { createProviderContexts } from "../../kernel.js";
import type { PaymentScope } from "../../contract/scope.js";
import { createLipayFake, lipayFakeContext } from "../../testkit/lipay-fake.js";

const scope: PaymentScope = { workspaceId: "ws", siteId: "site-a", providerId: "lipay", providerAccountId: "account-a", mode: "test" };
const provider = { ...createLipayFake({ now: () => 42 }).provider, credentialKeys: ["secretKey", "webhookSecret"] };
const urls = { webhookUrl: "https://host/webhook", returnUrl: "https://host/return", cancelUrl: "https://host/cancel" };
const saved = { settings: { accountId: "account-a" }, secrets: {
  test_secretKey: "test-key", test_webhookSecret: "test-hook", live_secretKey: "live-key", live_webhookSecret: "live-hook", test_unlisted: "private",
} };
function world() {
  const read = vi.fn(async () => saved as typeof saved | null);
  const configFor = vi.fn(({ siteId }: { siteId: string }) => ({ read: siteId === "site-a" ? read : async () => null }));
  const urlsFor = vi.fn(() => urls as typeof urls | null);
  const required = { bindings: { lipay: "payments-lipay" }, configFor, urlsFor,
    httpClient: lipayFakeContext({ now: () => 0 }).httpClient, now: () => 42 };
  return { required, read, configFor, urlsFor, resolve: (input = scope) => createProviderContexts(required).resolve({ scope: input, provider }) };
}
const refused = (retryable = false) => ({ ok: false, error: { code: "NO_CREDENTIALS_CONFIGURED", retryable,
  message: retryable ? "provider configuration could not be read; re-enter it in settings" : "provider credentials or URLs are not configured for this scope" } });

describe("site-bound payment credentials", () => {
  it.each(["test", "live"] as const)("returns only declared %s slots and the injected context", async mode => {
    const w = world(), result = await w.resolve({ ...scope, mode });
    expect(result).toEqual({ ok: true, ctx: { credentials: { secretKey: `${mode}-key`, webhookSecret: `${mode}-hook` },
      account: { providerAccountId: "account-a", mode }, ...urls, httpClient: w.required.httpClient, now: w.required.now } });
    if (!result.ok) throw new Error("expected context");
    expect(result.ctx.now()).toBe(42);
    expect(w.configFor.mock.calls).toEqual([[{ siteId: "site-a" }]]);
    expect(w.read.mock.calls).toEqual([[{ pluginId: "payments-lipay" }]]);
    expect(w.urlsFor.mock.calls).toEqual([[{ scope: { ...scope, mode } }]]);
  });
  it.each([null, { ...saved, settings: { accountId: "wrong" } }, { ...saved, secrets: {} },
    { ...saved, secrets: { test_secretKey: "key", test_webhookSecret: " " } }])("refuses missing, mismatched or incomplete configuration", async config => {
    const w = world(); w.read.mockResolvedValue(config as typeof saved | null);
    expect(await w.resolve()).toEqual(refused());
  });
  it("refuses live requests when only test credentials exist and never reads another site", async () => {
    const w = world(); w.read.mockResolvedValue({ ...saved, secrets: { test_secretKey: "key", test_webhookSecret: "hook" } } as typeof saved);
    expect(await w.resolve({ ...scope, mode: "live" })).toEqual(refused());
    expect(await w.resolve({ ...scope, siteId: "site-b" })).toEqual(refused());
    expect(w.read).toHaveBeenCalledTimes(1);
  });
  it("refuses unbound or mismatched provider identities without reading credentials", async () => {
    const w = world();
    expect(await createProviderContexts({ ...w.required, bindings: {} }, {}).resolve({ scope, provider }, {})).toEqual(refused());
    expect(await w.resolve({ ...scope, providerId: "other" })).toEqual(refused());
    expect(w.configFor).not.toHaveBeenCalled();
  });
  it.each([null, ...Object.keys(urls).map(key => ({ ...urls, [key]: "" }))])("refuses missing URLs", async value => {
    const w = world(); w.urlsFor.mockReturnValue(value);
    expect(await w.resolve()).toEqual(refused());
  });
  it.each(["ProviderConfigUnreadableError", "Error"])("redacts %s and makes a failed read retryable", async name => {
    const w = world(); w.read.mockRejectedValue(Object.assign(new Error("secret must not escape"), { name }));
    expect(await w.resolve()).toEqual(refused(true));
  });
});
