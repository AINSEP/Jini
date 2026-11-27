import { expect, it, vi } from "vitest";
import { consumeConfirmationToken, issueConfirmationToken, type ConfirmationDeps } from "../confirmation.js";
import { InMemoryNewsletterConfirmationTokenRepo, InMemoryNewsletterSubscriptionRepo } from "../repo.memory.js";
import type { SubscriptionRow } from "../types.js";

const now = "2026-01-01T00:00:00.000Z";
const subscription: SubscriptionRow = { id: "sub", workspaceId: "w", listId: "list", subscriberId: "person", status: "pending", source: "admin", consentRevisionIdAtSubscribe: null, subscribedAt: null, unsubscribedAt: null, createdAt: now, updatedAt: now };
function setup(): ConfirmationDeps {
  return { tokenRepo: new InMemoryNewsletterConfirmationTokenRepo(), subscriptionRepo: new InMemoryNewsletterSubscriptionRepo({}, { initialRows: [subscription] }),
    consentCapability: null, clock: { nowIso: () => now }, ids: { newId: () => "token" }, resolveFrom: async () => ({ email: "from@example.test" }),
    mintRawToken: () => "a".repeat(64), hashToken: () => "b".repeat(64),
    originRegistry: { canonicalOrigin: async () => ({ scheme: "https", host: "example.test", verifiedAt: now, source: "workspace-setting" }), isAllowedRedirectTarget: async () => true, isAllowedEgressTarget: async () => true },
    mailer: { capabilities: () => ({ driver: "memory", supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }),
      send: async () => ({ ok: true, providerMessageId: "mail", acceptedAt: now }), sendBatch: async () => [] } };
}
const input = { workspaceId: "w", subscriptionId: "sub", recipientEmail: "to@example.test" };
it("missing sender does not supersede the last working token", async () => {
  const deps = setup();
  await issueConfirmationToken({ deps, input });
  deps.resolveFrom = async () => { throw new Error("missing sender"); };
  await expect(issueConfirmationToken({ deps, input })).rejects.toThrow("missing sender");
  expect((await deps.tokenRepo.findById({ workspaceId: "w", id: "token" }))?.consumedAt).toBeNull();
});
it("denied consent consumes the token without subscribing", async () => {
  const deps = setup();
  await issueConfirmationToken({ deps, input });
  deps.consentCapability = { request: async () => ({ requested: true }), confirm: async () => ({ status: "denied", consentRevisionId: "rev" }), revoke: async () => ({ status: "revoked" }) };
  await expect(consumeConfirmationToken({ deps, input: { workspaceId: "w", rawToken: "a".repeat(64) } })).rejects.toThrow("consent was not granted");
  expect((await deps.tokenRepo.findById({ workspaceId: "w", id: "token" }))?.consumedAt).toBe(now);
  expect((await deps.subscriptionRepo.findById({ workspaceId: "w", id: "sub" }))?.status).toBe("pending");
});
it("a short or non-hex minted token is refused before any row is written", async () => {
  for (const raw of ["ab", "z".repeat(64)]) {
    const deps = setup();
    const save = vi.spyOn(deps.tokenRepo, "save");
    deps.mintRawToken = () => raw;
    await expect(issueConfirmationToken({ deps, input })).rejects.toThrow("mintRawToken must return 64 lowercase hex characters");
    expect(save).not.toHaveBeenCalled();
  }
});
it("a non-64-hex digest is refused", async () => {
  const deps = setup();
  const save = vi.spyOn(deps.tokenRepo, "save");
  deps.hashToken = () => "not-a-digest";
  await expect(issueConfirmationToken({ deps, input })).rejects.toThrow("hashToken must return 64 lowercase hex characters");
  expect(save).not.toHaveBeenCalled();
});

type SentMail = Parameters<ConfirmationDeps["mailer"]["send"]>;
function captureMail(deps: ConfirmationDeps): SentMail[] {
  const sent: SentMail[] = [];
  deps.mailer = { ...deps.mailer, send: async (...args: SentMail) => { sent.push(args); return { ok: true, providerMessageId: "mail", acceptedAt: now }; } };
  return sent;
}
async function rejection(promise: Promise<unknown>): Promise<{ message: string; reason: string }> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  if (!(error instanceof Error) || !("reason" in error)) throw new Error("expected a NewsletterConfirmTokenInvalidError");
  return { message: error.message, reason: String(error.reason) };
}
const rawToken = "a".repeat(64);
const expiresAt = "2026-01-04T00:00:00.000Z";

it("a re-issue supersedes every prior unconsumed token and keeps only the newest live", async () => {
  const deps = setup();
  const ids = ["tok-1", "tok-2", "tok-3"];
  deps.ids = { newId: () => ids.shift() ?? "spare" };
  await issueConfirmationToken({ deps, input });
  await issueConfirmationToken({ deps, input });
  deps.clock = { nowIso: () => "2026-01-02T00:00:00.000Z" };
  const third = await issueConfirmationToken({ deps, input });
  expect(third).toEqual({ tokenId: "tok-3", expiresAt: "2026-01-05T00:00:00.000Z" });
  expect((await deps.tokenRepo.findById({ workspaceId: "w", id: "tok-1" }))?.consumedAt).toBe(now);
  expect((await deps.tokenRepo.findById({ workspaceId: "w", id: "tok-2" }))?.consumedAt).toBe("2026-01-02T00:00:00.000Z");
  expect((await deps.tokenRepo.findById({ workspaceId: "w", id: "tok-3" }))?.consumedAt).toBeNull();
});

it("the confirm email links to the canonical origin, naming the port only when it is not the scheme default", async () => {
  const cases = [
    { origin: { scheme: "https" as const, host: "example.test", port: 443 }, url: "https://example.test/newsletter/confirm?token=" },
    { origin: { scheme: "http" as const, host: "example.test", port: 80 }, url: "http://example.test/newsletter/confirm?token=" },
    { origin: { scheme: "https" as const, host: "example.test", port: 8443, basePath: "/site" }, url: "https://example.test:8443/site/newsletter/confirm?token=" },
    { origin: { scheme: "http" as const, host: "example.test", port: 443 }, url: "http://example.test:443/newsletter/confirm?token=" },
  ];
  for (const { origin, url } of cases) {
    const deps = setup();
    const sent = captureMail(deps);
    deps.originRegistry = { ...deps.originRegistry, canonicalOrigin: async () => ({ ...origin, verifiedAt: now, source: "workspace-setting" }) };
    await issueConfirmationToken({ deps, input });
    const link = `${url}${rawToken}`;
    expect(sent).toEqual([[
      { workspaceId: "w", to: { email: "to@example.test" }, from: { email: "from@example.test" }, subject: "Confirm your subscription",
        text: `Please confirm your subscription: ${link}`, html: `<p>Please confirm your subscription: <a href="${link}">${link}</a></p>` },
      { idempotencyKey: "newsletter:confirm-email:token", workspaceId: "w", sourceContext: { module: "newsletter", ref: "token" }, purpose: "transactional", lane: "interactive" },
    ]]);
  }
});

it("an unknown token is refused as not_found", async () => {
  const deps = setup();
  expect(await rejection(consumeConfirmationToken({ deps, input: { workspaceId: "w", rawToken } })))
    .toEqual({ message: "confirmation token was not found", reason: "not_found" });
});

it("a second click on a consumed token is refused as already_consumed and leaves the subscription pending", async () => {
  const deps = setup();
  await issueConfirmationToken({ deps, input });
  deps.consentCapability = { request: async () => ({ requested: true }), confirm: async () => ({ status: "denied", consentRevisionId: "rev" }), revoke: async () => ({ status: "revoked" }) };
  await rejection(consumeConfirmationToken({ deps, input: { workspaceId: "w", rawToken } }));
  expect(await rejection(consumeConfirmationToken({ deps, input: { workspaceId: "w", rawToken } })))
    .toEqual({ message: "confirmation token was already consumed", reason: "already_consumed" });
  expect((await deps.subscriptionRepo.findById({ workspaceId: "w", id: "sub" }))?.status).toBe("pending");
});

it("a token used at exactly expiresAt is expired, one millisecond earlier it still confirms", async () => {
  const expired = setup();
  await issueConfirmationToken({ deps: expired, input });
  expired.clock = { nowIso: () => expiresAt };
  expect(await rejection(consumeConfirmationToken({ deps: expired, input: { workspaceId: "w", rawToken } })))
    .toEqual({ message: "confirmation token has expired", reason: "expired" });
  expect((await expired.tokenRepo.findById({ workspaceId: "w", id: "token" }))?.consumedAt).toBeNull();

  const live = setup();
  await issueConfirmationToken({ deps: live, input });
  live.clock = { nowIso: () => "2026-01-03T23:59:59.999Z" };
  const result = await consumeConfirmationToken({ deps: live, input: { workspaceId: "w", rawToken } });
  expect(result.subscription.status).toBe("subscribed");
});

it("a token whose subscription is gone is refused as not_found", async () => {
  const deps = setup();
  deps.subscriptionRepo = new InMemoryNewsletterSubscriptionRepo();
  await issueConfirmationToken({ deps, input });
  expect(await rejection(consumeConfirmationToken({ deps, input: { workspaceId: "w", rawToken } })))
    .toEqual({ message: "subscription was not found", reason: "not_found" });
});

it("with no consent capability bound the confirmation subscribes and records no consent revision", async () => {
  const deps = setup();
  await issueConfirmationToken({ deps, input });
  deps.clock = { nowIso: () => "2026-01-02T00:00:00.000Z" };
  const result = await consumeConfirmationToken({ deps, input: { workspaceId: "w", rawToken } });
  const expected = { ...subscription, status: "subscribed", consentRevisionIdAtSubscribe: null, subscribedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" };
  expect(result).toEqual({ subscription: expected, changed: true, eventId: "newsletter-subscribed:token" });
  expect(await deps.subscriptionRepo.findById({ workspaceId: "w", id: "sub" })).toEqual(expected);
  expect((await deps.tokenRepo.findById({ workspaceId: "w", id: "token" }))?.consumedAt).toBe("2026-01-02T00:00:00.000Z");
});

it("granted consent records its revision after requesting with the token as evidence; an already-subscribed row reports no change", async () => {
  const deps = setup();
  await deps.subscriptionRepo.save({ ...subscription, status: "subscribed", source: "signup_form" });
  await issueConfirmationToken({ deps, input });
  const calls: unknown[] = [];
  deps.consentCapability = {
    request: async (args) => { calls.push(["request", args]); return { requested: true }; },
    confirm: async (args) => { calls.push(["confirm", args]); return { status: "granted", consentRevisionId: "rev-7" }; },
    revoke: async () => ({ status: "revoked" }),
  };
  const result = await consumeConfirmationToken({ deps, input: { workspaceId: "w", rawToken } });
  expect(calls).toEqual([
    ["request", { workspaceId: "w", subscriberId: "person", evidence: { consentTextRef: "newsletter-subscription-confirm-v1", source: "signup_form", confirmTokenId: "token" } }],
    ["confirm", { workspaceId: "w", subscriberId: "person", confirmTokenId: "token" }],
  ]);
  expect(result.changed).toBe(false);
  expect((await deps.subscriptionRepo.findById({ workspaceId: "w", id: "sub" }))?.consentRevisionIdAtSubscribe).toBe("rev-7");
});
