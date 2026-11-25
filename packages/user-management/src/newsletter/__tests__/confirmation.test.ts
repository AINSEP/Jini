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
