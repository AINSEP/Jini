import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { providerOk, providerRejected, providerUnknown } from "@jini-ai/core/provider-registry";
import type { MailProviderModule } from "../provider.js";
import { createConsoleMailProvider } from "../builtin-providers.js";

import { createSenderDomainVerification, type SenderDomainVerificationDeps } from "../sender-domain-verification.js";

/**
 * @file The provider-side sender-domain verdict: every reason the provider cannot be asked is its
 * own state, a provider answer is passed through, and no failure is ever reported as `failed`.
 */

const provider = (domainStatus?: MailProviderModule["domainStatus"]): MailProviderModule => ({
  ...createConsoleMailProvider({ clock: { nowMs: () => 0 } }, { log: () => {} }),
  id: "mailer", ...(domainStatus ? { domainStatus } : {}),
});
const answering = provider(async (_ctx, { domain }) => providerOk({ value: { domain, state: "pending" as const } }));

function deps(overrides: Partial<SenderDomainVerificationDeps> = {}): SenderDomainVerificationDeps {
  return {
    workspaceId: "ws", httpClient: { send: async () => { throw new Error("no network"); } },
    findProvider: async () => answering,
    resolveCredential: async () => ({ token: "k" }),
    readProviderId: async () => "mailer",
    readSenderEmail: async () => "hello@Example.COM",
    ...overrides,
  };
}

test("the provider's answer is passed through, for the lower-cased sender domain, with this workspace's live context", async () => {
  const asked: unknown[] = [];
  const fixed = deps({ findProvider: async () => provider(async (ctx, { domain }) => { asked.push({ ctx, domain }); return providerOk({ value: { domain, state: "pending" as const } }); }) });
  assert.deepEqual(await createSenderDomainVerification(fixed)(), { state: "pending", domain: "example.com", providerId: "mailer" });
  assert.deepEqual(asked, [{ ctx: { workspaceId: "ws", mode: "live", credential: { token: "k" }, httpClient: fixed.httpClient }, domain: "example.com" }]);
});

test("no sender, no provider and an unsupported provider are named apart", async () => {
  assert.deepEqual(await createSenderDomainVerification(deps({ readSenderEmail: async () => undefined }))(), { state: "no_sender", providerId: "mailer" });
  assert.deepEqual(await createSenderDomainVerification(deps({ readSenderEmail: async () => { throw new Error("db"); } }))(), { state: "no_sender", providerId: "mailer" });
  assert.deepEqual(await createSenderDomainVerification(deps({ readSenderEmail: async () => "no-at-sign" }))(), { state: "no_sender", providerId: "mailer" });
  assert.deepEqual(await createSenderDomainVerification(deps({ readProviderId: async () => null }))(), { state: "no_provider", domain: "example.com", providerId: null });
  assert.deepEqual(await createSenderDomainVerification(deps({ readProviderId: async () => { throw new Error("db"); } }))(), { state: "no_provider", domain: "example.com", providerId: null });
  assert.deepEqual(await createSenderDomainVerification(deps({ findProvider: async () => undefined }))(), { state: "no_provider", domain: "example.com", providerId: "mailer" });
  assert.deepEqual(await createSenderDomainVerification(deps({ findProvider: async () => { throw new Error("catalog"); } }))(), { state: "no_provider", domain: "example.com", providerId: "mailer" });
  assert.deepEqual(await createSenderDomainVerification(deps({ findProvider: async () => provider() }))(), { state: "unsupported", domain: "example.com", providerId: "mailer" });
});

test("a missing key, a provider error and a thrown call are Unknown, never failed", async () => {
  const unknown = (reason: string) => ({ state: "unknown", domain: "example.com", providerId: "mailer", reason });
  assert.deepEqual(await createSenderDomainVerification(deps({ resolveCredential: async () => null }))(), unknown("the provider's key is not saved"));
  assert.deepEqual(await createSenderDomainVerification(deps({ resolveCredential: async () => { throw new Error("vault"); } }))(), unknown("the provider's key is not saved"));
  const rejecting = provider(async () => providerRejected({ code: "forbidden", message: "no" }));
  assert.deepEqual(await createSenderDomainVerification(deps({ findProvider: async () => rejecting }))(), unknown("the sending key can't check domains, and no connected account could check it either"));
  const throwing = provider(async () => { throw new Error("socket"); });
  assert.deepEqual(await createSenderDomainVerification(deps({ findProvider: async () => throwing }))(), unknown("the provider did not answer the domain check"));
});

test("provider failure details keep code and useful copy while scrubbing the resolved key before capping", async () => {
  const secret = "saved-credential-value";
  const refusing = provider(async () => providerRejected({ code: "unauthorized", message: `Use a full-access key; received ${secret}. ${"x".repeat(1500)}` }));
  const result = await createSenderDomainVerification(deps({ findProvider: async () => refusing, resolveCredential: async () => ({ token: secret }) }))();
  assert.equal(result.state, "unknown");
  assert.ok(result.state === "unknown");
  assert.equal(result.reason, `unauthorized: Use a full-access key; received [REDACTED:exact_secret]. ${"x".repeat(1500)}`.slice(0, 1000));
});

test("a permission refusal retries with the plugin account key without changing the sending key", async () => {
  const credential = { token: "send-only" };
  const tokens: string[] = [];
  const restricted = provider(async (ctx, { domain }) => {
    tokens.push(ctx.credential.token);
    return ctx.credential.token === "account"
      ? providerOk({ value: { domain, state: "verified" as const } })
      : providerRejected({ code: "forbidden", message: "sending access only" });
  });
  const check = createSenderDomainVerification(deps({
    findProvider: async () => restricted, resolveCredential: async () => credential,
    resolveDomainReadCredential: async ({ id }) => { assert.equal(id, "mailer"); return { token: "account" }; },
  }));
  assert.deepEqual(await check(), { state: "verified", domain: "example.com", providerId: "mailer" });
  assert.deepEqual(tokens, ["send-only", "account"]);
  assert.deepEqual(credential, { token: "send-only" });
});

test("an unrelated provider refusal never opens the account credential", async () => {
  let lookups = 0;
  const check = createSenderDomainVerification(deps({
    findProvider: async () => provider(async () => providerRejected({ code: "rate_limited", message: "wait" })),
    resolveDomainReadCredential: async () => { lookups += 1; return { token: "account" }; },
  }));
  assert.deepEqual(await check(), { state: "unknown", domain: "example.com", providerId: "mailer", reason: "rate_limited: wait" });
  assert.equal(lookups, 0);
});

test.each(["verified", "pending", "failed", "not_found"] as const)("passes through provider state %s without checking DNS requirements", async state => {
  const answering = provider(async (_ctx, { domain }) => providerOk({ value: { domain, state } }));
  answering.domainRequirements = async () => { throw new Error("status must not request DNS requirements"); };
  assert.deepEqual(await createSenderDomainVerification(deps({ findProvider: async () => answering }))(), { state, domain: "example.com", providerId: "mailer" });
});

test("retains the frozen sign-in redaction text byte for byte", async () => {
  const refusing = provider(async () => providerRejected({ code: "unauthorized", message: "Use saved-value at https://mail.example/?session_code=abc#fragment&view=1" }));
  assert.deepEqual(await createSenderDomainVerification(deps({ findProvider: async () => refusing, resolveCredential: async () => ({ token: "saved-value" }) }))(), {
    state: "unknown", domain: "example.com", providerId: "mailer",
    reason: "unauthorized: Use [REDACTED:exact_secret] at https://mail.example/[REDACTED:url_secret_param]&view=1",
  });
});

test.each(["missing", "failed", "refused", "throws"] as const)("reports the legacy reason when the account is %s", async outcome => {
  let reads = 0;
  const refusing = provider(async () => {
    reads++;
    if (reads === 2 && outcome === "throws") throw new Error("offline");
    return providerRejected({ code: "forbidden", message: "read access required" });
  });
  assert.deepEqual(await createSenderDomainVerification(deps({
    findProvider: async () => refusing,
    resolveDomainReadCredential: async () => {
      if (outcome === "failed") throw new Error("vault offline");
      return outcome === "missing" ? null : { token: "account" };
    },
  }))(), {
    state: "unknown", domain: "example.com", providerId: "mailer",
    reason: outcome === "throws" ? "the provider did not answer the domain check" : "the sending key can't check domains, and no connected account could check it either",
  });
  assert.equal(reads, outcome === "missing" || outcome === "failed" ? 1 : 2);
});

test("starts settings together, then awaits catalog, sending key, provider, account key and retry in order", async () => {
  const effects: string[] = [];
  let finishSender!: (value: string) => void;
  const sender = new Promise<string>(resolve => { finishSender = resolve; });
  const restricted = provider(async ctx => {
    effects.push(`status:${ctx.credential.token}`);
    return ctx.credential.token === "account" ? providerOk({ value: { domain: "example.com", state: "verified" as const } }) : providerRejected({ code: "forbidden", message: "no" });
  });
  const check = createSenderDomainVerification(deps({
    readProviderId: async () => { effects.push("provider setting"); return "mailer"; },
    readSenderEmail: () => { effects.push("sender setting"); return sender; },
    findProvider: async () => { effects.push("catalog"); return restricted; },
    resolveCredential: async () => { effects.push("sending key"); return { token: "sending" }; },
    resolveDomainReadCredential: async () => { effects.push("account key"); return { token: "account" }; },
  }));
  const pending = check();
  assert.deepEqual(effects, ["provider setting", "sender setting"]);
  finishSender("hello@example.com");
  assert.deepEqual(await pending, { state: "verified", domain: "example.com", providerId: "mailer" });
  assert.deepEqual(effects, ["provider setting", "sender setting", "catalog", "sending key", "status:sending", "account key", "status:account"]);
});

test.each(["settings", "catalog", "sending key", "provider", "account key"] as const)("the default deadline covers stalled %s and clears its timer", async stage => {
  vi.useFakeTimers();
  try {
    const stall = <T>(): Promise<T> => new Promise(() => {});
    const fixed = deps();
    if (stage === "settings") fixed.readSenderEmail = () => stall();
    if (stage === "catalog") fixed.findProvider = () => stall();
    if (stage === "sending key") fixed.resolveCredential = () => stall();
    if (stage === "provider") fixed.findProvider = async () => provider(() => stall());
    if (stage === "account key") {
      fixed.findProvider = async () => provider(async () => providerRejected({ code: "forbidden", message: "no" }));
      fixed.resolveDomainReadCredential = () => stall();
    }
    let settled = false;
    const pending = createSenderDomainVerification(fixed)().then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(4_999);
    assert.equal(settled, false);
    await vi.advanceTimersByTimeAsync(1);
    assert.deepEqual(await pending, { state: "unknown", providerId: null, reason: "provider_domain_check_timed_out" });
    assert.equal(vi.getTimerCount(), 0);
  } finally { vi.useRealTimers(); }
});

test("a custom deadline returns the exact timeout verdict and does not cancel late provider work", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (value: Awaited<ReturnType<NonNullable<MailProviderModule["domainStatus"]>>>) => void;
    let called = false;
    const stalled = provider(() => { called = true; return new Promise(resolve => { finish = resolve; }); });
    const pending = createSenderDomainVerification(deps({ findProvider: async () => stalled }), { timeoutMs: 25 })();
    await vi.advanceTimersByTimeAsync(24);
    assert.equal(called, true);
    await vi.advanceTimersByTimeAsync(1);
    const verdict = await pending;
    assert.deepEqual(verdict, { state: "unknown", providerId: null, reason: "provider_domain_check_timed_out" });
    finish(providerOk({ value: { domain: "example.com", state: "verified" } }));
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(await pending, verdict);
    assert.equal(vi.getTimerCount(), 0);
  } finally { vi.useRealTimers(); }
});

test("clears successful checks' timers and reads fresh settings on the next check", async () => {
  vi.useFakeTimers();
  try {
    let email: string | undefined = "hello@example.com";
    const check = createSenderDomainVerification(deps({ readSenderEmail: async () => email }));
    assert.deepEqual(await check(), { state: "pending", domain: "example.com", providerId: "mailer" });
    assert.equal(vi.getTimerCount(), 0);
    email = undefined;
    assert.deepEqual(await check(), { state: "no_sender", providerId: "mailer" });
    assert.equal(vi.getTimerCount(), 0);
  } finally { vi.useRealTimers(); }
});

test("an unknown provider outcome retains its code and message without opening an account", async () => {
  let lookups = 0;
  const check = createSenderDomainVerification(deps({
    findProvider: async () => provider(async () => providerUnknown({ code: "network", message: "offline" })),
    // A key that appears nowhere in the diagnostic: the default "k" is exact-redacted out of "network".
    resolveCredential: async () => ({ token: "sending-key-value" }),
    resolveDomainReadCredential: async () => { lookups++; return { token: "account" }; },
  }));
  assert.deepEqual(await check(), { state: "unknown", domain: "example.com", providerId: "mailer", reason: "network: offline" });
  assert.equal(lookups, 0);
});
