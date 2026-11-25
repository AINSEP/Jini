import { expect, it, vi } from "vitest";
import { unsubscribeSubscription, type UnsubscribeSubscriptionDeps } from "../subscriptions.js";
import { InMemoryNewsletterSubscriptionRepo } from "../repo.memory.js";
import type { SubscriptionRow } from "../types.js";

it("revoke failure leaves the subscription unchanged and repeats remain idempotent", async () => {
  const row: SubscriptionRow = { id: "s", workspaceId: "w", listId: "l", subscriberId: "p", status: "subscribed", source: "admin", consentRevisionIdAtSubscribe: "r", subscribedAt: "now", unsubscribedAt: null, createdAt: "now", updatedAt: "now" };
  const repo = new InMemoryNewsletterSubscriptionRepo({}, { initialRows: [row] });
  const revoke = vi.fn(async (): Promise<{ status: "revoked" }> => { throw new Error("revoke failed"); });
  const deps: UnsubscribeSubscriptionDeps = { subscriptionRepo: repo, clock: { nowIso: () => "later" }, consentCapability: {
    request: async () => ({ requested: true }), confirm: async () => ({ status: "granted", consentRevisionId: "r" }), revoke } };
  const required = { deps, input: { workspaceId: "w", id: "s" } };
  await expect(unsubscribeSubscription(required)).rejects.toThrow("revoke failed");
  expect(await repo.findById({ workspaceId: "w", id: "s" })).toEqual(row);
  revoke.mockResolvedValue({ status: "revoked" });
  await unsubscribeSubscription(required);
  await unsubscribeSubscription(required);
  expect(revoke).toHaveBeenCalledTimes(2);
  expect((await repo.findById({ workspaceId: "w", id: "s" }))?.status).toBe("unsubscribed");
});
